from __future__ import annotations

import json
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from detection.annotator import run_detection


VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}


def find_source_video(videos_dir: Path) -> Path:
    candidates = [
        path for path in sorted(videos_dir.iterdir())
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS and "annotated" not in path.stem.lower()
    ]
    if not candidates:
        raise FileNotFoundError(f"No source video found in {videos_dir}")
    return candidates[0]


def main() -> None:
    videos_dir = Path(__file__).resolve().parents[1] / "videos"
    source = find_source_video(videos_dir)
    output = source.with_name(f"{source.stem}_annotated.mp4")
    metadata_path = output.with_suffix(".meta.json")

    print(f"Source: {source}")
    print(f"Output: {output}")

    output_path, counts, total_frames, duration_sec = run_detection(
        str(source),
        str(output),
    )

    metadata = {
        "job_id": "default-library-video",
        "status": "complete",
        "progress": 1.0,
        "frame_idx": total_frames,
        "total_frames": total_frames,
        "duration_sec": duration_sec,
        "counts": counts,
        "is_default": True,
        "title": "Bundled annotated traffic demo",
        "result_url": "/api/detection/default/video",
        "source_name": source.name,
        "output_name": Path(output_path).name,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print(f"Metadata: {metadata_path}")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
