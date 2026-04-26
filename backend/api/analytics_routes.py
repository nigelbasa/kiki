"""REST routes for simulation analytics — reads from SQLite for persistence."""
from __future__ import annotations

from fastapi import APIRouter, Depends

import db
from auth.middleware import require_any_auth


def build_router(engine) -> APIRouter:
    router = APIRouter(prefix="/analytics", tags=["analytics"])

    @router.get("/runs")
    async def list_runs(_=Depends(require_any_auth)) -> list[dict]:
        """Return all runs from SQLite, newest first."""
        runs = db.get_all_runs()
        live = engine.get_live_run_summary()
        if live is not None:
            live_row = live.model_dump()
            live_row["mode"] = live.mode.value
            runs = [live_row, *[run for run in runs if run.get("run_id") != live.run_id]]
        if runs:
            return runs
        return [r.model_dump() for r in engine.get_run_history()]

    @router.get("/runs/{run_id}")
    async def get_run(run_id: str, _=Depends(require_any_auth)) -> dict:
        """Return a single run with its tick snapshots for detailed analysis."""
        run = db.get_run(run_id)
        if not run:
            return {"error": "Run not found"}
        snapshots = db.get_tick_snapshots(run_id)
        return {"run": run, "snapshots": snapshots}

    @router.get("/compare")
    async def compare_runs(
        run_a: str, run_b: str, _=Depends(require_any_auth)
    ) -> dict:
        """Side-by-side comparison of two runs with their tick snapshots."""
        a = db.get_run(run_a)
        b = db.get_run(run_b)
        if not a or not b:
            return {"error": "One or both runs not found"}
        return {
            "run_a": {**a, "snapshots": db.get_tick_snapshots(run_a)},
            "run_b": {**b, "snapshots": db.get_tick_snapshots(run_b)},
        }

    return router
