"""Report generation utilities for analytics snapshots and downloads."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from html import escape
from statistics import mean
from typing import Iterable
from uuid import uuid4


def _safe_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _run_time(run: dict) -> datetime | None:
    return _timestamp(run.get("ran_at") or run.get("ended_at") or run.get("started_at"))


def _adaptive_runs(runs: Iterable[dict]) -> list[dict]:
    adaptive = [run for run in runs if run.get("mode") == "adaptive" and _safe_float(run.get("duration_ticks")) > 0]
    if adaptive:
        return adaptive
    return [run for run in runs if _safe_float(run.get("duration_ticks")) > 0]


def _period_bounds(label: str) -> tuple[datetime | None, datetime]:
    now = datetime.now().astimezone()
    if label == "24h":
        return now - timedelta(hours=24), now
    if label == "7d":
        return now - timedelta(days=7), now
    if label == "30d":
        return now - timedelta(days=30), now
    return None, now


def _peak_hours(runs: list[dict], junction_id: str | None = None) -> list[str]:
    hourly = defaultdict(list)
    for run in runs:
        run_dt = _run_time(run)
        if run_dt is None:
            continue
        hour_label = run_dt.strftime("%H:00")
        if junction_id is None:
            score = _safe_float(run.get("throughput_per_min")) + (_safe_float(run.get("avg_congestion")) * 1.5)
        else:
            metrics = (run.get("junction_metrics") or {}).get(junction_id) or {}
            score = _safe_float(metrics.get("vehicle_count")) + _safe_float(metrics.get("throughput_vpm")) + (_safe_float(metrics.get("spillback_events")) * 2.0)
        hourly[hour_label].append(score)
    ranked = sorted(
        ((hour, mean(values)) for hour, values in hourly.items()),
        key=lambda item: item[1],
        reverse=True,
    )
    return [hour for hour, _ in ranked[:3]]


def build_report(runs: list[dict], period_label: str = "7d") -> dict:
    completed = _adaptive_runs(runs)
    start, end = _period_bounds(period_label)
    filtered = []
    for run in completed:
        run_dt = _run_time(run)
        if run_dt is None:
            continue
        if start is not None and run_dt < start:
            continue
        if run_dt > end:
            continue
        filtered.append(run)

    if not filtered:
        filtered = completed

    if filtered:
        sorted_runs = sorted(filtered, key=lambda run: _run_time(run) or datetime.min)
        period_start = (_run_time(sorted_runs[0]) or datetime.now()).isoformat()
        period_end = (_run_time(sorted_runs[-1]) or datetime.now()).isoformat()
    else:
        now = datetime.now().astimezone().isoformat()
        period_start = now
        period_end = now
        sorted_runs = []

    avg_delay = mean([_safe_float(run.get("avg_wait_time")) for run in sorted_runs]) if sorted_runs else 0.0
    first_congestion = _safe_float(sorted_runs[0].get("avg_congestion")) if sorted_runs else 0.0
    last_congestion = _safe_float(sorted_runs[-1].get("avg_congestion")) if sorted_runs else 0.0
    congestion_increase = last_congestion - first_congestion
    network_peak_hours = _peak_hours(sorted_runs)

    all_junction_ids = sorted({
        junction_id
        for run in sorted_runs
        for junction_id in (run.get("junction_metrics") or {}).keys()
    })

    junctions: list[dict] = []
    for junction_id in all_junction_ids:
        metrics_list = [
            (run.get("junction_metrics") or {}).get(junction_id) or {}
            for run in sorted_runs
            if (run.get("junction_metrics") or {}).get(junction_id)
        ]
        if not metrics_list:
            continue
        junctions.append({
            "id": junction_id,
            "average_traffic": mean([
                _safe_float(metrics.get("vehicle_count")) or (
                    _safe_float(metrics.get("avg_ns_presence")) + _safe_float(metrics.get("avg_ew_presence"))
                )
                for metrics in metrics_list
            ]),
            "peak_hours": _peak_hours(sorted_runs, junction_id=junction_id),
            "average_wait": mean([_safe_float(metrics.get("avg_wait_time")) for metrics in metrics_list]),
            "average_throughput": mean([_safe_float(metrics.get("throughput_vpm")) for metrics in metrics_list]),
            "spillback_events": mean([_safe_float(metrics.get("spillback_events")) for metrics in metrics_list]),
        })

    trend_rows = []
    for index, run in enumerate(sorted_runs[-12:]):
        run_dt = _run_time(run)
        trend_rows.append({
            "label": run_dt.strftime("%d %b %H:%M") if run_dt else f"Run {index + 1}",
            "delay": _safe_float(run.get("avg_wait_time")),
            "congestion": _safe_float(run.get("avg_congestion")),
            "throughput": _safe_float(run.get("throughput_per_min")),
            "vehicles": _safe_float(run.get("vehicles_completed")),
        })

    generated_at = datetime.now().astimezone().isoformat()
    return {
        "report_id": uuid4().hex[:10],
        "generated_at": generated_at,
        "period": {
            "label": period_label,
            "start": period_start,
            "end": period_end,
        },
        "network": {
            "average_delay": round(avg_delay, 2),
            "congestion_increase": round(congestion_increase, 2),
            "peak_traffic_times": network_peak_hours,
        },
        "junctions": junctions,
        "trends": trend_rows,
    }


def build_report_html(report: dict) -> str:
    title = f"Rwendo Report {escape(report['report_id'])}"
    peak_times = ", ".join(report["network"].get("peak_traffic_times") or ["N/A"])
    trend_rows = "".join(
        f"<tr><td>{escape(row['label'])}</td><td>{row['delay']:.1f}s</td><td>{row['congestion']:.1f}</td><td>{row['throughput']:.1f} veh/min</td><td>{row['vehicles']:.0f}</td></tr>"
        for row in report.get("trends", [])
    )
    junction_rows = "".join(
        f"<tr><td>{escape(row['id'])}</td><td>{row['average_traffic']:.1f}</td><td>{escape(', '.join(row.get('peak_hours') or ['N/A']))}</td><td>{row['average_wait']:.1f}s</td><td>{row['average_throughput']:.1f} veh/min</td><td>{row['spillback_events']:.1f}</td></tr>"
        for row in report.get("junctions", [])
    )
    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>{title}</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 32px; color: #0f172a; }}
    h1, h2 {{ margin-bottom: 8px; }}
    .meta, .cards {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin: 20px 0; }}
    .card {{ border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; background: #fff; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 16px; }}
    th, td {{ border-bottom: 1px solid #e2e8f0; padding: 10px; text-align: left; font-size: 14px; }}
    th {{ color: #475569; }}
  </style>
</head>
<body>
  <h1>{title}</h1>
  <div>Generated: {escape(report['generated_at'])}</div>
  <div>Period: {escape(report['period']['start'])} to {escape(report['period']['end'])}</div>
  <div class="cards">
    <div class="card"><strong>Average Delay</strong><br />{report['network']['average_delay']:.1f}s</div>
    <div class="card"><strong>Congestion Increase</strong><br />{report['network']['congestion_increase']:.1f}</div>
    <div class="card"><strong>Peak Traffic Times</strong><br />{escape(peak_times)}</div>
  </div>
  <h2>Network Trend</h2>
  <table>
    <thead><tr><th>Run</th><th>Delay</th><th>Congestion</th><th>Throughput</th><th>Vehicles</th></tr></thead>
    <tbody>{trend_rows}</tbody>
  </table>
  <h2>Per Junction</h2>
  <table>
    <thead><tr><th>Junction</th><th>Average Traffic</th><th>Peak Hours</th><th>Average Wait</th><th>Average Throughput</th><th>Spillback</th></tr></thead>
    <tbody>{junction_rows}</tbody>
  </table>
</body>
</html>"""
