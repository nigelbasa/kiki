"""Discrete-time simulation loop running in a background thread."""
from __future__ import annotations

import asyncio
import random
import threading
import time
import uuid
from datetime import datetime, timezone
from traceback import format_exception_only
from typing import Awaitable, Callable, Optional

import config_runtime as cfg
import db
from models.schemas import JunctionComparisonState, JunctionMetricState, RunSummary, SignalMode, SimulationTickState
from simulation.sumo_network import SumoMetricsAccumulator, SumoNetwork
from simulation.vehicles import VehicleGenerator


BroadcastFn = Callable[[SimulationTickState], Awaitable[None]]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SimulationEngine:
    """Drives the active SUMO network forward at TICK_RATE_HZ and broadcasts each state."""

    def __init__(self) -> None:
        self.network: SumoNetwork = SumoNetwork()
        self.generator: VehicleGenerator = VehicleGenerator("off_peak")
        self.running: bool = False
        self.tick_count: int = 0
        self.scenario: str = "off_peak"
        self.run_history: list[RunSummary] = []

        self._metrics: SumoMetricsAccumulator = SumoMetricsAccumulator()
        self._run_id: str = uuid.uuid4().hex[:8]
        self._run_start: str = _now_iso()

        self._alert_log: list[dict] = []
        self._prev_alerts: set[str] = set()

        self._broadcast_fn: Optional[BroadcastFn] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._stop_flag: threading.Event = threading.Event()
        self._last_state: Optional[SimulationTickState] = None
        self._last_fixed_summary: Optional[RunSummary] = None
        self._current_run_seed: Optional[int] = None

    def _queue_network_command(self, fn) -> None:
        if hasattr(self.network, "queue_command"):
            self.network.queue_command(fn)
        else:
            fn()

    def _finalize_current_run(self) -> Optional[RunSummary]:
        if self._metrics.tick_count <= 0:
            return None

        summary = self._metrics.to_run_summary(
            run_id=self._run_id,
            started_at=self._run_start,
            scenario=self.scenario,
            mode=self.network.current_mode(),
            run_seed=self._current_run_seed,
        )
        self.run_history.append(summary)
        retention = cfg.get("RUNS_RETENTION")
        if len(self.run_history) > retention:
            self.run_history = self.run_history[-retention:]
        if summary.mode == SignalMode.FIXED:
            self._last_fixed_summary = summary

        self._persist_run_summary(summary, ended_at=_now_iso())

        return summary

    def _persist_run_summary(self, summary: RunSummary, ended_at: str = "") -> None:
        try:
            avg_wait = summary.avg_wait_time_adaptive if summary.mode == SignalMode.ADAPTIVE else summary.avg_wait_time_fixed
            db.save_run({
                "run_id": summary.run_id,
                "started_at": summary.started_at,
                "ended_at": ended_at,
                "ran_at": _now_iso(),
                "scenario": summary.scenario,
                "mode": summary.mode.value,
                "duration_ticks": summary.duration_ticks,
                "avg_wait_time": avg_wait,
                "total_wait_seconds": summary.total_wait_seconds,
                "throughput_per_min": summary.throughput_per_min,
                "avg_congestion": summary.avg_congestion,
                "vehicles_completed": summary.vehicles_completed,
                "emergency_vehicles_completed": summary.emergency_vehicles_completed,
                "avg_emergency_travel_time": summary.avg_emergency_travel_time,
                "spillback_events": summary.spillback_events,
                "preemption_events": summary.preemption_events,
                "green_wave_success_rate": summary.green_wave_success_rate,
                "junction_metrics": summary.junction_metrics,
                "run_seed": summary.run_seed,
            })
        except Exception:
            pass

    def get_live_run_summary(self) -> Optional[RunSummary]:
        if self._metrics.tick_count <= 0:
            return None
        return self._metrics.to_run_summary(
            run_id=self._run_id,
            started_at=self._run_start,
            scenario=self.scenario,
            mode=self.network.current_mode(),
            run_seed=self._current_run_seed,
        )

    def _next_run_seed(self, reuse_fixed_seed: bool = False) -> int:
        if reuse_fixed_seed and self._last_fixed_summary and self._last_fixed_summary.run_seed is not None:
            return int(self._last_fixed_summary.run_seed)
        return random.SystemRandom().randint(1, 2_147_483_647)

    def _prepare_run_seed(self, reuse_fixed_seed: bool = False) -> None:
        self._current_run_seed = self._next_run_seed(reuse_fixed_seed=reuse_fixed_seed)
        self.network.set_run_seed(self._current_run_seed)

    @staticmethod
    def _spillback_locations(state: SimulationTickState) -> list[str]:
        return [
            intersection.id
            for intersection in state.intersections
            if intersection.spillback_active
        ]

    @staticmethod
    def _network_summary(state: SimulationTickState, congestion_value: float) -> str:
        if any(intersection.spillback_active for intersection in state.intersections) or congestion_value >= 10:
            return "Heavy congestion"
        if congestion_value >= 4:
            return "Moderate traffic"
        return "Clear roads"

    @staticmethod
    def _junction_comparison_map(source: Optional[dict[str, dict[str, float]]]) -> dict[str, JunctionComparisonState]:
        result: dict[str, JunctionComparisonState] = {}
        for intersection_id, metrics in (source or {}).items():
            result[intersection_id] = JunctionComparisonState(
                avg_wait_time=float(metrics.get("avg_wait_time", 0.0)),
                vehicle_count=int(metrics.get("vehicle_count", 0)),
                throughput_vpm=float(metrics.get("throughput_vpm", 0.0)),
                spillback_events=int(metrics.get("spillback_events", 0)),
            )
        return result

    # ----------------------------------------------------------------- control
    def start(self, broadcast_fn: BroadcastFn, loop: asyncio.AbstractEventLoop) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._broadcast_fn = broadcast_fn
        self._loop = loop
        self._stop_flag.clear()
        self._thread = threading.Thread(target=self._run_loop, name="sim-engine", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_flag.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        # Tear SUMO down so uvicorn --reload doesn't orphan sumo.exe.
        try:
            self.network.close()
        except Exception:
            pass

    def pause(self) -> None:
        self.running = False
        self.network.running = False
        self._queue_network_command(self.network.pause)

    def start_run(self) -> None:
        if not self.network.started and self.tick_count == 0:
            reuse_fixed_seed = (
                self.network.current_mode() == SignalMode.ADAPTIVE and
                self._last_fixed_summary is not None and
                self._last_fixed_summary.scenario == self.scenario
            )
            self._prepare_run_seed(reuse_fixed_seed=reuse_fixed_seed)
        self.running = True
        self.network.running = True
        self.network.started = True
        self._queue_network_command(self.network.start_run)

    def resume(self) -> None:
        self.running = True
        self.network.running = True
        self._queue_network_command(self.network.resume)

    def reset(self) -> None:
        self._finalize_current_run()
        self._metrics.reset()
        self.clear_alerts()
        self.running = False
        self.network.running = False
        self.network.started = False
        self.tick_count = 0
        self._run_id = uuid.uuid4().hex[:8]
        self._run_start = _now_iso()
        self._current_run_seed = None
        self._last_state = None
        self._queue_network_command(self.network.reset)

    def set_mode(self, intersection_id: str, mode: SignalMode) -> None:
        self.network.get_intersection(intersection_id).set_mode(mode)
        self._queue_network_command(lambda: self.network.get_intersection(intersection_id).set_mode(mode))

    def set_network_mode(self, mode: SignalMode) -> None:
        if self.network.current_mode() == mode:
            return
        self._finalize_current_run()
        self._metrics.reset()
        self.clear_alerts()
        self.running = False
        self.network.running = False
        self.network.started = False
        self.tick_count = 0
        self._run_id = uuid.uuid4().hex[:8]
        self._run_start = _now_iso()
        self._current_run_seed = None
        self._last_state = None
        for controller in self.network.intersections.values():
            controller.set_mode(mode)
        self._queue_network_command(lambda: (self.network.reset(), self.network.set_network_mode(mode)))

    def set_scenario(self, scenario: str) -> None:
        self.scenario = scenario
        self.network.scenario = scenario
        self.generator.set_scenario(scenario)

    def trigger_preemption(self, intersection_id: str, approach: str) -> None:
        self.network.get_intersection(intersection_id).trigger_preemption(approach)
        self._queue_network_command(
            lambda: self.network.get_intersection(intersection_id).trigger_preemption(approach)
        )

    def set_config(self, updates: dict) -> dict:
        """Update runtime config. Returns the full applied snapshot."""
        return cfg.update(updates)

    # ------------------------------------------------------------------- alerts
    def get_alerts(self, limit: int = 50) -> list[dict]:
        """Returns newest-first, at most `limit` entries."""
        try:
            persisted = db.get_alerts(limit=limit)
            if persisted:
                return persisted
        except Exception:
            pass
        return list(reversed(self._alert_log[-limit:]))

    def clear_alerts(self) -> None:
        self._alert_log.clear()
        self._prev_alerts.clear()
        try:
            db.clear_alerts()
        except Exception:
            pass

    @staticmethod
    def _level_for(message: str) -> str:
        lower = message.lower()
        if "emergency" in lower or "preemption" in lower:
            return "critical"
        if "spillback" in lower:
            return "warning"
        return "info"

    def _record_alerts(self, alerts: list[str]) -> None:
        """Append only alerts that are new this tick (dedup against previous tick)."""
        new_set: set[str] = set()
        now = _now_iso()
        for message in alerts:
            new_set.add(message)
            if message in self._prev_alerts:
                continue
            entry = {"timestamp": now, "message": message, "level": self._level_for(message)}
            self._alert_log.append(entry)
            try:
                db.save_alert(entry)
            except Exception:
                pass
        if len(self._alert_log) > 200:
            self._alert_log = self._alert_log[-200:]
        self._prev_alerts = new_set

    def _handle_runtime_error(self, exc: Exception) -> None:
        """Keep the engine thread alive if SUMO/TraCI throws during a tick."""
        summary = "".join(format_exception_only(type(exc), exc)).strip()
        message = f"Simulation runtime error: {summary}"
        self.running = False
        self.network.running = False
        self._record_alerts([message])
        try:
            self.network.reset()
        except Exception:
            pass
        self._last_state = self.get_current_state().model_copy(update={"alerts": [message]})

    # -------------------------------------------------------------- accessors
    def get_run_history(self) -> list[RunSummary]:
        return list(self.run_history)

    def get_current_state(self) -> SimulationTickState:
        if self._last_state is not None:
            junction_metrics = self._last_state.junction_metrics
            try:
                junction_metrics = {
                    intersection_id: JunctionMetricState(**snapshot)
                    for intersection_id, snapshot in self.network.junction_metrics_snapshot().items()
                }
            except Exception:
                pass
            # HTTP thread path — never touch TraCI. Reuse the cached
            # intersections/segments/visuals the sim thread wrote last tick.
            return self._last_state.model_copy(
                update={
                    "running": self.running,
                    "started": self.network.started,
                    "scenario": self.scenario,
                    "green_wave_success_rate": round(self._metrics.current_success_rate(), 4),
                    "current_run_ticks": self._metrics.tick_count,
                    "vehicles_served_this_run": self._metrics.vehicles_completed,
                    "avg_wait_time_adaptive": self._metrics.avg_wait_time() if self.network.current_mode() == SignalMode.ADAPTIVE else 0.0,
                    "avg_wait_time_fixed": self._metrics.avg_wait_time() if self.network.current_mode() == SignalMode.FIXED else 0.0,
                    "current_avg_wait_time": self._metrics.avg_wait_time(),
                    "current_total_wait_time": self._metrics.total_wait_time(),
                    "current_sample_adjusted_wait_time": self._metrics.sample_adjusted_wait_time(
                        self._last_fixed_summary.avg_wait_time_fixed if self._last_fixed_summary else None,
                        self._last_fixed_summary.vehicles_completed if self._last_fixed_summary else None,
                    ),
                    "current_throughput_vpm": self._metrics.current_throughput_per_min(),
                    "current_avg_congestion": self._metrics.current_congestion(),
                    "spillback_events": self._metrics.spillback_events,
                    "preemption_events": self._metrics.preemption_events,
                    "current_mode": self.network.current_mode(),
                    "junction_metrics": junction_metrics,
                    "current_junction_comparison": self._junction_comparison_map(self._metrics.junction_metrics()),
                    "baseline_junction_comparison": self._junction_comparison_map(
                        self._last_fixed_summary.junction_metrics if self._last_fixed_summary else None
                    ),
                    "spillback_locations": self._spillback_locations(self._last_state),
                    "network_summary": self._network_summary(self._last_state, self._metrics.current_congestion()),
                    "baseline_mode": self._last_fixed_summary.mode if self._last_fixed_summary else None,
                    "baseline_avg_wait_time": self._last_fixed_summary.avg_wait_time_fixed if self._last_fixed_summary else None,
                    "baseline_total_wait_time": self._last_fixed_summary.total_wait_seconds if self._last_fixed_summary else None,
                    "baseline_vehicles_completed": self._last_fixed_summary.vehicles_completed if self._last_fixed_summary else None,
                    "baseline_sample_adjusted_wait_time": self._last_fixed_summary.avg_wait_time_fixed if self._last_fixed_summary else None,
                    "baseline_throughput_vpm": self._last_fixed_summary.throughput_per_min if self._last_fixed_summary else None,
                    "baseline_avg_congestion": self._last_fixed_summary.avg_congestion if self._last_fixed_summary else None,
                    "baseline_green_wave_success_rate": self._last_fixed_summary.green_wave_success_rate if self._last_fixed_summary else None,
                }
            )
        return SimulationTickState(
            run_id=self._run_id,
            tick=0,
            simulated_time_seconds=0,
            running=self.running,
            started=self.network.started,
            scenario=self.scenario,  # type: ignore[arg-type]
            current_mode=self.network.current_mode(),
            intersections=self.network.get_intersection_states(),
            segments=self.network.get_segment_states(),
            visual_vehicles=self.network.get_visual_vehicle_states(),
            alerts=[],
            green_wave_success_rate=0.0,
            current_run_ticks=0,
            vehicles_served_this_run=0,
            avg_wait_time_adaptive=0.0,
            avg_wait_time_fixed=0.0,
            current_avg_wait_time=0.0,
            current_total_wait_time=0.0,
            current_sample_adjusted_wait_time=0.0,
            current_throughput_vpm=0.0,
            current_avg_congestion=0.0,
            spillback_events=0,
            preemption_events=0,
            current_junction_comparison={},
            baseline_junction_comparison=self._junction_comparison_map(
                self._last_fixed_summary.junction_metrics if self._last_fixed_summary else None
            ),
            spillback_locations=[],
            network_summary="Clear roads",
            baseline_mode=self._last_fixed_summary.mode if self._last_fixed_summary else None,
            baseline_avg_wait_time=self._last_fixed_summary.avg_wait_time_fixed if self._last_fixed_summary else None,
            baseline_total_wait_time=self._last_fixed_summary.total_wait_seconds if self._last_fixed_summary else None,
            baseline_vehicles_completed=self._last_fixed_summary.vehicles_completed if self._last_fixed_summary else None,
            baseline_sample_adjusted_wait_time=self._last_fixed_summary.avg_wait_time_fixed if self._last_fixed_summary else None,
            baseline_throughput_vpm=self._last_fixed_summary.throughput_per_min if self._last_fixed_summary else None,
            baseline_avg_congestion=self._last_fixed_summary.avg_congestion if self._last_fixed_summary else None,
            baseline_green_wave_success_rate=self._last_fixed_summary.green_wave_success_rate if self._last_fixed_summary else None,
        )

    # -------------------------------------------------------------------- loop
    def _run_loop(self) -> None:
        while not self._stop_flag.is_set():
            dt = 1.0 / max(cfg.get("TICK_RATE_HZ"), 0.1)
            try:
                if hasattr(self.network, "process_pending_commands"):
                    try:
                        self.network.process_pending_commands()
                    except Exception:
                        pass
                if self.running:
                    state, tick_meta = self.network.tick(self.generator, dt)
                    self._metrics.record_tick(state, self.network, tick_meta)
                    self._record_alerts(state.alerts)
                    state.green_wave_success_rate = round(self._metrics.current_success_rate(), 4)
                    state.run_id = self._run_id
                    state.current_run_ticks = self._metrics.tick_count
                    state.current_mode = self.network.current_mode()
                    state.vehicles_served_this_run = self._metrics.vehicles_completed
                    state.avg_wait_time_adaptive = self._metrics.avg_wait_time() if state.current_mode == SignalMode.ADAPTIVE else 0.0
                    state.avg_wait_time_fixed = self._metrics.avg_wait_time() if state.current_mode == SignalMode.FIXED else 0.0
                    state.current_avg_wait_time = self._metrics.avg_wait_time()
                    state.current_total_wait_time = self._metrics.total_wait_time()
                    state.current_sample_adjusted_wait_time = self._metrics.sample_adjusted_wait_time(
                        self._last_fixed_summary.avg_wait_time_fixed if self._last_fixed_summary else None,
                        self._last_fixed_summary.vehicles_completed if self._last_fixed_summary else None,
                    )
                    state.current_throughput_vpm = self._metrics.current_throughput_per_min()
                    state.current_avg_congestion = self._metrics.current_congestion()
                    state.spillback_events = self._metrics.spillback_events
                    state.preemption_events = self._metrics.preemption_events
                    state.current_junction_comparison = self._junction_comparison_map(self._metrics.junction_metrics())
                    state.baseline_junction_comparison = self._junction_comparison_map(
                        self._last_fixed_summary.junction_metrics if self._last_fixed_summary else None
                    )
                    state.spillback_locations = self._spillback_locations(state)
                    state.network_summary = self._network_summary(state, state.current_avg_congestion)
                    if self._last_fixed_summary is not None:
                        state.baseline_mode = self._last_fixed_summary.mode
                        state.baseline_avg_wait_time = self._last_fixed_summary.avg_wait_time_fixed
                        state.baseline_total_wait_time = self._last_fixed_summary.total_wait_seconds
                        state.baseline_vehicles_completed = self._last_fixed_summary.vehicles_completed
                        state.baseline_sample_adjusted_wait_time = self._last_fixed_summary.avg_wait_time_fixed
                        state.baseline_throughput_vpm = self._last_fixed_summary.throughput_per_min
                        state.baseline_avg_congestion = self._last_fixed_summary.avg_congestion
                        state.baseline_green_wave_success_rate = self._last_fixed_summary.green_wave_success_rate
                    self.tick_count = state.tick
                    self._last_state = state

                    # Persist tick snapshot every 10 ticks
                    if self._metrics.tick_count % 10 == 0:
                        try:
                            db.save_tick_snapshot(
                                self._run_id,
                                state.tick,
                                self._metrics.avg_wait_time(),
                                self._metrics.current_throughput_per_min(),
                                self._metrics.current_congestion(),
                                self._metrics.vehicles_completed,
                            )
                        except Exception:
                            pass
                        live_summary = self.get_live_run_summary()
                        if live_summary is not None:
                            self._persist_run_summary(live_summary)

                    if self._broadcast_fn is not None and self._loop is not None:
                        try:
                            asyncio.run_coroutine_threadsafe(
                                self._broadcast_fn(state), self._loop
                            )
                        except RuntimeError:
                            pass
            except Exception as exc:
                self._handle_runtime_error(exc)
            time.sleep(dt)
