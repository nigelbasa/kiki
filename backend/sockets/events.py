"""Socket.IO event handlers for simulation control and tick broadcast."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import analytics_ml
import db
from models.schemas import (
    PreemptCommand,
    SignalMode,
    SimulationControlCommand,
    SimulationTickState,
)

log = logging.getLogger("rwendo.sockets")


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
    live = engine.get_live_run_summary()
    if live is not None:
        live_row = live.model_dump()
        live_row["mode"] = live.mode.value
        runs = [live_row, *[run for run in runs if run.get("run_id") != live.run_id]]
    adaptive_runs = [
        run for run in runs
        if run.get("mode") == "adaptive" and int(run.get("duration_ticks") or 0) > 0
    ]
    return {
        "runs": adaptive_runs,
        "predictions": analytics_ml.build_predictions(runs, engine.get_current_state()),
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


def make_broadcast_fn(sio, engine):
    seen_alerts: set[str] = set()

    async def broadcast_tick(state: SimulationTickState) -> None:
        await sio.emit("simulation:tick", state.model_dump())
        await sio.emit("analytics:update", _analytics_payload(engine))
        nonlocal seen_alerts
        current_alerts = set(state.alerts)
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
