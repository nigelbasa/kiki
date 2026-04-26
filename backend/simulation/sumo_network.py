"""SUMO-backed traffic network with Python-side mode control.

All TraCI access stays on the engine's simulation thread. The HTTP/socket
threads only enqueue control commands on the network; the engine drains and
applies them inside the run loop.
"""
from __future__ import annotations

import atexit
import os
import queue
import random
import sys
from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Optional

import config_runtime as cfg

_TOOLS = os.path.join(os.environ.get("SUMO_HOME", ""), "tools")
if _TOOLS and _TOOLS not in sys.path:
    sys.path.insert(0, _TOOLS)

import traci  # noqa: E402
import sumolib  # noqa: E402

from models.schemas import (  # noqa: E402
    ApproachState,
    EmergencyState,
    IntersectionState,
    JunctionMetricState,
    RoadSegmentState,
    RunSummary,
    SignalMode,
    SignalPhase,
    SimulationTickState,
    VisualVehicleState,
)


SUMO_CFG = os.path.join(os.path.dirname(__file__), "..", "sumo", "rwendo.sumocfg")

INTERSECTIONS = {
    "TL_00": "Samora Machel Ave x Julius Nyerere Way",
    "TL_10": "Harare Drive x Borrowdale Road",
    "TL_11": "Eastern Gateway Junction",
}

APPROACHES: dict[str, dict[str, list[str]]] = {
    "TL_00": {
        "NS": ["EXT_TL00_N__TL_00", "TL_10__TL_00"],
        "EW": ["EXT_TL00_W__TL_00", "TL_11__TL_00"],
    },
    "TL_10": {
        "NS": ["TL_00__TL_10", "EXT_TL10_S__TL_10"],
        "EW": ["EXT_TL10_W__TL_10", "TL_11__TL_10"],
    },
    "TL_11": {
        "NS": ["EXT_TL11_S__TL_11", "TL_00__TL_11"],
        "EW": ["EXT_TL11_E__TL_11", "TL_10__TL_11"],
    },
}

SEGMENTS: list[tuple[str, str, str]] = [
    ("TL_00->TL_10", "TL_00__TL_10", "TL_10__TL_00"),
    ("TL_10->TL_11", "TL_10__TL_11", "TL_11__TL_10"),
    ("TL_00->TL_11", "TL_00__TL_11", "TL_11__TL_00"),
]

SPAWN_ENTRIES: dict[str, list[str]] = {
    "EXT_TL00_N__TL_00": ["TL_10__EXT_TL10_S", "TL_11__EXT_TL11_E", "TL_00__EXT_TL00_W"],
    "EXT_TL00_W__TL_00": ["TL_11__EXT_TL11_E", "TL_10__EXT_TL10_S"],
    "EXT_TL10_S__TL_10": ["TL_00__EXT_TL00_N", "TL_00__EXT_TL00_W", "TL_11__EXT_TL11_E"],
    "EXT_TL10_W__TL_10": ["TL_00__EXT_TL00_N", "TL_11__EXT_TL11_E"],
    "EXT_TL11_E__TL_11": ["TL_10__EXT_TL10_S", "TL_00__EXT_TL00_W", "TL_10__EXT_TL10_W"],
    "EXT_TL11_S__TL_11": ["TL_00__EXT_TL00_W", "TL_10__EXT_TL10_S"],
}

VEHICLE_TYPES = ["car", "truck", "bus", "motorcycle", "ambulance"]
VEHICLE_WEIGHTS = [0.72, 0.08, 0.07, 0.11, 0.02]
LANE_HINTS: dict[tuple[str, str], tuple[int, ...]] = {
    ("EXT_TL00_N__TL_00", "TL_00__EXT_TL00_W"): (0,),
    ("EXT_TL00_N__TL_00", "TL_00__TL_10"): (0, 1),
    ("EXT_TL00_N__TL_00", "TL_00__TL_11"): (1,),
    ("EXT_TL00_W__TL_00", "TL_00__TL_10"): (0,),
    ("EXT_TL00_W__TL_00", "TL_00__TL_11"): (0, 1),
    ("EXT_TL00_W__TL_00", "TL_00__EXT_TL00_N"): (1,),
    ("TL_10__TL_00", "TL_00__TL_11"): (0,),
    ("TL_10__TL_00", "TL_00__EXT_TL00_N"): (0, 1),
    ("TL_10__TL_00", "TL_00__EXT_TL00_W"): (1,),
    ("TL_11__TL_00", "TL_00__EXT_TL00_N"): (0,),
    ("TL_11__TL_00", "TL_00__EXT_TL00_W"): (0, 1),
    ("TL_11__TL_00", "TL_00__TL_10"): (1,),
    ("EXT_TL10_S__TL_10", "TL_10__TL_11"): (0,),
    ("EXT_TL10_S__TL_10", "TL_10__TL_00"): (0, 1),
    ("EXT_TL10_S__TL_10", "TL_10__EXT_TL10_W"): (1,),
    ("EXT_TL10_W__TL_10", "TL_10__EXT_TL10_S"): (0,),
    ("EXT_TL10_W__TL_10", "TL_10__TL_11"): (0, 1),
    ("EXT_TL10_W__TL_10", "TL_10__TL_00"): (1,),
    ("TL_00__TL_10", "TL_10__EXT_TL10_W"): (0,),
    ("TL_00__TL_10", "TL_10__EXT_TL10_S"): (0, 1),
    ("TL_00__TL_10", "TL_10__TL_11"): (1,),
    ("TL_11__TL_10", "TL_10__TL_00"): (0,),
    ("TL_11__TL_10", "TL_10__EXT_TL10_W"): (0, 1),
    ("TL_11__TL_10", "TL_10__EXT_TL10_S"): (1,),
    ("EXT_TL11_E__TL_11", "TL_11__TL_00"): (0,),
    ("EXT_TL11_E__TL_11", "TL_11__TL_10"): (0, 1),
    ("EXT_TL11_E__TL_11", "TL_11__EXT_TL11_S"): (1,),
    ("EXT_TL11_S__TL_11", "TL_11__EXT_TL11_E"): (0,),
    ("EXT_TL11_S__TL_11", "TL_11__TL_00"): (0, 1),
    ("EXT_TL11_S__TL_11", "TL_11__TL_10"): (1,),
    ("TL_10__TL_11", "TL_11__EXT_TL11_S"): (0,),
    ("TL_10__TL_11", "TL_11__EXT_TL11_E"): (0, 1),
    ("TL_10__TL_11", "TL_11__TL_00"): (1,),
    ("TL_00__TL_11", "TL_11__TL_10"): (0,),
    ("TL_00__TL_11", "TL_11__EXT_TL11_S"): (0,),
    ("TL_00__TL_11", "TL_11__EXT_TL11_E"): (0, 1),
}


def _step_length() -> float:
    return 1.0 / max(float(cfg.get("TICK_RATE_HZ")), 0.1)


