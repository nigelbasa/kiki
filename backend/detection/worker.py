"""Detection job manager that offloads YOLO work without blocking FastAPI."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import multiprocessing
import shutil
import tempfile
import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path
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


def _metadata_path(output_path: str) -> Path:
    return Path(output_path).with_suffix(".meta.json")


def _write_job_metadata(
    output_path: str,
    *,
    job_id: str,
    counts: dict[str, int],
    total_frames: int,
    duration_sec: float,
) -> None:
    payload = {
        "job_id": job_id,
        "status": "complete",
        "progress": 1.0,
        "frame_idx": total_frames,
        "total_frames": total_frames,
        "duration_sec": duration_sec,
        "counts": counts,
    }
    _metadata_path(output_path).write_text(json.dumps(payload), encoding="utf-8")


def _worker_entry(video_path: str, output_path: str, progress_queue) -> dict:
    """Runs inside a child process. Posts progress tuples back via a queue."""

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
        _write_job_metadata(
            out,
            job_id=Path(out).stem.replace("_annotated", ""),
            counts=counts,
            total_frames=total_frames,
            duration_sec=duration_sec,
        )
        progress_queue.put(("done", out, counts, total_frames, duration_sec))
        return {"ok": True, "output_path": out}
    except Exception as exc:  # noqa: BLE001
        progress_queue.put(("error", str(exc)))
        return {"ok": False, "error": str(exc)}


class DetectionWorker:
    """Singleton that tracks jobs and dispatches them to a dedicated subprocess."""

    def __init__(self) -> None:
        self._jobs: dict[str, JobStatus] = {}
        self._processes: dict[str, multiprocessing.Process] = {}
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

    def shutdown(self) -> None:
        for process in list(self._processes.values()):
            if process.is_alive():
                process.terminate()
            process.join(timeout=1.0)
        self._processes.clear()

    def get_status(self, job_id: str) -> Optional[JobStatus]:
        return self._jobs.get(job_id)

    def clear_jobs(self) -> None:
        self.shutdown()
        self._jobs.clear()
        output_dir = os.path.join(tempfile.gettempdir(), "rwendo_outputs")
        upload_dir = os.path.join(tempfile.gettempdir(), "rwendo_uploads")
        for path in (output_dir, upload_dir):
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            os.makedirs(path, exist_ok=True)

    def submit_job(self, job_id: str, video_path: str) -> str:
        if self._loop is None:
            raise RuntimeError("DetectionWorker not configured")
        if any(job.status in {"queued", "processing"} for job in self._jobs.values()):
            raise RuntimeError("A detection job is already running")
        output_dir = os.path.join(tempfile.gettempdir(), "rwendo_outputs")
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, f"{job_id}_annotated.mp4")

        status = JobStatus(job_id=job_id, status="queued")
        self._jobs[job_id] = status

        progress_queue: Any = multiprocessing.Queue()
        thread = threading.Thread(
            target=self._drain_progress,
            args=(job_id, progress_queue),
            name=f"detection-progress-{job_id}",
            daemon=True,
        )
        thread.start()

        process = multiprocessing.Process(
            target=_worker_entry,
            args=(video_path, output_path, progress_queue),
            name=f"rwendo-detection-{job_id}",
            daemon=True,
        )
        process.start()
        self._processes[job_id] = process
        status.status = "processing"
        return job_id

    def _drain_progress(self, job_id: str, queue) -> None:
        status = self._jobs.get(job_id)
        if status is None:
            return

        while True:
            try:
                msg = queue.get(timeout=300)
            except Exception:
                process = self._processes.get(job_id)
                if process is not None and not process.is_alive():
                    if status.status not in {"complete", "error"}:
                        status.status = "error"
                        status.error = "Detection worker exited before returning a result"
                        self._emit_complete(status)
                    self._cleanup_process(job_id)
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
                self._cleanup_process(job_id)
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
                self._cleanup_process(job_id)
                try:
                    queue.close()
                except Exception:
                    pass
                break
        else:
            self._cleanup_process(job_id)

    def _cleanup_process(self, job_id: str) -> None:
        process = self._processes.pop(job_id, None)
        if process is None:
            return
        if process.is_alive():
            process.join(timeout=0.5)
        else:
            process.join(timeout=0.1)

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
