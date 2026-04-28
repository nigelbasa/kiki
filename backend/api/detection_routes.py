"""REST routes for detection video upload, status, and results."""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

import db
from auth.middleware import require_admin

UPLOAD_DIR = "/tmp/rwendo_uploads"
VIDEOS_DIR = Path(__file__).resolve().parents[1] / "videos"
OUTPUT_DIR = Path(tempfile.gettempdir()) / "rwendo_outputs"
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}
MAX_UPLOAD_BYTES = 200 * 1024 * 1024


def _annotated_sidecar_paths(video_path: Path) -> tuple[Path, Path]:
    return (video_path.with_suffix(".json"), video_path.with_suffix(".meta.json"))


def _is_annotated_candidate(video_path: Path) -> bool:
    if any(sidecar.exists() for sidecar in _annotated_sidecar_paths(video_path)):
        return True
    stem = video_path.stem.lower()
    return "annotated" in stem or stem.endswith("_demo")


def _default_video_path() -> Path | None:
    if not VIDEOS_DIR.exists():
        return None
    preferred = VIDEOS_DIR / "default_annotated.mp4"
    if preferred.exists():
        return preferred
    files = [
        candidate for candidate in sorted(VIDEOS_DIR.iterdir())
        if candidate.is_file() and candidate.suffix.lower() in {".mp4", ".mov", ".avi", ".mkv"}
    ]
    for candidate in files:
        if _is_annotated_candidate(candidate):
            return candidate
    for candidate in files:
        if candidate.suffix.lower() == ".mp4":
            return candidate
    for candidate in files:
        return candidate
    return None


def _default_video_metadata(video_path: Path) -> dict:
    base_payload = {
        "job_id": "default-library-video",
        "status": "complete",
        "progress": 1.0,
        "frame_idx": 0,
        "total_frames": 0,
        "duration_sec": 0.0,
        "counts": {"car": 0, "truck": 0, "bus": 0, "motorcycle": 0},
        "is_default": True,
        "title": video_path.stem,
        "result_url": "/api/detection/default/video",
    }
    for meta_path in _annotated_sidecar_paths(video_path):
        if not meta_path.exists():
            continue
        try:
            with meta_path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            return {**base_payload, **payload}
        except (OSError, json.JSONDecodeError):
            continue
    return base_payload


def _job_output_path(job_id: str) -> Path:
    return OUTPUT_DIR / f"{job_id}_annotated.mp4"


def _job_output_metadata(job_id: str, output_path: Path) -> dict:
    payload = {
        "job_id": job_id,
        "status": "complete",
        "progress": 1.0,
        "frame_idx": 0,
        "total_frames": 0,
        "duration_sec": 0.0,
        "counts": {"car": 0, "truck": 0, "bus": 0, "motorcycle": 0},
        "result_url": f"/api/detection/result/{job_id}",
        "output_path": str(output_path),
    }
    for meta_path in _annotated_sidecar_paths(output_path):
        if not meta_path.exists():
            continue
        try:
            with meta_path.open("r", encoding="utf-8") as handle:
                stored = json.load(handle)
            return {**payload, **stored, "job_id": job_id, "status": "complete", "result_url": f"/api/detection/result/{job_id}"}
        except (OSError, json.JSONDecodeError):
            continue
    return payload


def build_router(worker) -> APIRouter:
    router = APIRouter(prefix="/detection", tags=["detection"])

    @router.post("/upload")
    async def upload(video: UploadFile = File(...), _=Depends(require_admin)) -> dict:
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        original_name = video.filename or "upload.mp4"
        suffix = Path(original_name).suffix.lower()
        if suffix not in ALLOWED_VIDEO_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Unsupported video format")
        job_id = uuid.uuid4().hex[:10]
        dest = os.path.join(UPLOAD_DIR, f"{job_id}{suffix}")
        total_bytes = 0
        try:
            with open(dest, "wb") as f:
                while True:
                    chunk = await video.read(1024 * 1024)
                    if not chunk:
                        break
                    total_bytes += len(chunk)
                    if total_bytes > MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail="Video exceeds 200MB limit")
                    f.write(chunk)
        finally:
            await video.close()

        try:
            worker.submit_job(job_id=job_id, video_path=dest)
        except RuntimeError as exc:
            Path(dest).unlink(missing_ok=True)
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"job_id": job_id}

    @router.get("/status/{job_id}")
    async def status(job_id: str, _=Depends(require_admin)) -> JSONResponse:
        st = worker.get_status(job_id)
        if st is None:
            output_path = _job_output_path(job_id)
            if output_path.exists():
                return JSONResponse(_job_output_metadata(job_id, output_path))
        if st is None:
            raise HTTPException(status_code=404, detail="job not found")
        payload = st.to_dict()
        if st.status == "complete" and st.output_path:
            payload["result_url"] = f"/api/detection/result/{job_id}"
        return JSONResponse(payload)

    @router.get("/result/{job_id}")
    async def result(job_id: str, _=Depends(require_admin)):
        st = worker.get_status(job_id)
        if st is not None and st.status == "complete" and st.output_path and Path(st.output_path).exists():
            return FileResponse(st.output_path, media_type="video/mp4")

        output_path = _job_output_path(job_id)
        if output_path.exists():
            return FileResponse(output_path, media_type="video/mp4", filename=output_path.name)

        raise HTTPException(status_code=404, detail="result not ready")

    @router.get("/default")
    async def default_video() -> JSONResponse:
        video_path = _default_video_path()
        if video_path is None:
            raise HTTPException(status_code=404, detail="default video not found")
        return JSONResponse(_default_video_metadata(video_path))

    @router.get("/default/video")
    async def default_video_file():
        video_path = _default_video_path()
        if video_path is None:
            raise HTTPException(status_code=404, detail="default video not found")
        return FileResponse(video_path, media_type="video/mp4", filename=video_path.name)

    @router.delete("/reset")
    async def reset_detection(_=Depends(require_admin)) -> dict:
        worker.clear_jobs()
        db.clear_detection_state()
        return {"ok": True}

    return router
