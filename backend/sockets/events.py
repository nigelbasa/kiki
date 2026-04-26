"""Socket.IO event handlers for simulation control and tick broadcast."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

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

    @sio.on("simulation:preempt")
    async def on_preempt(sid, data):  # noqa: ARG001
        cmd = PreemptCommand.model_validate(data)
        engine.trigger_preemption(cmd.intersection_id, cmd.approach)
        await sio.emit("simulation:tick", engine.get_current_state().model_dump())


def make_broadcast_fn(sio):
    seen_alerts: set[str] = set()

    async def broadcast_tick(state: SimulationTickState) -> None:
        await sio.emit("simulation:tick", state.model_dump())
        nonlocal seen_alerts
        current_alerts = set(state.alerts)
        new_alerts = [message for message in state.alerts if message not in seen_alerts]
        for message in new_alerts:
            await sio.emit(
                "simulation:alert",
                {
                    "timestamp": _now_iso(),
                    "message": message,
                    "level": _alert_level(message),
                },
            )
        seen_alerts = current_alerts
    return broadcast_tick