def _amber_duration(mode: SignalMode) -> float:
    base = float(cfg.get("AMBER_DURATION"))
    if mode == SignalMode.ADAPTIVE:
        return max(_step_length() * 2, min(1.0, base))
    return base


def _preemption_duration() -> float:
    return max(4.0, float(cfg.get("PREEMPTION_HOLD_SECONDS")))


def _rolling_window_ticks(seconds: float = 30.0) -> int:
    return max(1, int(round(seconds / _step_length())))


def _congestion_level(count: int) -> str:
    if count < 8:
        return "clear"
    if count < 20:
        return "moderate"
    return "heavy"


def _vehicle_type_for(sumo_vehicle_id: str) -> str:
    for vehicle_type in VEHICLE_TYPES:
        if sumo_vehicle_id.endswith(vehicle_type):
            return vehicle_type
    return "car"


@dataclass(frozen=True)
class PhasePlan:
    id: str
    group: str
    green_phase: int
    amber_phase: Optional[int] = None
    clearance_phase: Optional[int] = None
    queue_edges: tuple[str, ...] = ()


PHASE_PLAN_MAP: dict[str, dict[str, PhasePlan]] = {
    "TL_00": {
        "NS": PhasePlan("NS", "NS", 0, amber_phase=1, queue_edges=("EXT_TL00_N__TL_00", "TL_10__TL_00")),
        "EW": PhasePlan("EW", "EW", 2, amber_phase=3, queue_edges=("EXT_TL00_W__TL_00", "TL_11__TL_00")),
    },
    "TL_10": {
        "NS": PhasePlan("NS", "NS", 0, amber_phase=1, queue_edges=("TL_00__TL_10", "EXT_TL10_S__TL_10")),
        "EW": PhasePlan("EW", "EW", 2, amber_phase=3, queue_edges=("EXT_TL10_W__TL_10", "TL_11__TL_10")),
    },
    "TL_11": {
        "EW": PhasePlan("EW", "EW", 0, amber_phase=1, clearance_phase=2, queue_edges=("EXT_TL11_E__TL_11", "TL_10__TL_11")),
        "NS_CURVE": PhasePlan("NS_CURVE", "NS", 3, amber_phase=4, clearance_phase=5, queue_edges=("TL_00__TL_11",)),
        "NS_SOUTH": PhasePlan("NS_SOUTH", "NS", 6, amber_phase=7, clearance_phase=8, queue_edges=("EXT_TL11_S__TL_11",)),
    },
}

FIXED_SEQUENCES: dict[str, list[str]] = {
    "TL_00": ["NS", "EW"],
    "TL_10": ["NS", "EW"],
    "TL_11": ["EW", "NS_CURVE", "NS_SOUTH"],
}


@dataclass
class _Ctl:
    id: str
    name: str
    mode: SignalMode = SignalMode.FIXED
    spillback_active: bool = False
    emergency_state: EmergencyState = EmergencyState.IDLE
    emergency_approach: Optional[str] = None
    emergency_plan_id: Optional[str] = None
    current_plan_id: str = ""
    stage: str = "ready"
    stage_remaining: float = 0.0
    sequence_index: int = 0
    preemption_remaining: float = 0.0
    recovery_remaining: float = 0.0
    just_started: bool = True
    last_selected_group: str = "EW"
    pending_priority_group: Optional[str] = None
    stage_elapsed: float = 0.0
    last_tl11_ns_plan: str = "NS_SOUTH"

    def set_mode(self, mode: SignalMode) -> None:
        self.mode = mode

    def trigger_preemption(self, approach: str) -> None:
        if approach not in ("NS", "EW"):
            raise ValueError(f"unknown approach {approach!r}")
        self.emergency_approach = approach
        self.emergency_plan_id = None
        self.emergency_state = EmergencyState.INJECTED
        self.preemption_remaining = _preemption_duration()


