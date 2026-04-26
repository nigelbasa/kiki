"""FastAPI + Socket.IO entry point. Owns the SimulationEngine and DetectionWorker singletons."""
from __future__ import annotations

import asyncio
import logging
import os

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import db
from api import analytics_routes, detection_routes, simulation_routes
from auth import routes as auth_routes, store as auth_store
from detection.worker import DetectionWorker
from simulation.engine import SimulationEngine
from sockets.events import make_broadcast_fn, register as register_socket_events

logging.basicConfig(level=logging.INFO)

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
]

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=ALLOWED_ORIGINS)

engine = SimulationEngine()
detection_worker = DetectionWorker()

fastapi_app = FastAPI(title="Rwendo Backend")
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@fastapi_app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


fastapi_app.include_router(auth_routes.router, prefix="/api")
fastapi_app.include_router(simulation_routes.build_router(engine), prefix="/api")
fastapi_app.include_router(analytics_routes.build_router(engine), prefix="/api")
fastapi_app.include_router(detection_routes.build_router(detection_worker), prefix="/api")


async def _detection_progress(job_id: str, payload: dict) -> None:
    await sio.emit("detection:progress", payload)


async def _detection_complete(job_id: str, payload: dict) -> None:
    await sio.emit("detection:complete", payload)


@fastapi_app.on_event("startup")
async def _startup() -> None:
    # RUNTIME FIX: ensure upload/output directories exist before first request
    os.makedirs("/tmp/rwendo_uploads", exist_ok=True)
    os.makedirs("/tmp/rwendo_outputs", exist_ok=True)

    # Initialise SQLite database
    db.init_db()
    auth_store.seed_admin_user()

    register_socket_events(sio, engine)
    broadcast_fn = make_broadcast_fn(sio)
    loop = asyncio.get_running_loop()
    engine.start(broadcast_fn=broadcast_fn, loop=loop)
    detection_worker.configure(
        loop=loop,
        progress_emit=_detection_progress,
        complete_emit=_detection_complete,
    )


@fastapi_app.on_event("shutdown")
async def _shutdown() -> None:
    engine.stop()
    detection_worker.shutdown()


app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)
