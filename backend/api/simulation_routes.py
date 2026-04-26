"""REST routes for simulation state, control, preemption, and config."""
from __future__ import annotations

from fastapi import APIRouter, Depends

import config_runtime as cfg
from auth.middleware import require_admin, require_any_auth
from models.schemas import (
    AlertRecord,
    ConfigUpdate,
    PreemptCommand,
    SimulationControlCommand,
    SimulationTickState,
)


def build_router(engine) -> APIRouter:
    router = APIRouter(prefix="/simulation", tags=["simulation"])

    @router.get("/state", response_model=SimulationTickState)
    async def get_state(_=Depends(require_any_auth)) -> SimulationTickState:
        return engine.get_current_state()

    @router.post("/control")
    async def post_control(
        cmd: SimulationControlCommand, _=Depends(require_admin)
    ) -> dict:
        if cmd.action == "pause":
            engine.pause()
        elif cmd.action == "start_run":
            engine.start_run()
        elif cmd.action == "resume":
            engine.resume()
        elif cmd.action == "reset":
            engine.reset()
        elif cmd.action == "set_mode" and cmd.intersection_id and cmd.mode is not None:
            engine.set_mode(cmd.intersection_id, cmd.mode)
        elif cmd.action == "set_network_mode" and cmd.mode is not None:
            engine.set_network_mode(cmd.mode)
        elif cmd.action == "set_scenario" and cmd.scenario:
            engine.set_scenario(cmd.scenario)
        return {"ok": True, "action": cmd.action}

    @router.post("/preempt")
    async def post_preempt(cmd: PreemptCommand, _=Depends(require_admin)) -> dict:
        engine.trigger_preemption(cmd.intersection_id, cmd.approach)
        return {"ok": True, "intersection_id": cmd.intersection_id, "approach": cmd.approach}

    @router.get("/config")
    async def get_config(_=Depends(require_any_auth)) -> dict:
        return cfg.snapshot()

    @router.post("/config")
    async def post_config(body: ConfigUpdate, _=Depends(require_admin)) -> dict:
        applied = engine.set_config(body.model_dump(exclude_none=True))
        return {"applied": applied}

    @router.get("/alerts", response_model=list[AlertRecord])
    async def get_alerts(_=Depends(require_any_auth)) -> list[AlertRecord]:
        return [AlertRecord(**row) for row in engine.get_alerts(limit=50)]

    @router.post("/alerts/clear")
    async def clear_alerts(_=Depends(require_admin)) -> dict:
        engine.clear_alerts()
        return {"cleared": True}

    return router
