"""Pydantic v2 schemas used across REST responses and Socket.IO tick payloads."""
from pydantic import BaseModel
from typing import Literal, Optional
from enum import Enum


class SignalPhase(str, Enum):
    GREEN = "green"
    AMBER = "amber"
    RED = "red"


class SignalMode(str, Enum):
    FIXED = "fixed"
    ADAPTIVE = "adaptive"


class EmergencyState(str, Enum):
    IDLE = "idle"
    INJECTED = "injected"
    PREEMPTING = "preempting"
    ACTIVE = "active"
    CLEARING = "clearing"
    RECOVERING = "recovering"


class ApproachState(BaseModel):
    direction: Literal["NS", "EW"]
    phase: SignalPhase
    queue_length: int
    countdown: int


class IntersectionState(BaseModel):
    id: str
    name: str
    mode: SignalMode
    approaches: list[ApproachState]
    spillback_active: bool
    emergency_state: EmergencyState


class RoadSegmentState(BaseModel):
    id: str
    vehicles_in_transit: int
    congestion_level: Literal["clear", "moderate", "heavy"]


class JunctionMetricState(BaseModel):
    ns_queue: float
    ew_queue: float
    ns_presence: float
    ew_presence: float


class JunctionComparisonState(BaseModel):
    avg_wait_time: float = 0.0
    vehicle_count: int = 0
    throughput_vpm: float = 0.0
    spillback_events: int = 0


class VisualVehicleState(BaseModel):
    """Vehicle render state. SUMO backend drives `x, z, heading` directly.

    Coordinate system: SUMO (x, y) maps 1:1 to three.js (x, z).
    `heading` is in degrees, 0 = north-positive (+y in SUMO, -z in three.js),
    turning clockwise (SUMO convention). The frontend converts.
    """

    id: str
    vehicle_type: Literal["car", "truck", "bus", "motorcycle", "ambulance"]
    x: float = 0.0
    z: float = 0.0
    heading: float = 0.0
    speed: float = 0.0
    is_emergency: bool = False
    stopped: bool = False
    # Legacy fields kept optional so old frontend components don't crash mid-migration.
    path_id: str = ""
    route_id: str = ""
    progress: float = 0.0
    indicator: Optional[Literal["left", "right"]] = None
    lane: int = 0


class SimulationTickState(BaseModel):
    run_id: str = ""
    tick: int
    simulated_time_seconds: int
    running: bool
    started: bool = False
    scenario: Literal["off_peak", "peak"]
    current_mode: SignalMode = SignalMode.FIXED
    intersections: list[IntersectionState]
    segments: list[RoadSegmentState]
    junction_metrics: dict[str, JunctionMetricState] = {}
    current_junction_comparison: dict[str, JunctionComparisonState] = {}
    baseline_junction_comparison: dict[str, JunctionComparisonState] = {}
    visual_vehicles: list[VisualVehicleState] = []
    alerts: list[str]
    spillback_locations: list[str] = []
    network_summary: str = "Clear roads"
    green_wave_success_rate: float = 0.0
    current_run_ticks: int = 0
    vehicles_served_this_run: int = 0
    avg_wait_time_adaptive: float = 0.0
    avg_wait_time_fixed: float = 0.0
    current_avg_wait_time: float = 0.0
    current_total_wait_time: float = 0.0
    current_sample_adjusted_wait_time: float = 0.0
    current_throughput_vpm: float = 0.0
    current_avg_congestion: float = 0.0
    spillback_events: int = 0
    preemption_events: int = 0
    baseline_mode: Optional[SignalMode] = None
    baseline_avg_wait_time: Optional[float] = None
    baseline_total_wait_time: Optional[float] = None
    baseline_vehicles_completed: Optional[int] = None
    baseline_sample_adjusted_wait_time: Optional[float] = None
    baseline_throughput_vpm: Optional[float] = None
    baseline_avg_congestion: Optional[float] = None
    baseline_green_wave_success_rate: Optional[float] = None


class SimulationControlCommand(BaseModel):
    action: Literal["start_run", "pause", "resume", "reset", "set_mode", "set_scenario", "set_network_mode"]
    intersection_id: Optional[str] = None
    mode: Optional[SignalMode] = None
    scenario: Optional[str] = None


class PreemptCommand(BaseModel):
    intersection_id: str
    approach: Literal["NS", "EW"]


class UserPublic(BaseModel):
    username: str
    display_name: str
    role: str


class UserProfile(BaseModel):
    username: str
    display_name: str
    role: str
    email: str
    job_title: str
    contact: str


class UserProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    job_title: Optional[str] = None
    contact: Optional[str] = None


class AlertRecord(BaseModel):
    timestamp: str
    message: str
    level: str


class LoginRequest(BaseModel):
    username: str
    password: str


class SignupRequest(BaseModel):
    username: str
    password: str
    display_name: str
    email: str = ""
    contact: str = ""


class LoginResponse(BaseModel):
    username: str
    display_name: str
    role: str


class ConfigUpdate(BaseModel):
    min_green: Optional[int] = None
    max_green: Optional[int] = None
    amber_duration: Optional[int] = None
    spillback_threshold: Optional[int] = None
    tick_rate_hz: Optional[float] = None
    peak_arrival_rate: Optional[float] = None
    offpeak_arrival_rate: Optional[float] = None
    waiting_speed_threshold_mps: Optional[float] = None
    preemption_hold_seconds: Optional[float] = None
    recovery_seconds: Optional[float] = None


class RunSummary(BaseModel):
    run_id: str
    started_at: str
    ran_at: Optional[str] = None
    scenario: str
    mode: SignalMode
    duration_ticks: int
    avg_wait_time_adaptive: float
    avg_wait_time_fixed: float
    total_wait_seconds: float = 0.0
    throughput_per_min: float = 0.0
    avg_congestion: float = 0.0
    vehicles_completed: int = 0
    emergency_vehicles_completed: int = 0
    avg_emergency_travel_time: float = 0.0
    spillback_events: int
    preemption_events: int
    green_wave_success_rate: float = 0.0
    junction_metrics: Optional[dict[str, dict[str, float]]] = None
    run_seed: Optional[int] = None