class SumoNetwork:
    """Drives a SUMO process via TraCI and exposes the engine contract."""

    def __init__(self) -> None:
        self.intersections: dict[str, _Ctl] = {
            tl_id: _Ctl(tl_id, name) for tl_id, name in INTERSECTIONS.items()
        }
        self.tick_count: int = 0
        self.scenario: str = "off_peak"
        self.running: bool = False
        self.started: bool = False

        self._rng = random.Random()
        self._route_counter = 0
        self._vehicle_counter = 0
        self._vehicle_spawn_ticks: dict[str, int] = {}
        self._connected = False
        self._cmd_q: queue.Queue[Callable[[], None]] = queue.Queue()

        atexit.register(self._disconnect)

    # --------------------------------------------------------- engine contract
    def start_run(self) -> None:
        self.running = True
        self.started = True
        if not self._connected:
            self._connect()
        self._initialise_controllers()

    def pause(self) -> None:
        self.running = False

    def resume(self) -> None:
        if self.started:
            self.running = True

    def reset(self) -> None:
        self._disconnect()
        self.tick_count = 0
        self.running = False
        self.started = False
        self._route_counter = 0
        self._vehicle_counter = 0
        self._vehicle_spawn_ticks.clear()
        for ctl in self.intersections.values():
            ctl.spillback_active = False
            ctl.emergency_state = EmergencyState.IDLE
            ctl.emergency_approach = None
            ctl.emergency_plan_id = None
            ctl.current_plan_id = ""
            ctl.stage = "ready"
            ctl.stage_remaining = 0.0
            ctl.preemption_remaining = 0.0
            ctl.recovery_remaining = 0.0
            ctl.just_started = True
            ctl.last_selected_group = "EW"
            ctl.pending_priority_group = None
            ctl.stage_elapsed = 0.0

    def close(self) -> None:
        self._disconnect()

    def get_intersection(self, intersection_id: str) -> _Ctl:
        return self.intersections[intersection_id]

    def current_mode(self) -> SignalMode:
        return next(iter(self.intersections.values())).mode

    def set_network_mode(self, mode: SignalMode) -> None:
        for ctl in self.intersections.values():
            ctl.mode = mode
        if self._connected and self.started:
            self._initialise_controllers()

    def queue_command(self, fn: Callable[[], None]) -> None:
        self._cmd_q.put(fn)

    def process_pending_commands(self) -> None:
        while True:
            try:
                fn = self._cmd_q.get_nowait()
            except queue.Empty:
                break
            fn()

    # ---------------------------------------------------------- TraCI lifecycle
    def _connect(self) -> None:
        if self._connected:
            traci.switch("rwendo")
            return
        sumo_bin = sumolib.checkBinary("sumo")
        cfg_path = os.path.abspath(SUMO_CFG)
        traci.start(
            [sumo_bin, "-c", cfg_path, "--step-length", str(_step_length()), "--no-warnings"],
            label="rwendo",
        )
        traci.switch("rwendo")
        self._connected = True

    def _disconnect(self) -> None:
        if not self._connected:
            return
        try:
            traci.switch("rwendo")
            traci.close()
        except Exception:
            pass
        self._connected = False

    # ------------------------------------------------------------------- tick
    def tick(self, generator, dt: float = 0.1) -> tuple[SimulationTickState, dict]:
        if not self._connected:
            self._connect()

        self.process_pending_commands()

        completed: list[dict] = []
        active_count = 0

        if self.started and self.running:
            self._apply_signal_control(dt)
            self._spawn_vehicles(generator, dt)
            self._guide_vehicles_to_valid_lanes()

            pre_step_waits: dict[str, float] = {}
            try:
                vehicle_ids = traci.vehicle.getIDList()
                active_count = len(vehicle_ids)
                for vehicle_id in vehicle_ids:
                    pre_step_waits[vehicle_id] = traci.vehicle.getAccumulatedWaitingTime(vehicle_id)
            except traci.TraCIException:
                pass

            traci.simulationStep()
            self.tick_count += 1

            try:
                arrived_ids = traci.simulation.getArrivedIDList()
            except traci.TraCIException:
                arrived_ids = []
            for vehicle_id in arrived_ids:
                spawn_tick = self._vehicle_spawn_ticks.pop(vehicle_id, self.tick_count)
                completed.append({
                    "id": vehicle_id,
                    "wait_seconds": pre_step_waits.get(vehicle_id, 0.0),
                    "is_emergency": vehicle_id.endswith("ambulance"),
                    "travel_seconds": max(0.0, (self.tick_count - spawn_tick) * _step_length()),
                })

        meta = {"completed": completed, "active_vehicle_count": active_count}
        return self._snapshot(), meta

    # ---------------------------------------------------------------- control
    def _initialise_controllers(self) -> None:
        for ctl in self.intersections.values():
            ctl.spillback_active = False
            ctl.emergency_state = EmergencyState.IDLE
            ctl.emergency_approach = None
            ctl.emergency_plan_id = None
            ctl.preemption_remaining = 0.0
            ctl.recovery_remaining = 0.0
            ctl.stage = "ready"
            ctl.stage_remaining = 0.0
            ctl.just_started = True
            ctl.sequence_index = self._rng.randint(0, len(FIXED_SEQUENCES[ctl.id]) - 1)
            ctl.pending_priority_group = None
            ctl.stage_elapsed = 0.0
            initial_plan = FIXED_SEQUENCES[ctl.id][ctl.sequence_index]
            if ctl.mode == SignalMode.ADAPTIVE:
                initial_plan = self._select_next_plan(ctl)
            self._set_green_plan(ctl, initial_plan, self._green_duration_for_plan(ctl, initial_plan))

    def _apply_signal_control(self, dt: float) -> None:
        if not self._connected:
            return
        for ctl in self.intersections.values():
            self._update_spillback_flag(ctl)

            if ctl.mode == SignalMode.ADAPTIVE:
                emergency_plan = self._detect_waiting_ambulance_plan(ctl)
                if emergency_plan is not None and ctl.emergency_state == EmergencyState.IDLE:
                    if emergency_plan in {"NS", "EW"}:
                        ctl.trigger_preemption(emergency_plan)
                    else:
                        ctl.emergency_approach = "NS" if emergency_plan.startswith("NS_") else "EW"
                        ctl.emergency_plan_id = emergency_plan
                        ctl.emergency_state = EmergencyState.INJECTED
                        ctl.preemption_remaining = _preemption_duration()

            if ctl.emergency_state != EmergencyState.IDLE:
                self._tick_preemption(ctl, dt)
                continue

            ctl.stage_elapsed += dt
            if ctl.mode == SignalMode.ADAPTIVE and ctl.stage == "green":
                self._apply_adaptive_green_adjustments(ctl)

            ctl.stage_remaining = max(0.0, ctl.stage_remaining - dt)
            if ctl.stage_remaining > 0:
                continue

            if ctl.stage == "green":
                self._start_amber_or_clearance(ctl)
            elif ctl.stage == "amber":
                self._start_clearance_or_next_green(ctl)
            elif ctl.stage == "clearance":
                self._start_next_green(ctl)
            else:
                self._start_next_green(ctl)

    def _tick_preemption(self, ctl: _Ctl, dt: float) -> None:
        if ctl.mode != SignalMode.ADAPTIVE:
            ctl.emergency_state = EmergencyState.IDLE
            ctl.emergency_approach = None
            ctl.emergency_plan_id = None
            return

        if ctl.emergency_state == EmergencyState.INJECTED:
            ctl.emergency_state = EmergencyState.ACTIVE
            plan_id = self._plan_for_preemption(ctl)
            hold = _preemption_duration()
            self._set_green_plan(ctl, plan_id, hold)
            ctl.preemption_remaining = hold
            ctl.stage_remaining = hold
            ctl.stage_elapsed = 0.0
            return

        if ctl.emergency_state == EmergencyState.ACTIVE:
            active_plan = ctl.emergency_plan_id or ctl.current_plan_id
            ambulance_still_waiting = bool(active_plan) and self._ambulance_waiting_for_plan(ctl, active_plan)
            ctl.preemption_remaining = max(0.0, ctl.preemption_remaining - dt)
            if not ambulance_still_waiting and ctl.stage_elapsed >= 2.0:
                ctl.preemption_remaining = min(ctl.preemption_remaining, 1.0)
            ctl.stage_remaining = ctl.preemption_remaining
            if ctl.preemption_remaining <= 0:
                ctl.emergency_state = EmergencyState.IDLE
                ctl.emergency_approach = None
                ctl.emergency_plan_id = None
                self._start_next_green(ctl)
            return

    def _plan_for_preemption(self, ctl: _Ctl) -> str:
        if ctl.emergency_plan_id:
            return ctl.emergency_plan_id
        if ctl.id != "TL_11":
            return ctl.emergency_approach or "NS"
        south_q = self._edge_halts("EXT_TL11_S__TL_11")
        curve_q = self._edge_halts("TL_00__TL_11")
        if south_q >= curve_q:
            return "NS_SOUTH"
        return "NS_CURVE"

    def _start_amber_or_clearance(self, ctl: _Ctl) -> None:
        plan = PHASE_PLAN_MAP[ctl.id][ctl.current_plan_id]
        if plan.amber_phase is not None:
            traci.trafficlight.setPhase(ctl.id, plan.amber_phase)
            traci.trafficlight.setPhaseDuration(ctl.id, _amber_duration(ctl.mode))
            ctl.stage = "amber"
            ctl.stage_remaining = _amber_duration(ctl.mode)
            return
        if plan.clearance_phase is not None:
            traci.trafficlight.setPhase(ctl.id, plan.clearance_phase)
            traci.trafficlight.setPhaseDuration(ctl.id, _step_length())
            ctl.stage = "clearance"
            ctl.stage_remaining = _step_length()
            return
        self._start_next_green(ctl)

    def _start_clearance_or_next_green(self, ctl: _Ctl) -> None:
        plan = PHASE_PLAN_MAP[ctl.id][ctl.current_plan_id]
        if plan.clearance_phase is not None:
            traci.trafficlight.setPhase(ctl.id, plan.clearance_phase)
            traci.trafficlight.setPhaseDuration(ctl.id, _step_length())
            ctl.stage = "clearance"
            ctl.stage_remaining = _step_length()
            return
        self._start_next_green(ctl)

    def _start_next_green(self, ctl: _Ctl) -> None:
        next_plan_id = self._select_next_plan(ctl)
        duration = self._green_duration_for_plan(ctl, next_plan_id)
        self._set_green_plan(ctl, next_plan_id, duration)

    def _set_green_plan(self, ctl: _Ctl, plan_id: str, duration: float) -> None:
        plan = PHASE_PLAN_MAP[ctl.id][plan_id]
        traci.trafficlight.setPhase(ctl.id, plan.green_phase)
        traci.trafficlight.setPhaseDuration(ctl.id, duration)
        ctl.current_plan_id = plan_id
        ctl.stage = "green"
        ctl.stage_remaining = duration
        ctl.last_selected_group = plan.group
        ctl.just_started = False
        ctl.pending_priority_group = None
        ctl.stage_elapsed = 0.0
        if ctl.id == "TL_11" and plan_id.startswith("NS_"):
            ctl.last_tl11_ns_plan = plan_id

    def _apply_adaptive_green_adjustments(self, ctl: _Ctl) -> None:
        if ctl.current_plan_id == "":
            return

        plan = PHASE_PLAN_MAP[ctl.id][ctl.current_plan_id]
        min_green = max(10.0, float(cfg.get("MIN_GREEN")))
        if ctl.stage_elapsed < min_green:
            return

        active_demand = sum(self._edge_detection_score(edge_id) for edge_id in plan.queue_edges)
        opposing_group = "EW" if plan.group == "NS" else "NS"
        opposing_demand = self._approach_detection_score(ctl.id, opposing_group)
        active_presence = sum(self._edge_presence(edge_id) for edge_id in plan.queue_edges)
        opposing_presence = self._approach_presence(ctl.id, opposing_group)

        if (
            ctl.stage_remaining > 4.0
            and active_presence <= 1
            and opposing_presence >= active_presence + 3
        ):
            ctl.stage_remaining = min(ctl.stage_remaining, 1.0)
        elif (
            ctl.stage_remaining > 4.0
            and active_demand <= 2.2
            and opposing_demand >= active_demand + 3.2
        ):
            ctl.stage_remaining = min(ctl.stage_remaining, 1.0)

        priority_group = self._priority_group_from_upstream(ctl)
        if (
            priority_group is not None
            and priority_group != plan.group
            and ctl.stage_remaining > 5.0
        ):
            ctl.pending_priority_group = priority_group
            ctl.stage_remaining = min(ctl.stage_remaining, 2.0)

    def _select_next_plan(self, ctl: _Ctl) -> str:
        if ctl.mode == SignalMode.FIXED:
            ctl.sequence_index = (ctl.sequence_index + 1) % len(FIXED_SEQUENCES[ctl.id])
            next_plan_id = FIXED_SEQUENCES[ctl.id][ctl.sequence_index]
            if ctl.id == "TL_11" and next_plan_id.startswith("NS_"):
                return self._select_tl11_ns_plan(ctl, fallback=next_plan_id)
            return next_plan_id

        if ctl.pending_priority_group == "NS":
            ctl.pending_priority_group = None
            if ctl.id == "TL_11":
                return self._select_tl11_ns_plan(ctl)
            return "NS"
        if ctl.pending_priority_group == "EW":
            ctl.pending_priority_group = None
            return "EW"

        ns_queue = self._approach_detection_score(ctl.id, "NS")
        ew_queue = self._approach_detection_score(ctl.id, "EW")

        if ctl.last_selected_group == "NS" and ew_queue > 0:
            ns_queue *= 0.72
        elif ctl.last_selected_group == "EW" and ns_queue > 0:
            ew_queue *= 0.72

        if abs(ns_queue - ew_queue) <= 0.8:
            selected_group = "EW" if ctl.last_selected_group == "NS" else "NS"
        else:
            selected_group = "NS" if ns_queue > ew_queue else "EW"

        if ctl.id != "TL_11":
            return selected_group

        if selected_group == "EW":
            return "EW"

        return self._select_tl11_ns_plan(ctl)

    def _select_tl11_ns_plan(self, ctl: _Ctl, fallback: Optional[str] = None) -> str:
        south_score = self._edge_detection_score("EXT_TL11_S__TL_11")
        curve_score = self._edge_detection_score("TL_00__TL_11")
        preferred = "NS_SOUTH" if south_score > curve_score else "NS_CURVE"
        if abs(south_score - curve_score) <= 1.2:
            preferred = "NS_CURVE" if ctl.last_tl11_ns_plan == "NS_SOUTH" else "NS_SOUTH"

        if preferred == "NS_SOUTH" and south_score <= 0.2 and curve_score > 0.2:
            return "NS_CURVE"
        if preferred == "NS_CURVE" and curve_score <= 0.2 and south_score > 0.2:
            return "NS_SOUTH"
        return preferred if preferred in PHASE_PLAN_MAP["TL_11"] else (fallback or "NS_SOUTH")

    def _priority_group_from_upstream(self, ctl: _Ctl) -> Optional[str]:
        if ctl.id == "TL_10":
            upstream = self.intersections["TL_00"]
            inbound_load = self._segment_vehicle_count("TL_00__TL_10") + self._approach_queue("TL_00", "NS")
            if upstream.stage == "green" and upstream.current_plan_id == "NS" and inbound_load >= 3:
                return "NS"
            return None

        if ctl.id == "TL_11":
            tl10 = self.intersections["TL_10"]
            load_from_tl10 = self._segment_vehicle_count("TL_10__TL_11") + self._approach_queue("TL_10", "EW")
            if tl10.stage == "green" and tl10.current_plan_id == "EW" and load_from_tl10 >= 3:
                return "EW"

            tl00 = self.intersections["TL_00"]
            load_from_tl00 = self._segment_vehicle_count("TL_00__TL_11") + self._approach_queue("TL_00", "EW")
            if tl00.stage == "green" and tl00.current_plan_id == "EW" and load_from_tl00 >= 3:
                return "NS"

        return None

    def _green_duration_for_plan(self, ctl: _Ctl, plan_id: str) -> float:
        min_green = float(cfg.get("MIN_GREEN"))
        max_green = max(min_green, min(70.0, float(cfg.get("MAX_GREEN"))))

        if ctl.mode == SignalMode.FIXED:
            return round((min_green + max_green) / 2.0, 2)

        plan = PHASE_PLAN_MAP[ctl.id][plan_id]
        demand = sum(
            float(self._edge_presence(edge_id)) + float(self._edge_halts(edge_id)) * 0.85
            for edge_id in plan.queue_edges
        )
        duration = min_green + min(demand * 0.9, max_green - min_green)

        coordination_bonus = 0.0
        if ctl.id == "TL_10" and plan.group == "NS":
            coordination_bonus = min(5.0, self._segment_vehicle_count("TL_00__TL_10") * 0.45)
        elif ctl.id == "TL_11":
            if plan.group == "EW":
                coordination_bonus = min(5.0, self._segment_vehicle_count("TL_10__TL_11") * 0.45)
            else:
                coordination_bonus = min(5.0, self._segment_vehicle_count("TL_00__TL_11") * 0.45)

        spillback_cap = max_green
        if ctl.spillback_active:
            spillback_cap = min_green + 4.0

        return round(max(min_green, min(spillback_cap, duration + coordination_bonus)), 2)

    def _update_spillback_flag(self, ctl: _Ctl) -> None:
        ctl.spillback_active = False
        threshold = int(cfg.get("SPILLBACK_THRESHOLD"))
        if ctl.id == "TL_00":
            downstream = self._approach_queue("TL_10", "NS") + self._approach_queue("TL_11", "NS")
            ctl.spillback_active = downstream > threshold
        elif ctl.id == "TL_10":
            downstream = self._approach_queue("TL_11", "EW") + self._approach_queue("TL_11", "NS")
            ctl.spillback_active = downstream > threshold

    # ------------------------------------------------------------------ spawn
    def _spawn_vehicles(self, generator, dt: float) -> None:
        if not hasattr(generator, "_rate"):
            return
        rate_per_tick = float(generator._rate()) * dt
        for entry_edge, destinations in SPAWN_ENTRIES.items():
            if self._rng.random() >= rate_per_tick:
                continue
            destination = self._rng.choice(destinations)
            try:
                route_result = traci.simulation.findRoute(entry_edge, destination)
            except traci.TraCIException:
                continue
            route_edges = list(getattr(route_result, "edges", []) or [])
            if len(route_edges) < 2:
                continue

            route_id = f"r{self._route_counter}"
            self._route_counter += 1
            try:
                traci.route.add(route_id, route_edges)
            except traci.TraCIException:
                continue

            vehicle_type = self._rng.choices(VEHICLE_TYPES, weights=VEHICLE_WEIGHTS, k=1)[0]
            vehicle_id = f"v{self._vehicle_counter}_{vehicle_type}"
            self._vehicle_counter += 1
            depart_lane = str(self._preferred_lane_for_route(route_edges))

            try:
                traci.vehicle.add(
                    vehicle_id,
                    routeID=route_id,
                    typeID="DEFAULT_VEHTYPE",
                    departLane=depart_lane,
                    arrivalLane="0",
                )
                traci.vehicle.setLaneChangeMode(vehicle_id, 512)
                self._vehicle_spawn_ticks[vehicle_id] = self.tick_count
            except traci.TraCIException:
                pass

    def _guide_vehicles_to_valid_lanes(self) -> None:
        try:
            vehicle_ids = list(traci.vehicle.getIDList())
        except traci.TraCIException:
            return

        for vehicle_id in vehicle_ids:
            try:
                route = list(traci.vehicle.getRoute(vehicle_id))
                route_index = int(traci.vehicle.getRouteIndex(vehicle_id))
                current_edge = traci.vehicle.getRoadID(vehicle_id)
                lane_id = traci.vehicle.getLaneID(vehicle_id)
                lane_length = traci.lane.getLength(lane_id)
                lane_position = traci.vehicle.getLanePosition(vehicle_id)
                current_lane = int(traci.vehicle.getLaneIndex(vehicle_id))
            except traci.TraCIException:
                continue

            if current_edge.startswith(":"):
                continue
            if route_index < 0 or route_index >= len(route) - 1:
                continue

            next_edge = route[route_index + 1]
            try:
                lane_count = max(1, int(traci.edge.getLaneNumber(current_edge)))
            except traci.TraCIException:
                lane_count = 1
            if lane_count <= 1:
                continue

            preferred_lanes = tuple(
                lane for lane in (LANE_HINTS.get((current_edge, next_edge)) or ()) if lane < lane_count
            )
            if not preferred_lanes or current_lane in preferred_lanes:
                continue

            distance_to_stop = lane_length - lane_position
            if distance_to_stop <= 10.0:
                continue

            try:
                traci.vehicle.changeLane(vehicle_id, preferred_lanes[-1], 2.5)
            except traci.TraCIException:
                continue

    @staticmethod
    def _preferred_lane_for_route(route_edges: list[str]) -> int:
        if len(route_edges) < 2:
            return 0
        try:
            lane_count = max(1, int(traci.edge.getLaneNumber(route_edges[0])))
        except traci.TraCIException:
            lane_count = 1

        preferred = tuple(
            lane for lane in (LANE_HINTS.get((route_edges[0], route_edges[1])) or (0,)) if lane < lane_count
        )
        if not preferred:
            return 0
        return preferred[0]

    # ---------------------------------------------------------------- snapshot
    def _snapshot(self) -> SimulationTickState:
        if not self._connected:
            return self._empty_snapshot()

        intersections = [self._intersection_state(ctl) for ctl in self.intersections.values()]
        segments = self._segment_states()
        junction_metrics = {
            intersection_id: JunctionMetricState(**snapshot)
            for intersection_id, snapshot in self.junction_metrics_snapshot().items()
        }
        visuals = self._visual_vehicles()

        alerts: list[str] = []
        if self.current_mode() == SignalMode.ADAPTIVE:
            for ctl in self.intersections.values():
                if ctl.spillback_active:
                    alerts.append(f"Spillback risk at {ctl.name}")
                if ctl.emergency_state != EmergencyState.IDLE:
                    alerts.append(f"Emergency preemption active at {ctl.name}")
            for segment in segments:
                if segment.congestion_level == "heavy":
                    alerts.append(f"Heavy congestion on segment {segment.id}")

        return SimulationTickState(
            tick=self.tick_count,
            simulated_time_seconds=int(round(self.tick_count * _step_length())),
            running=self.running,
            started=self.started,
            scenario=self.scenario,  # type: ignore[arg-type]
            current_mode=self.current_mode(),
            intersections=intersections,
            segments=segments,
            junction_metrics=junction_metrics,
            visual_vehicles=visuals,
            alerts=alerts,
        )

    def _intersection_state(self, ctl: _Ctl) -> IntersectionState:
        return IntersectionState(
            id=ctl.id,
            name=ctl.name,
            mode=ctl.mode,
            approaches=[
                ApproachState(
                    direction="NS",
                    phase=self._approach_phase(ctl, "NS"),
                    queue_length=self._approach_queue(ctl.id, "NS"),
                    countdown=self._approach_countdown(ctl, "NS"),
                ),
                ApproachState(
                    direction="EW",
                    phase=self._approach_phase(ctl, "EW"),
                    queue_length=self._approach_queue(ctl.id, "EW"),
                    countdown=self._approach_countdown(ctl, "EW"),
                ),
            ],
            spillback_active=ctl.spillback_active,
            emergency_state=ctl.emergency_state,
        )

    def _approach_queue(self, tl_id: str, direction: str) -> int:
        return sum(self._edge_halts(edge_id) for edge_id in APPROACHES[tl_id][direction])

    def _approach_presence(self, tl_id: str, direction: str) -> int:
        return sum(self._edge_presence(edge_id) for edge_id in APPROACHES[tl_id][direction])

    def _approach_detection_score(self, tl_id: str, direction: str) -> float:
        return sum(self._edge_detection_score(edge_id) for edge_id in APPROACHES[tl_id][direction])

    @staticmethod
    def _edge_halts(edge_id: str) -> int:
        try:
            return int(traci.edge.getLastStepHaltingNumber(edge_id))
        except traci.TraCIException:
            return 0

    @staticmethod
    def _edge_presence(edge_id: str) -> int:
        try:
            return int(traci.edge.getLastStepVehicleNumber(edge_id))
        except traci.TraCIException:
            return 0

    def _edge_detection_score(self, edge_id: str) -> float:
        return float(self._edge_presence(edge_id)) + float(self._edge_halts(edge_id)) * 1.8

    @staticmethod
    def _segment_vehicle_count(edge_id: str) -> int:
        try:
            return int(traci.edge.getLastStepVehicleNumber(edge_id))
        except traci.TraCIException:
            return 0

    def _detect_waiting_ambulance_plan(self, ctl: _Ctl) -> Optional[str]:
        if ctl.mode != SignalMode.ADAPTIVE:
            return None

        ready = self._ambulance_ready_for_preemption(ctl)
        if ready is None:
            return None
        return ready["plan_id"]

    def _ambulance_ready_for_preemption(self, ctl: _Ctl) -> Optional[dict]:
        if ctl.id == "TL_11":
            candidates = [
                {"plan_id": "NS_SOUTH", "edges": ("EXT_TL11_S__TL_11",)},
                {"plan_id": "NS_CURVE", "edges": ("TL_00__TL_11",)},
                {"plan_id": "EW", "edges": ("EXT_TL11_E__TL_11", "TL_10__TL_11")},
            ]
        else:
            candidates = [
                {"plan_id": "NS", "edges": tuple(APPROACHES[ctl.id]["NS"])},
                {"plan_id": "EW", "edges": tuple(APPROACHES[ctl.id]["EW"])},
            ]

        best_candidate: Optional[dict] = None
        for candidate in candidates:
            vehicle = self._leading_ambulance(candidate["edges"])
            if vehicle is None:
                continue
            if ctl.stage == "green" and ctl.current_plan_id == candidate["plan_id"]:
                continue
            if vehicle["rank"] > 1:
                continue
            if vehicle["distance_to_stop"] > 28.0:
                continue

            if vehicle["speed"] > 1.5:
                continue

            score = vehicle["distance_to_stop"] + vehicle["rank"] * 8.0
            if best_candidate is None or score < best_candidate["score"]:
                best_candidate = {**candidate, **vehicle, "score": score}

        return best_candidate

    def _leading_ambulance(self, edges: tuple[str, ...]) -> Optional[dict]:
        best: Optional[dict] = None
        for edge_id in edges:
            try:
                vehicle_ids = list(traci.edge.getLastStepVehicleIDs(edge_id))
            except traci.TraCIException:
                continue

            ranked: list[tuple[float, str, float]] = []
            for vehicle_id in vehicle_ids:
                try:
                    lane_id = traci.vehicle.getLaneID(vehicle_id)
                    lane_length = traci.lane.getLength(lane_id)
                    lane_position = traci.vehicle.getLanePosition(vehicle_id)
                    speed = traci.vehicle.getSpeed(vehicle_id)
                except traci.TraCIException:
                    continue
                ranked.append((lane_length - lane_position, vehicle_id, speed))

            ranked.sort()
            for index, (distance_to_stop, vehicle_id, speed) in enumerate(ranked):
                if not vehicle_id.endswith("ambulance"):
                    continue
                candidate = {
                    "edge_id": edge_id,
                    "distance_to_stop": float(distance_to_stop),
                    "rank": index,
                    "speed": float(speed),
                }
                if best is None or candidate["distance_to_stop"] < best["distance_to_stop"]:
                    best = candidate
                break
        return best

    def _ambulance_waiting_for_plan(self, ctl: _Ctl, plan_id: str) -> bool:
        if ctl.id == "TL_11":
            plan = PHASE_PLAN_MAP[ctl.id][plan_id]
            vehicle = self._leading_ambulance(plan.queue_edges)
        else:
            group = PHASE_PLAN_MAP[ctl.id][plan_id].group
            vehicle = self._leading_ambulance(tuple(APPROACHES[ctl.id][group]))

        if vehicle is None:
            return False
        if vehicle["distance_to_stop"] > 36.0:
            return False
        return vehicle["rank"] <= 1 and vehicle["speed"] < 2.0

    def _ambulance_rank_for_group(self, ctl: _Ctl, group: str) -> int:
        if ctl.id == "TL_11" and group == "NS":
            edges = ["EXT_TL11_S__TL_11", "TL_00__TL_11"]
        else:
            edges = APPROACHES[ctl.id][group]

        best_rank = 999
        for edge_id in edges:
            try:
                vehicle_ids = list(traci.edge.getLastStepVehicleIDs(edge_id))
            except traci.TraCIException:
                continue
            ranked = []
            for vehicle_id in vehicle_ids:
                try:
                    lane_id = traci.vehicle.getLaneID(vehicle_id)
                    lane_length = traci.lane.getLength(lane_id)
                    lane_position = traci.vehicle.getLanePosition(vehicle_id)
                except traci.TraCIException:
                    continue
                ranked.append((lane_length - lane_position, vehicle_id))
            ranked.sort()
            for index, (_, vehicle_id) in enumerate(ranked):
                if vehicle_id.endswith("ambulance"):
                    best_rank = min(best_rank, index)
                    break
        return best_rank

    def junction_metrics_snapshot(self) -> dict[str, dict[str, float]]:
        metrics: dict[str, dict[str, float]] = {}
        for intersection_id in self.intersections:
            metrics[intersection_id] = {
                "ns_queue": float(self._approach_queue(intersection_id, "NS")),
                "ew_queue": float(self._approach_queue(intersection_id, "EW")),
                "ns_presence": float(self._approach_presence(intersection_id, "NS")),
                "ew_presence": float(self._approach_presence(intersection_id, "EW")),
            }
        return metrics

    def _approach_phase(self, ctl: _Ctl, direction: str) -> SignalPhase:
        if not self.started:
            return SignalPhase.RED
        if ctl.current_plan_id == "":
            return SignalPhase.RED
        plan = PHASE_PLAN_MAP[ctl.id][ctl.current_plan_id]
        if plan.group != direction:
            return SignalPhase.RED
        if ctl.stage == "green":
            return SignalPhase.GREEN
        if ctl.stage == "amber":
            return SignalPhase.AMBER
        return SignalPhase.RED

    def _approach_countdown(self, ctl: _Ctl, direction: str) -> int:
        if ctl.current_plan_id == "":
            return 0
        plan = PHASE_PLAN_MAP[ctl.id][ctl.current_plan_id]
        if plan.group == direction:
            return max(0, int(round(ctl.stage_remaining)))
        return max(0, int(round(ctl.stage_remaining + float(cfg.get("AMBER_DURATION")))))

    def _segment_states(self) -> list[RoadSegmentState]:
        out: list[RoadSegmentState] = []
        for segment_id, edge_forward, edge_back in SEGMENTS:
            count = self._segment_vehicle_count(edge_forward) + self._segment_vehicle_count(edge_back)
            out.append(
                RoadSegmentState(
                    id=segment_id,
                    vehicles_in_transit=count,
                    congestion_level=_congestion_level(count),  # type: ignore[arg-type]
                )
            )
        return out

    def _visual_vehicles(self) -> list[VisualVehicleState]:
        out: list[VisualVehicleState] = []
        try:
            vehicle_ids = traci.vehicle.getIDList()
        except traci.TraCIException:
            return out

        for vehicle_id in vehicle_ids:
            try:
                x, y = traci.vehicle.getPosition(vehicle_id)
                heading = traci.vehicle.getAngle(vehicle_id)
                speed = traci.vehicle.getSpeed(vehicle_id)
            except traci.TraCIException:
                continue

            out.append(
                VisualVehicleState(
                    id=vehicle_id,
                    vehicle_type=_vehicle_type_for(vehicle_id),  # type: ignore[arg-type]
                    x=float(x),
                    z=float(y),
                    heading=float(heading),
                    speed=float(speed),
                    stopped=float(speed) < 0.1,
                )
            )
        return out

    def _empty_snapshot(self) -> SimulationTickState:
        intersections = [
            IntersectionState(
                id=ctl.id,
                name=ctl.name,
                mode=ctl.mode,
                approaches=[
                    ApproachState(direction="NS", phase=SignalPhase.RED, queue_length=0, countdown=0),
                    ApproachState(direction="EW", phase=SignalPhase.RED, queue_length=0, countdown=0),
                ],
                spillback_active=ctl.spillback_active,
                emergency_state=ctl.emergency_state,
            )
            for ctl in self.intersections.values()
        ]
        segments = [
            RoadSegmentState(id=segment_id, vehicles_in_transit=0, congestion_level="clear")
            for segment_id, _, _ in SEGMENTS
        ]
        return SimulationTickState(
            tick=0,
            simulated_time_seconds=0,
            running=False,
            started=False,
            scenario=self.scenario,  # type: ignore[arg-type]
            current_mode=self.current_mode(),
            intersections=intersections,
            segments=segments,
            junction_metrics={
                ctl.id: JunctionMetricState(ns_queue=0.0, ew_queue=0.0, ns_presence=0.0, ew_presence=0.0)
                for ctl in self.intersections.values()
            },
            visual_vehicles=[],
            alerts=[],
        )

    # ------------------------------------------------------- frontend helpers
    def get_segment_states(self) -> list[RoadSegmentState]:
        if not self._connected:
            return self._empty_snapshot().segments
        return self._segment_states()

    def get_visual_vehicle_states(self) -> list[VisualVehicleState]:
        if not self._connected:
            return []
        return self._visual_vehicles()

    def get_intersection_states(self) -> list[IntersectionState]:
        if not self._connected:
            return self._empty_snapshot().intersections
        return [self._intersection_state(ctl) for ctl in self.intersections.values()]


