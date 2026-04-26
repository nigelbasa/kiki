"""Detection job manager that offloads YOLO work without blocking FastAPI."""
from __future__ import annotations

import asyncio
import logging
import os
import queue
import shutil
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from typing import Any, Awaitable, Callable, Literal, Optional

from detection.annotator import run_detection


log = logging.getLogger("rwendo.detection")

JobStatusLit = Literal["queued", "processing", "complete", "error"]


@dataclass
class JobStatus:
    job_id: str
    status: JobStatusLit = "queued"
    progress: float = 0.0
    frame_idx: int = 0
    total_frames: int = 0
    duration_sec: float = 0.0
    output_path: Optional[str] = None
    counts: dict[str, int] = field(
        default_factory=lambda: {"car": 0, "truck": 0, "bus": 0, "motorcycle": 0}
    )
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


def _worker_entry(video_path: str, output_path: str, progress_queue) -> dict:
    """Runs inside the child process. Posts progress tuples back via a queue."""

    def _cb(frame_idx: int, total: int) -> None:
        try:
            progress_queue.put(("progress", frame_idx, total))
        except Exception:
            pass

    try:
        out, counts, total_frames, duration_sec = run_detection(
            video_path,
            output_path,
            progress_callback=_cb,
        )
        progress_queue.put(("done", out, counts, total_frames, duration_sec))
        return {"ok": True, "output_path": out}
    except Exception as exc:  # noqa: BLE001
        progress_queue.put(("error", str(exc)))
        return {"ok": False, "error": str(exc)}


class DetectionWorker:
    """Singleton that tracks jobs and dispatches them to a single worker thread."""

    def __init__(self) -> None:
        self._jobs: dict[str, JobStatus] = {}
        self._executor: Optional[ThreadPoolExecutor] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._progress_emit: Optional[Callable[[str, dict], Awaitable[None]]] = None
        self._complete_emit: Optional[Callable[[str, dict], Awaitable[None]]] = None
        self._prefetch_model()

    def _prefetch_model(self) -> None:
        """Pull YOLO weights into the cache so the subprocess does not need to."""
        try:
            from ultralytics import YOLO  # type: ignore

            YOLO("yolo11n.pt")
            log.info("YOLO model ready")
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "YOLO prefetch failed (detection may still work if model downloads later): %s",
                exc,
            )

    def configure(
        self,
        loop: asyncio.AbstractEventLoop,
        progress_emit: Callable[[str, dict], Awaitable[None]],
        complete_emit: Callable[[str, dict], Awaitable[None]],
    ) -> None:
        self._loop = loop
        self._progress_emit = progress_emit
        self._complete_emit = complete_emit
        if self._executor is None:
            self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rwendo-detection")

    def shutdown(self) -> None:
        if self._executor is not None:
            self._executor.shutdown(wait=False, cancel_futures=True)
            self._executor = None

    def get_status(self, job_id: str) -> Optional[JobStatus]:
        return self._jobs.get(job_id)

    def clear_jobs(self) -> None:
        self._jobs.clear()
        output_dir = os.path.join(tempfile.gettempdir(), "rwendo_outputs")
        upload_dir = os.path.join(tempfile.gettempdir(), "rwendo_uploads")
        for path in (output_dir, upload_dir):
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            os.makedirs(path, exist_ok=True)

    def submit_job(self, job_id: str, video_path: str) -> str:
        if self._executor is None:
            raise RuntimeError("DetectionWorker not configured")
        output_dir = os.path.join(tempfile.gettempdir(), "rwendo_outputs")
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, f"{job_id}_annotated.mp4")

        status = JobStatus(job_id=job_id, status="queued")
        self._jobs[job_id] = status

        progress_queue: Any = queue.Queue()
        thread = threading.Thread(
            target=self._drain_progress,
            args=(job_id, progress_queue),
            name=f"detection-progress-{job_id}",
            daemon=True,
        )
        thread.start()

        future = self._executor.submit(_worker_entry, video_path, output_path, progress_queue)
        status.status = "processing"

        def _done(fut) -> None:
            try:
                result = fut.result()
                if result.get("ok"):
                    status.output_path = result["output_path"]
                else:
                    status.status = "error"
                    status.error = result.get("error", "unknown error")
            except Exception as exc:  # noqa: BLE001
                status.status = "error"
                status.error = str(exc)

        future.add_done_callback(_done)
        return job_id

    def _drain_progress(self, job_id: str, queue) -> None:
        status = self._jobs.get(job_id)
        if status is None:
            return

        while True:
            try:
                msg = queue.get(timeout=300)
            except Exception:
                break

            tag = msg[0]
            if tag == "progress":
                _, frame_idx, total = msg
                status.frame_idx = int(frame_idx)
                status.total_frames = int(total) if total else 0
                status.progress = (frame_idx / total) if total else 0.0
                self._emit_progress(status)
            elif tag == "done":
                _, output_path, counts, total_frames, duration_sec = msg
                status.status = "complete"
                status.output_path = output_path
                status.counts = counts
                status.total_frames = int(total_frames)
                status.duration_sec = float(duration_sec)
                status.progress = 1.0
                self._emit_complete(status)
                try:
                    queue.close()
                except Exception:
                    pass
                break
            elif tag == "error":
                _, err = msg
                status.status = "error"
                status.error = err
                self._emit_complete(status)
                try:
                    queue.close()
                except Exception:
                    pass
                break

    def _emit_progress(self, status: JobStatus) -> None:
        if self._loop is None or self._progress_emit is None:
            return
        payload = {
            "job_id": status.job_id,
            "progress": status.progress,
            "frame_idx": status.frame_idx,
            "total_frames": status.total_frames,
            "counts": status.counts,
        }
        try:
            asyncio.run_coroutine_threadsafe(
                self._progress_emit(status.job_id, payload),
                self._loop,
            )
        except RuntimeError:
            pass

    def _emit_complete(self, status: JobStatus) -> None:
        if self._loop is None or self._complete_emit is None:
            return
        payload = {
            "job_id": status.job_id,
            "status": status.status,
            "error": status.error,
            "counts": status.counts,
            "total_frames": status.total_frames,
            "duration_sec": status.duration_sec,
        }
        try:
            asyncio.run_coroutine_threadsafe(
                self._complete_emit(status.job_id, payload),
                self._loop,
            )
        except RuntimeError:
            pass
