"""YOLOv11 detection + annotation over an input video."""
from __future__ import annotations

from typing import Callable, Optional


TARGET_CLASSES = [2, 3, 5, 7]
CLASS_NAMES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
CLASS_LABELS = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
CLASS_COLORS_BGR = {
    2: (128, 222, 74),
    3: (250, 139, 167),
    5: (35, 146, 251),
    7: (113, 113, 248),
}

ProgressCallback = Callable[[int, int], None]


def _draw_label(cv2, frame, text: str, x: int, y: int, color: tuple[int, int, int]) -> None:
    (text_width, text_height), baseline = cv2.getTextSize(
        text,
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        1,
    )
    top = max(0, y - text_height - baseline - 8)
    cv2.rectangle(
        frame,
        (x, top),
        (x + text_width + 8, top + text_height + baseline + 6),
        color,
        -1,
    )
    cv2.putText(
        frame,
        text,
        (x + 4, top + text_height + 1),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        (255, 255, 255),
        1,
        cv2.LINE_AA,
    )


def _draw_hud(cv2, frame, counts: dict[str, int], frame_idx: int, total_frames: int) -> None:
    overlay = frame.copy()
    cv2.rectangle(overlay, (14, 14), (196, 124), (0, 0, 0), -1)
    frame[:] = cv2.addWeighted(overlay, 0.6, frame, 0.4, 0)

    lines = [
        "Rwendo Detection",
        f"Cars:    {counts['car']}",
        f"Trucks:  {counts['truck']}",
        f"Buses:   {counts['bus']}",
        f"Motos:   {counts['motorcycle']}",
        f"Frame: {frame_idx}/{total_frames}",
    ]

    y = 34
    for line in lines:
        cv2.putText(
            frame,
            line,
            (24, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )
        y += 16


def _make_writer(cv2, output_path: str, fps: float, size: tuple[int, int]):
    for codec in ("avc1", "mp4v"):
        writer = cv2.VideoWriter(output_path, cv2.VideoWriter_fourcc(*codec), fps, size)
        if writer.isOpened():
            return writer
        writer.release()
    raise RuntimeError("cannot open annotated video writer")


def run_detection(
    video_path: str,
    output_path: str,
    progress_callback: Optional[ProgressCallback] = None,
    model_weights: str = "yolo11n.pt",
) -> tuple[str, dict[str, int], int, float]:
    """Process a video, annotate detections, and return the output summary."""
    import cv2
    import numpy as np
    from ultralytics import YOLO

    model = YOLO(model_weights)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    writer = _make_writer(cv2, output_path, fps, (width, height))

    frame_idx = 0
    total_counts = {"car": 0, "truck": 0, "bus": 0, "motorcycle": 0}
    seen_tracks = {"car": set(), "truck": set(), "bus": set(), "motorcycle": set()}

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            results = model.track(
                frame,
                classes=TARGET_CLASSES,
                conf=0.4,
                iou=0.45,
                tracker="bytetrack.yaml",
                persist=True,
                verbose=False,
            )
            frame_counts = {"car": 0, "truck": 0, "bus": 0, "motorcycle": 0}

            r0 = results[0] if results else None
            if r0 is not None and r0.boxes is not None:
                for box in r0.boxes:
                    xyxy = (
                        box.xyxy[0].cpu().numpy()
                        if hasattr(box.xyxy, "cpu")
                        else np.array(box.xyxy[0])
                    )
                    cls = int(box.cls[0].item()) if hasattr(box.cls, "cpu") else int(box.cls[0])
                    conf = (
                        float(box.conf[0].item())
                        if hasattr(box.conf, "cpu")
                        else float(box.conf[0])
                    )
                    x1, y1, x2, y2 = [int(value) for value in xyxy]

                    color = CLASS_COLORS_BGR.get(cls, (255, 255, 255))
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

                    class_name = CLASS_NAMES.get(cls, str(cls))
                    frame_counts[class_name] += 1
                    track_id = None
                    if getattr(box, "id", None) is not None:
                        try:
                            track_id = int(box.id[0].item()) if hasattr(box.id, "cpu") else int(box.id[0])
                        except Exception:
                            track_id = None
                    if track_id is not None:
                        seen_tracks[class_name].add(track_id)
                        total_counts[class_name] = len(seen_tracks[class_name])
                    else:
                        total_counts[class_name] = max(total_counts[class_name], frame_counts[class_name])

                    label = f"{CLASS_LABELS.get(cls, class_name)} {conf:.2f}"
                    _draw_label(cv2, frame, label, x1, y1, color)

            _draw_hud(cv2, frame, frame_counts, frame_idx + 1, total_frames)
            writer.write(frame)

            frame_idx += 1
            if progress_callback is not None:
                try:
                    progress_callback(frame_idx, total_frames)
                except Exception:
                    pass
    finally:
        cap.release()
        writer.release()

    duration_sec = round(total_frames / fps, 2) if fps else 0.0
    return output_path, total_counts, total_frames, duration_sec