class SumoMetricsAccumulator:
    """Accumulator fed by the SUMO network tick metadata."""

    def __init__(self) -> None:
        self.total_wait_seconds = 0.0
        self.vehicles_completed = 0
        self.emergency_travel_seconds_total = 0.0
        self.emergency_vehicles_completed = 0
        self.total_congestion_score = 0.0
        self.spillback_events = 0
        self.preemption_events = 0
        self.tick_count = 0
        self.green_wave_hits = 0
        self.green_wave_opportunities = 0
        self._prev_spillback = False
        self._prev_spillback_by_intersection = {intersection_id: False for intersection_id in INTERSECTIONS}
        self._prev_preemption = False
        self._recent_completion_ticks: deque[int] = deque()
        self._recent_congestion_scores: deque[float] = deque()
        self._recent_green_wave_outcomes: deque[int] = deque(maxlen=180)
        self.junction_samples: dict[str, dict[str, float]] = {
            intersection_id: {
                "ns_queue_total": 0.0,
                "ew_queue_total": 0.0,
                "ns_presence_total": 0.0,
                "ew_presence_total": 0.0,
                "max_queue": 0.0,
            }
            for intersection_id in INTERSECTIONS
        }

    def record_tick(self, state: SimulationTickState, network: SumoNetwork, meta: dict) -> None:
        tick = int(state.tick or (self.tick_count + 1))

        for record in meta.get("completed", []):
            self.total_wait_seconds += float(record.get("wait_seconds", 0.0))
            self.vehicles_completed += 1
            if record.get("is_emergency"):
                self.emergency_vehicles_completed += 1
                self.emergency_travel_seconds_total += float(record.get("travel_seconds", 0.0))
            self._recent_completion_ticks.append(tick)

        window_ticks = _rolling_window_ticks()
        while self._recent_completion_ticks and tick - self._recent_completion_ticks[0] > window_ticks:
            self._recent_completion_ticks.popleft()

        congestion_score = self._congestion_score(state)
        self.total_congestion_score += congestion_score
        self._recent_congestion_scores.append(congestion_score)
        while len(self._recent_congestion_scores) > window_ticks:
            self._recent_congestion_scores.popleft()

        spillback = False
        for intersection in state.intersections:
            active = bool(intersection.spillback_active)
            spillback = spillback or active
            if active and not self._prev_spillback_by_intersection.get(intersection.id, False):
                self.spillback_events += 1
            self._prev_spillback_by_intersection[intersection.id] = active
        self._prev_spillback = spillback

        preemption = any("preemption" in alert.lower() or "emergency" in alert.lower() for alert in state.alerts)
        if preemption and not self._prev_preemption:
            self.preemption_events += 1
        self._prev_preemption = preemption

        self._record_green_wave(network)

        for intersection_id, snapshot in network.junction_metrics_snapshot().items():
            sample = self.junction_samples[intersection_id]
            sample["ns_queue_total"] += snapshot["ns_queue"]
            sample["ew_queue_total"] += snapshot["ew_queue"]
            sample["ns_presence_total"] += snapshot["ns_presence"]
            sample["ew_presence_total"] += snapshot["ew_presence"]
            sample["max_queue"] = max(sample["max_queue"], snapshot["ns_queue"] + snapshot["ew_queue"])

        self.tick_count += 1

    def avg_wait_time(self) -> float:
        return round(self.total_wait_seconds / max(self.vehicles_completed, 1), 2)

    def total_wait_time(self) -> float:
        return round(self.total_wait_seconds, 2)

    def sample_adjusted_wait_time(
        self,
        baseline_avg_wait: Optional[float] = None,
        baseline_vehicles_completed: Optional[int] = None,
    ) -> float:
        avg_wait = self.avg_wait_time()
        if self.vehicles_completed <= 0:
            return 0.0

        if baseline_avg_wait is None or baseline_avg_wait <= 0:
            baseline_avg_wait = avg_wait

        anchor_count = max(12, min(30, int(baseline_vehicles_completed or 0)))
        return round(
            (self.total_wait_seconds + (baseline_avg_wait * anchor_count)) /
            max(self.vehicles_completed + anchor_count, 1),
            2,
        )

    def throughput_per_min(self) -> float:
        minutes = max(self.tick_count, 1) * _step_length() / 60.0
        return round(self.vehicles_completed / minutes, 2) if minutes > 0 else 0.0

    def avg_emergency_travel_time(self) -> float:
        if self.emergency_vehicles_completed <= 0:
            return 0.0
        return round(self.emergency_travel_seconds_total / self.emergency_vehicles_completed, 2)

    def avg_congestion(self) -> float:
        return round(self.total_congestion_score / max(self.tick_count, 1), 2)

    def current_congestion(self) -> float:
        if not self._recent_congestion_scores:
            return 0.0
        return round(sum(self._recent_congestion_scores) / len(self._recent_congestion_scores), 2)

    def current_throughput_per_min(self) -> float:
        sample_seconds = max(min(self.tick_count, _rolling_window_ticks()) * _step_length(), _step_length())
        if sample_seconds <= 0:
            return 0.0
        return round(len(self._recent_completion_ticks) / (sample_seconds / 60.0), 2)

    def success_rate(self) -> float:
        return self.green_wave_hits / max(self.green_wave_opportunities, 1)

    def current_success_rate(self) -> float:
        if not self._recent_green_wave_outcomes:
            return self.success_rate()
        return sum(self._recent_green_wave_outcomes) / len(self._recent_green_wave_outcomes)

    def _congestion_score(self, state: SimulationTickState) -> float:
        queue_load = sum(
            approach.queue_length
            for intersection in state.intersections
            for approach in intersection.approaches
        )
        segment_load = sum(segment.vehicles_in_transit for segment in state.segments)
        return round((queue_load * 1.25 + segment_load * 0.7) / max(len(state.intersections) * 2, 1), 2)

    def _record_green_wave(self, network: SumoNetwork) -> None:
        checks: list[tuple[bool, bool]] = []
        try:
            upstream_tl00 = network.intersections["TL_00"]
            tl10 = network.intersections["TL_10"]
            tl11 = network.intersections["TL_11"]

            load_to_tl10 = network._segment_vehicle_count("TL_00__TL_10")
            if upstream_tl00.stage == "green" and upstream_tl00.current_plan_id == "NS" and load_to_tl10 > 0:
                checks.append((True, tl10.stage == "green" and tl10.current_plan_id == "NS"))

            load_to_tl11_from_tl10 = network._segment_vehicle_count("TL_10__TL_11")
            upstream_tl10 = network.intersections["TL_10"]
            if upstream_tl10.stage == "green" and upstream_tl10.current_plan_id == "EW" and load_to_tl11_from_tl10 > 0:
                checks.append((True, tl11.stage == "green" and tl11.current_plan_id == "EW"))

            load_to_tl11_from_tl00 = network._segment_vehicle_count("TL_00__TL_11")
            if upstream_tl00.stage == "green" and upstream_tl00.current_plan_id == "EW" and load_to_tl11_from_tl00 > 0:
                checks.append((True, tl11.stage == "green" and tl11.current_plan_id in {"NS_CURVE", "NS_SOUTH"}))
        except Exception:
            checks = []

        for opportunity, hit in checks:
            if not opportunity:
                continue
            self.green_wave_opportunities += 1
            if hit:
                self.green_wave_hits += 1
                self._recent_green_wave_outcomes.append(1)
            else:
                self._recent_green_wave_outcomes.append(0)

    def to_run_summary(self, run_id: str, started_at: str, scenario: str, mode: SignalMode) -> RunSummary:
        avg_wait = self.avg_wait_time()
        return RunSummary(
            run_id=run_id,
            started_at=started_at,
            ran_at=started_at,
            scenario=scenario,
            mode=mode,
            duration_ticks=self.tick_count,
            avg_wait_time_adaptive=avg_wait if mode == SignalMode.ADAPTIVE else 0.0,
            avg_wait_time_fixed=avg_wait if mode == SignalMode.FIXED else 0.0,
            total_wait_seconds=self.total_wait_time(),
            throughput_per_min=self.throughput_per_min(),
            avg_congestion=self.avg_congestion(),
            vehicles_completed=self.vehicles_completed,
            emergency_vehicles_completed=self.emergency_vehicles_completed,
            avg_emergency_travel_time=self.avg_emergency_travel_time(),
            spillback_events=self.spillback_events,
            preemption_events=self.preemption_events,
            green_wave_success_rate=round(self.success_rate(), 4),
            junction_metrics=self.junction_metrics(),
        )

    def junction_metrics(self) -> dict[str, dict[str, float]]:
        result: dict[str, dict[str, float]] = {}
        for intersection_id, sample in self.junction_samples.items():
            ticks = max(self.tick_count, 1)
            result[intersection_id] = {
                "avg_ns_queue": round(sample["ns_queue_total"] / ticks, 2),
                "avg_ew_queue": round(sample["ew_queue_total"] / ticks, 2),
                "avg_ns_presence": round(sample["ns_presence_total"] / ticks, 2),
                "avg_ew_presence": round(sample["ew_presence_total"] / ticks, 2),
                "max_total_queue": round(sample["max_queue"], 2),
            }
        return result

    def reset(self) -> None:
        self.total_wait_seconds = 0.0
        self.vehicles_completed = 0
        self.emergency_travel_seconds_total = 0.0
        self.emergency_vehicles_completed = 0
        self.total_congestion_score = 0.0
        self.spillback_events = 0
        self.preemption_events = 0
        self.tick_count = 0
        self.green_wave_hits = 0
        self.green_wave_opportunities = 0
        self._prev_spillback = False
        self._prev_spillback_by_intersection = {intersection_id: False for intersection_id in INTERSECTIONS}
        self._prev_preemption = False
        self._recent_completion_ticks.clear()
        self._recent_congestion_scores.clear()
        self._recent_green_wave_outcomes.clear()
        self.junction_samples = {
            intersection_id: {
                "ns_queue_total": 0.0,
                "ew_queue_total": 0.0,
                "ns_presence_total": 0.0,
                "ew_presence_total": 0.0,
                "max_queue": 0.0,
            }
            for intersection_id in INTERSECTIONS
        }
