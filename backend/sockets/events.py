"""Socket.IO event handlers for simulation control and tick broadcast."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

import analytics_summary
import db
from models.schemas import (
    PreemptCommand,
    SignalMode,
    SimulationControlCommand,
    SimulationTickState,
)

log = logging.getLogger("rwendo.sockets")

# Throttle analytics:update broadcasts. Recomputing the summary from SQLite
# on every tick (10 Hz) is the wrong order of magnitude — the analytics page
# only displays per-completed-run aggregates, which change at most once per
# run. 1 Hz is plenty and removes a measurable engine-loop overhead.
_ANALYTICS_BROADCAST_INTERVAL_SECONDS = 1.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _alert_level(message: str) -> str:
    lower = message.lower()
    if "emergency" in lower or "preemption" in lower:
        return "critical"
    if "spillback" in lower:
        return "warning"
    return "info"


def _alert_category(message: str) -> str:
    lower = message.lower()
    if "spillback" in lower:
        return "spillback"
    if "emergency" in lower:
        return "emergency"
    if "congestion" in lower:
        return "congestion"
    return "general"


def _alert_title(message: str) -> str:
    category = _alert_category(message)
    if category == "spillback":
        return "Spillback Alert"
    if category == "emergency":
        return "Emergency Alert"
    if category == "congestion":
        return "Congestion Alert"
    return "Traffic Alert"


def _analytics_payload(engine) -> dict:
    runs = db.get_all_runs()
    adaptive_runs = analytics_summary.adaptive_runs(runs)
    return {
        "runs": adaptive_runs,
        "summary": analytics_summary.summarize_runs(runs),
    }


def register(sio, engine) -> None:
    """Wire up handlers. Called from main.py once sio and engine exist."""

    @sio.event
    async def connect(sid, environ, auth=None):  # noqa: ARG001
        log.info("client connected: %s", sid)
        await sio.emit(
            "simulation:tick",
            engine.get_current_state().model_dump(),
            to=sid,
        )
        await sio.emit("analytics:update", _analytics_payload(engine), to=sid)

    @sio.event
    async def disconnect(sid):
        log.info("client disconnected: %s", sid)

    @sio.on("simulation:command")
    async def on_command(sid, data):  # noqa: ARG001
        cmd = SimulationControlCommand.model_validate(data)
        if cmd.action == "pause":
            engine.pause()
        elif cmd.action == "start_run":
            engine.start_run()
        elif cmd.action == "resume":
            engine.resume()
        elif cmd.action == "reset":
            engine.reset()
        elif cmd.action == "stop_run":
            engine.stop_run()
        elif cmd.action == "set_mode":
            if cmd.intersection_id and cmd.mode is not None:
                engine.set_mode(cmd.intersection_id, SignalMode(cmd.mode))
        elif cmd.action == "set_network_mode":
            if cmd.mode is not None:
                engine.set_network_mode(SignalMode(cmd.mode))
        elif cmd.action == "set_scenario":
            if cmd.scenario:
                engine.set_scenario(cmd.scenario)
        await sio.emit("simulation:tick", engine.get_current_state().model_dump())
        await sio.emit("analytics:update", _analytics_payload(engine))

    @sio.on("simulation:preempt")
    async def on_preempt(sid, data):  # noqa: ARG001
        cmd = PreemptCommand.model_validate(data)
        engine.trigger_preemption(cmd.intersection_id, cmd.approach)
        await sio.emit("simulation:tick", engine.get_current_state().model_dump())
        await sio.emit("analytics:update", _analytics_payload(engine))

    @sio.on("simulation:spawn_emergency")
    async def on_spawn_emergency(sid, data):  # noqa: ARG001
        cmd = PreemptCommand.model_validate(data)
        engine.spawn_emergency_vehicle(cmd.intersection_id, cmd.approach)
        await sio.emit("simulation:tick", engine.get_current_state().model_dump())

    @sio.on("simulation:spawn_emergency_random")
    async def on_spawn_random(sid, _data):  # noqa: ARG001
        target = engine.spawn_random_emergency()
        await sio.emit("simulation:tick", engine.get_current_state().model_dump())
        await sio.emit("simulation:emergency_spawned", target)


def make_broadcast_fn(sio, engine):
    seen_alerts: set[str] = set()
    last_analytics_emit = 0.0
    prev_run_count = 0

    async def broadcast_tick(state: SimulationTickState) -> None:
        nonlocal seen_alerts, last_analytics_emit, prev_run_count

        # simulation:tick is the hot path — emit every tick, no DB work.
        await sio.emit("simulation:tick", state.model_dump())

        # analytics:update is the cold path. Recompute at most once per
        # _ANALYTICS_BROADCAST_INTERVAL_SECONDS, OR immediately when a run
        # completes (so the run-history tables refresh promptly).
        now = time.monotonic()
        run_count = len(engine.run_history)
        run_completed = run_count > prev_run_count
        prev_run_count = run_count
        if run_completed or now - last_analytics_emit >= _ANALYTICS_BROADCAST_INTERVAL_SECONDS:
            await sio.emit("analytics:update", _analytics_payload(engine))
            last_analytics_emit = now

        current_alerts = set(state.alerts)
        if state.current_mode != SignalMode.ADAPTIVE:
            seen_alerts = current_alerts
            return
        new_alerts = [message for message in state.alerts if message not in seen_alerts]
        for message in new_alerts:
            await sio.emit(
                "simulation:alert",
                {
                    "timestamp": _now_iso(),
                    "title": _alert_title(message),
                    "category": _alert_category(message),
                    "message": message,
                    "level": _alert_level(message),
                },
            )
        seen_alerts = current_alerts
    return broadcast_tick
