"""Lightweight NumPy-based analytics predictions for the admin dashboard."""
from __future__ import annotations

from datetime import datetime
from math import cos, pi, sin
from typing import Iterable

import numpy as np


def _safe_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _timestamp_for_run(run: dict) -> datetime:
    raw = run.get("ran_at") or run.get("ended_at") or run.get("started_at")
    if not raw:
        return datetime.now()
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return datetime.now()


def _hour_encoding(dt: datetime) -> tuple[float, float]:
    angle = ((dt.hour + (dt.minute / 60.0)) / 24.0) * 2 * pi
    return sin(angle), cos(angle)


def _junction_metric_aggregate(metrics: dict | None, keys: Iterable[str]) -> float:
    data = metrics or {}
    return float(sum(_safe_float(data.get(key)) for key in keys))


def _run_presence_mean(run: dict) -> float:
    junctions = list((run.get("junction_metrics") or {}).values())
    if not junctions:
        return 0.0
    values = [
        _junction_metric_aggregate(metrics, ("avg_ns_presence", "avg_ew_presence"))
        for metrics in junctions
    ]
    return float(sum(values) / max(len(values), 1))


def _run_queue_mean(run: dict) -> float:
    junctions = list((run.get("junction_metrics") or {}).values())
    if not junctions:
        return 0.0
    values = [
        _junction_metric_aggregate(metrics, ("avg_ns_queue", "avg_ew_queue"))
        for metrics in junctions
    ]
    return float(sum(values) / max(len(values), 1))


def _run_avg_wait(run: dict) -> float:
    return _safe_float(
        run.get("avg_wait_time"),
        _safe_float(run.get("avg_wait_time_adaptive")) or _safe_float(run.get("avg_wait_time_fixed")),
    )


def _run_feature_vector(run: dict) -> list[float]:
    dt = _timestamp_for_run(run)
    hour_sin, hour_cos = _hour_encoding(dt)
    return [
        hour_sin,
        hour_cos,
        1.0 if run.get("scenario") == "peak" else 0.0,
        _safe_float(run.get("duration_ticks")) / 20.0 / 60.0,
        _run_avg_wait(run),
        _safe_float(run.get("throughput_per_min")),
        _safe_float(run.get("avg_congestion")),
        _safe_float(run.get("vehicles_completed")),
        _safe_float(run.get("spillback_events")),
        _safe_float(run.get("preemption_events")),
        _safe_float(run.get("green_wave_success_rate")) * 100.0,
        _run_presence_mean(run),
        _run_queue_mean(run),
    ]


def _state_feature_vector(state) -> list[float]:
    dt = datetime.now()
    hour_sin, hour_cos = _hour_encoding(dt)
    junctions = list((state.junction_metrics or {}).values())
    avg_presence = 0.0
    avg_queue = 0.0
    if junctions:
        avg_presence = float(sum((_safe_float(j.ns_presence) + _safe_float(j.ew_presence)) for j in junctions) / len(junctions))
        avg_queue = float(sum((_safe_float(j.ns_queue) + _safe_float(j.ew_queue)) for j in junctions) / len(junctions))
    return [
        hour_sin,
        hour_cos,
        1.0 if state.scenario == "peak" else 0.0,
        _safe_float(state.current_run_ticks) / 20.0 / 60.0,
        _safe_float(state.current_avg_wait_time),
        _safe_float(state.current_throughput_vpm),
        _safe_float(state.current_avg_congestion),
        _safe_float(state.vehicles_served_this_run),
        _safe_float(state.spillback_events),
        _safe_float(state.preemption_events),
        _safe_float(state.green_wave_success_rate) * 100.0,
        avg_presence,
        avg_queue,
    ]


def _junction_row(metrics: dict | None) -> dict[str, float]:
    data = metrics or {}
    return {
        "avg_wait_time": _safe_float(data.get("avg_wait_time")),
        "vehicle_count": _safe_float(data.get("vehicle_count")),
        "throughput_vpm": _safe_float(data.get("throughput_vpm")),
        "spillback_events": _safe_float(data.get("spillback_events")),
        "avg_queue": _junction_metric_aggregate(data, ("avg_ns_queue", "avg_ew_queue")),
        "avg_presence": _junction_metric_aggregate(data, ("avg_ns_presence", "avg_ew_presence")),
    }


