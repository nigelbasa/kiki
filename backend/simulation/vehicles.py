"""Vehicle dataclass and Poisson-based arrival generator."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Literal, Optional

import numpy as np

import config_runtime as cfg


VehicleType = Literal["car", "truck", "bus", "motorcycle"]
Scenario = Literal["off_peak", "peak"]

_TYPE_WEIGHTS = [0.75, 0.08, 0.07, 0.10]
_TYPES: list[VehicleType] = ["car", "truck", "bus", "motorcycle"]


@dataclass
class Vehicle:
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    vehicle_type: VehicleType = "car"
    origin_intersection: str = ""
    ticks_in_queue: float = 0.0
    is_emergency: bool = False
    route_id: str = ""
    stage_index: int = 0
    indicator: Optional[Literal["left", "right"]] = None
    wait_ticks: float = 0.0  # total seconds stopped at red signals


class VehicleGenerator:
    """Generates Poisson-distributed vehicle arrivals per approach per tick."""

    def __init__(self, scenario: Scenario = "off_peak") -> None:
        self.scenario: Scenario = scenario
        self._rng = np.random.default_rng()

    def _rate(self) -> float:
        key = "PEAK_ARRIVAL_RATE" if self.scenario == "peak" else "OFFPEAK_ARRIVAL_RATE"
        return cfg.get(key)

    def generate(self, intersection_id: str, approach: str) -> list[Vehicle]:
        dt = 1.0 / max(cfg.get("TICK_RATE_HZ"), 0.1)
        # Rate is arrivals per second, multiply by dt to get expected arrivals per tick
        count = int(self._rng.poisson(self._rate() * dt))
        vehicles: list[Vehicle] = []
        for _ in range(count):
            vtype_idx = int(self._rng.choice(len(_TYPES), p=_TYPE_WEIGHTS))
            vehicles.append(
                Vehicle(
                    vehicle_type=_TYPES[vtype_idx],
                    origin_intersection=intersection_id,
                )
            )
        return vehicles

    def set_scenario(self, scenario: str) -> None:
        if scenario not in ("off_peak", "peak"):
            raise ValueError(f"unknown scenario {scenario!r}")
        self.scenario = scenario  # type: ignore[assignment]

    def generate_for_edge(self, edge_id: str, route_ids: list[str]) -> list[Vehicle]:
        if not route_ids:
            return []

        dt = 1.0 / max(cfg.get("TICK_RATE_HZ"), 0.1)
        count = int(self._rng.poisson(self._rate() * dt))
        vehicles: list[Vehicle] = []
        for _ in range(count):
            vtype_idx = int(self._rng.choice(len(_TYPES), p=_TYPE_WEIGHTS))
            route_idx = int(self._rng.integers(0, len(route_ids)))
            is_emergency = bool(self._rng.random() < 0.01)
            vehicles.append(
                Vehicle(
                    vehicle_type=_TYPES[vtype_idx],
                    origin_intersection=edge_id,
                    is_emergency=is_emergency,
                    route_id=route_ids[route_idx],
                )
            )
        return vehicles
