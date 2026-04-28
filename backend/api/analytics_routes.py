"""REST routes for simulation analytics — reads from SQLite for persistence."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse

import analytics_ml
import analytics_reports
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

    @router.get("/predictions")
    async def predictions(_=Depends(require_any_auth)) -> dict:
        runs = db.get_all_runs()
        live = engine.get_live_run_summary()
        if live is not None:
            live_row = live.model_dump()
            live_row["mode"] = live.mode.value
            runs = [live_row, *[run for run in runs if run.get("run_id") != live.run_id]]
        return analytics_ml.build_predictions(runs, engine.get_current_state())

    @router.get("/reports")
    async def list_reports(_=Depends(require_any_auth)) -> list[dict]:
        return db.get_all_reports()

    @router.post("/reports/generate")
    async def generate_report(period_label: str = "7d", _=Depends(require_any_auth)) -> dict:
        runs = db.get_all_runs()
        live = engine.get_live_run_summary()
        if live is not None:
            live_row = live.model_dump()
            live_row["mode"] = live.mode.value
            runs = [live_row, *[run for run in runs if run.get("run_id") != live.run_id]]
        report = analytics_reports.build_report(runs, period_label=period_label)
        db.save_report(report)
        return report

    @router.get("/reports/{report_id}")
    async def get_report(report_id: str, _=Depends(require_any_auth)) -> dict:
        report = db.get_report(report_id)
        if not report:
            return {"error": "Report not found"}
        return report

    @router.get("/reports/{report_id}/download", response_class=HTMLResponse)
    async def download_report(report_id: str, _=Depends(require_any_auth)) -> HTMLResponse:
        report = db.get_report(report_id)
        if not report:
            return HTMLResponse("<h1>Report not found</h1>", status_code=404)
        html = analytics_reports.build_report_html(report)
        return HTMLResponse(
            content=html,
            headers={
                "Content-Disposition": f"attachment; filename=rwendo-report-{report_id}.html"
            },
        )

    return router