def _junction_feature_vector(run: dict, junction_id: str) -> list[float]:
    dt = _timestamp_for_run(run)
    hour_sin, hour_cos = _hour_encoding(dt)
    row = _junction_row((run.get("junction_metrics") or {}).get(junction_id))
    return [
        hour_sin,
        hour_cos,
        1.0 if run.get("scenario") == "peak" else 0.0,
        _run_avg_wait(run),
        _safe_float(run.get("throughput_per_min")),
        _safe_float(run.get("avg_congestion")),
        _safe_float(run.get("spillback_events")),
        _safe_float(run.get("green_wave_success_rate")) * 100.0,
        row["avg_wait_time"],
        row["vehicle_count"],
        row["throughput_vpm"],
        row["spillback_events"],
        row["avg_queue"],
        row["avg_presence"],
    ]


def _state_junction_feature_vector(state, junction_id: str) -> list[float]:
    dt = datetime.now()
    hour_sin, hour_cos = _hour_encoding(dt)
    current = state.current_junction_comparison.get(junction_id)
    live = state.junction_metrics.get(junction_id)
    avg_queue = _safe_float(getattr(live, "ns_queue", 0.0)) + _safe_float(getattr(live, "ew_queue", 0.0))
    avg_presence = _safe_float(getattr(live, "ns_presence", 0.0)) + _safe_float(getattr(live, "ew_presence", 0.0))
    return [
        hour_sin,
        hour_cos,
        1.0 if state.scenario == "peak" else 0.0,
        _safe_float(state.current_avg_wait_time),
        _safe_float(state.current_throughput_vpm),
        _safe_float(state.current_avg_congestion),
        _safe_float(state.spillback_events),
        _safe_float(state.green_wave_success_rate) * 100.0,
        _safe_float(getattr(current, "avg_wait_time", 0.0)),
        _safe_float(getattr(current, "vehicle_count", 0.0)),
        _safe_float(getattr(current, "throughput_vpm", 0.0)),
        _safe_float(getattr(current, "spillback_events", 0.0)),
        avg_queue,
        avg_presence,
    ]


def _predict_value(samples: list[list[float]], targets: list[float], current: list[float], ridge: float = 0.75) -> float:
    if not samples or not targets:
        return 0.0
    if len(samples) == 1:
        return float(targets[0])

    x = np.asarray(samples, dtype=float)
    y = np.asarray(targets, dtype=float)
    mean = x.mean(axis=0)
    std = x.std(axis=0)
    std[std == 0.0] = 1.0
    x_scaled = (x - mean) / std
    current_scaled = (np.asarray(current, dtype=float) - mean) / std
    x_design = np.c_[np.ones(len(x_scaled)), x_scaled]
    current_design = np.r_[1.0, current_scaled]
    eye = np.eye(x_design.shape[1], dtype=float)
    eye[0, 0] = 0.0
    weights = np.linalg.pinv(x_design.T @ x_design + ridge * eye) @ x_design.T @ y
    return float(current_design @ weights)


def _predict_probability(samples: list[list[float]], labels: list[float], current: list[float]) -> float:
    return float(np.clip(_predict_value(samples, labels, current), 0.0, 1.0))


def _level_for_probability(probability: float) -> str:
    if probability >= 0.7:
        return "high"
    if probability >= 0.4:
        return "moderate"
    return "low"


def _level_for_score(value: float, baseline: list[float]) -> str:
    if not baseline:
        if value >= 20:
            return "high"
        if value >= 8:
            return "moderate"
        return "low"
    ordered = sorted(baseline)
    lower = ordered[max(0, int(len(ordered) * 0.33) - 1)]
    upper = ordered[max(0, int(len(ordered) * 0.66) - 1)]
    if value >= upper:
        return "high"
    if value >= lower:
        return "moderate"
    return "low"


