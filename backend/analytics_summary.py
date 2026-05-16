"""Adaptive-history analytics derived from stored simulation runs."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Iterable


def safe_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def safe_int(value, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def run_time(run: dict) -> datetime | None:
    return timestamp(run.get("ran_at") or run.get("ended_at") or run.get("started_at"))


def avg_wait_time(run: dict) -> float:
    return safe_float(
        run.get("avg_wait_time"),
        safe_float(run.get("avg_wait_time_adaptive")) or safe_float(run.get("avg_wait_time_fixed")),
    )


def avg_queue_length(run: dict) -> float:
    explicit = run.get("avg_queue_length")
    if explicit is not None:
        return safe_float(explicit)

    junction_metrics = run.get("junction_metrics") or {}
    return round(sum(
        safe_float(metrics.get("avg_ns_queue")) + safe_float(metrics.get("avg_ew_queue"))
        for metrics in junction_metrics.values()
    ), 2)


def completed_runs(runs: Iterable[dict]) -> list[dict]:
    return [
        run for run in runs
        if safe_int(run.get("duration_ticks")) > 0 and bool(run.get("ended_at"))
    ]


def adaptive_runs(runs: Iterable[dict]) -> list[dict]:
    adaptive = [run for run in completed_runs(runs) if run.get("mode") == "adaptive"]
    fallback = datetime.min.replace(tzinfo=timezone.utc)
    return sorted(adaptive, key=lambda run: run_time(run) or fallback, reverse=True)


def period_bounds(label: str) -> tuple[datetime | None, datetime]:
    now = datetime.now().astimezone()
    if label == "24h":
        return now - timedelta(hours=24), now
    if label == "7d":
        return now - timedelta(days=7), now
    if label == "30d":
        return now - timedelta(days=30), now
    return None, now


def filter_runs_for_period(runs: Iterable[dict], period_label: str = "7d") -> list[dict]:
    ordered = adaptive_runs(runs)
    start, end = period_bounds(period_label)
    filtered: list[dict] = []
    for run in ordered:
        dt = run_time(run)
        if dt is None:
            continue
        if start is not None and dt < start:
            continue
        if dt > end:
            continue
        filtered.append(run)
    return filtered or ordered


def _average(runs: list[dict], extractor) -> float:
    if not runs:
        return 0.0
    return round(mean(extractor(run) for run in runs), 2)


def _hour_buckets(runs: list[dict], extractor) -> list[str]:
    hourly: dict[str, list[float]] = defaultdict(list)
    for run in runs:
        dt = run_time(run)
        if dt is None:
            continue
        hourly[dt.strftime("%H:00")].append(extractor(run))
    return [hour for hour, _ in sorted(
        ((hour, mean(values)) for hour, values in hourly.items()),
        key=lambda item: item[1],
        reverse=True,
    )]


def _low_hour_buckets(runs: list[dict], extractor) -> list[str]:
    hourly: dict[str, list[float]] = defaultdict(list)
    for run in runs:
        dt = run_time(run)
        if dt is None:
            continue
        hourly[dt.strftime("%H:00")].append(extractor(run))
    return [hour for hour, _ in sorted(
        ((hour, mean(values)) for hour, values in hourly.items()),
        key=lambda item: item[1],
    )]


def summarize_runs(runs: Iterable[dict]) -> dict:
    adaptive = adaptive_runs(runs)
    latest = adaptive[0] if adaptive else None
    ordered_for_trends = list(reversed(adaptive[-12:])) if adaptive else []

    peak_hours = _hour_buckets(adaptive, lambda run: safe_float(run.get("throughput_per_min")))
    low_volume_hours = _low_hour_buckets(adaptive, lambda run: safe_float(run.get("throughput_per_min")))

    trend_rows = [{
        "label": f"Run {index + 1}",
        "recorded_at": run.get("ran_at") or run.get("ended_at") or run.get("started_at"),
        "scenario": run.get("scenario") or "off_peak",
        "avg_wait_time": avg_wait_time(run),
        "throughput_per_min": safe_float(run.get("throughput_per_min")),
        "avg_queue_length": avg_queue_length(run),
        "spillback_events": safe_float(run.get("spillback_events")),
        "preemption_events": safe_float(run.get("preemption_events")),
        "green_wave_success_rate": round(safe_float(run.get("green_wave_success_rate")) * 100.0, 2),
    } for index, run in enumerate(ordered_for_trends)]

    history_rows = [{
        "run_id": run.get("run_id"),
        "recorded_at": run.get("ran_at") or run.get("ended_at") or run.get("started_at"),
        "scenario": run.get("scenario") or "off_peak",
        "avg_wait_time": avg_wait_time(run),
        "throughput_per_min": safe_float(run.get("throughput_per_min")),
        "avg_queue_length": avg_queue_length(run),
        "spillback_events": safe_int(run.get("spillback_events")),
        "preemption_events": safe_int(run.get("preemption_events")),
        "green_wave_success_rate": round(safe_float(run.get("green_wave_success_rate")) * 100.0, 2),
        "vehicles_completed": safe_int(run.get("vehicles_completed")),
    } for run in adaptive[:12]]

    return {
        "adaptive_run_count": len(adaptive),
        "latest_run": latest,
        "averages": {
            "avg_wait_time": _average(adaptive, avg_wait_time),
            "throughput_per_min": _average(adaptive, lambda run: safe_float(run.get("throughput_per_min"))),
            "avg_queue_length": _average(adaptive, avg_queue_length),
            "spillback_frequency": _average(adaptive, lambda run: safe_float(run.get("spillback_events"))),
            "emergency_preemptions": _average(adaptive, lambda run: safe_float(run.get("preemption_events"))),
            "green_wave_success_rate": _average(adaptive, lambda run: safe_float(run.get("green_wave_success_rate")) * 100.0),
        },
        "peak_traffic_hours": peak_hours[:3],
        "low_volume_periods": low_volume_hours[:3],
        "trend_rows": trend_rows,
        "history_rows": history_rows,
    }