def build_predictions(runs: list[dict], state) -> dict:
    completed = [run for run in runs if _safe_int(run.get("duration_ticks")) > 0]
    adaptive = [run for run in completed if run.get("mode") == "adaptive"]
    training_runs = adaptive if len(adaptive) >= 4 else completed

    run_samples = [_run_feature_vector(run) for run in training_runs]
    state_sample = _state_feature_vector(state)

    jam_labels = [
        1.0 if (_safe_float(run.get("avg_congestion")) >= 8.0 or _safe_int(run.get("spillback_events")) > 0) else 0.0
        for run in training_runs
    ]
    peak_labels = [
        1.0 if (run.get("scenario") == "peak" or _safe_float(run.get("avg_congestion")) >= 7.5) else 0.0
        for run in training_runs
    ]
    signal_targets = [
        _safe_float(run.get("throughput_per_min")) +
        (_run_presence_mean(run) * 0.9) +
        (_run_queue_mean(run) * 1.4)
        for run in training_runs
    ]
    emergency_targets = [
        _safe_float(run.get("avg_emergency_travel_time")) if _safe_float(run.get("avg_emergency_travel_time")) > 0
        else (_run_avg_wait(run) * 0.85) + (_safe_float(run.get("avg_congestion")) * 0.75)
        for run in training_runs
    ]
    green_wave_targets = [
        _safe_float(run.get("green_wave_success_rate")) * 100.0
        for run in training_runs
    ]

    jam_probability = _predict_probability(run_samples, jam_labels, state_sample)
    peak_probability = _predict_probability(run_samples, peak_labels, state_sample)
    signal_demand = max(0.0, _predict_value(run_samples, signal_targets, state_sample))
    emergency_time = max(0.0, _predict_value(run_samples, emergency_targets, state_sample))
    green_wave = float(np.clip(_predict_value(run_samples, green_wave_targets, state_sample), 0.0, 100.0))

    signal_baseline = [float(value) for value in signal_targets]
    emergency_baseline = [float(value) for value in emergency_targets]
    green_wave_baseline = [float(value) for value in green_wave_targets]

    junctions: list[dict] = []
    historical_runs = adaptive if adaptive else completed
    for intersection in state.intersections:
        junction_id = intersection.id
        run_metrics = [
            _junction_row((run.get("junction_metrics") or {}).get(junction_id))
            for run in historical_runs
            if (run.get("junction_metrics") or {}).get(junction_id)
        ]
        live_metrics = state.junction_metrics.get(junction_id)
        live_comparison = state.current_junction_comparison.get(junction_id)
        current_row = {
            "avg_wait_time": _safe_float(getattr(live_comparison, "avg_wait_time", 0.0)),
            "vehicle_count": _safe_float(getattr(live_comparison, "vehicle_count", 0.0)),
            "throughput_vpm": _safe_float(getattr(live_comparison, "throughput_vpm", 0.0)),
            "spillback_events": _safe_float(getattr(live_comparison, "spillback_events", 0.0)),
            "avg_queue": _safe_float(getattr(live_metrics, "ns_queue", 0.0)) + _safe_float(getattr(live_metrics, "ew_queue", 0.0)),
            "avg_presence": _safe_float(getattr(live_metrics, "ns_presence", 0.0)) + _safe_float(getattr(live_metrics, "ew_presence", 0.0)),
        }

        if run_metrics:
            history_row = {
                key: float(sum(item[key] for item in run_metrics) / len(run_metrics))
                for key in ("avg_wait_time", "vehicle_count", "throughput_vpm", "spillback_events", "avg_queue", "avg_presence")
            }
        else:
            history_row = dict(current_row)

        junction_samples = [
            _junction_feature_vector(run, junction_id)
            for run in historical_runs
            if (run.get("junction_metrics") or {}).get(junction_id)
        ]
        current_junction_sample = _state_junction_feature_vector(state, junction_id)
        junction_jam_labels = [
            1.0 if (row["spillback_events"] > 0 or row["avg_queue"] >= 8.0 or row["avg_wait_time"] >= 12.0) else 0.0
            for row in run_metrics
        ]
        junction_signal_targets = [
            row["vehicle_count"] + row["throughput_vpm"] + (row["avg_queue"] * 1.5) + (row["avg_presence"] * 0.8)
            for row in run_metrics
        ]

        jam_prob = _predict_probability(junction_samples, junction_jam_labels, current_junction_sample) if run_metrics else 0.0
        demand_score = max(0.0, _predict_value(junction_samples, junction_signal_targets, current_junction_sample)) if run_metrics else 0.0

        junctions.append({
            "id": junction_id,
            "name": intersection.name,
            "current": current_row,
            "history": history_row,
            "predictions": {
                "traffic_jam_risk": {
                    "probability": jam_prob,
                    "level": _level_for_probability(jam_prob),
                },
                "signal_demand": {
                    "score": demand_score,
                    "level": _level_for_score(demand_score, junction_signal_targets),
                },
            },
        })

    return {
        "sample_count": len(training_runs),
        "mode": "numpy-ridge",
        "network_predictions": {
            "traffic_jam_risk": {
                "probability": jam_probability,
                "level": _level_for_probability(jam_probability),
            },
            "peak_hour": {
                "probability": peak_probability,
                "level": _level_for_probability(peak_probability),
            },
            "signal_demand": {
                "score": signal_demand,
                "level": _level_for_score(signal_demand, signal_baseline),
            },
            "emergency_response_time": {
                "seconds": emergency_time,
                "level": _level_for_score(emergency_time, emergency_baseline),
            },
            "green_wave_stability": {
                "percent": green_wave,
                "level": "high" if green_wave >= 70 else "moderate" if green_wave >= 40 else "low",
            },
        },
        "junctions": junctions,
    }
