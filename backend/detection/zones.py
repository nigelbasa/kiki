"""Polygonal detection zones with ray-cast point-in-polygon classification."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple


@dataclass
class DetectionZone:
    name: str
    polygon: List[Tuple[float, float]]  # normalised 0..1 coordinates (x, y)


@dataclass
class ZoneConfig:
    zones: List[DetectionZone] = field(default_factory=list)

    def point_in_zone(self, zone: DetectionZone, x_norm: float, y_norm: float) -> bool:
        """Standard ray-casting point-in-polygon test."""
        poly = zone.polygon
        n = len(poly)
        if n < 3:
            return False
        inside = False
        j = n - 1
        for i in range(n):
            xi, yi = poly[i]
            xj, yj = poly[j]
            intersect = ((yi > y_norm) != (yj > y_norm)) and (
                x_norm < (xj - xi) * (y_norm - yi) / ((yj - yi) or 1e-9) + xi
            )
            if intersect:
                inside = not inside
            j = i
        return inside

    def classify_detection(self, x_norm: float, y_norm: float) -> Optional[str]:
        for zone in self.zones:
            if self.point_in_zone(zone, x_norm, y_norm):
                return zone.name
        return None

    @classmethod
    def from_dicts(cls, raw: list) -> "ZoneConfig":
        zones = []
        for z in raw:
            poly = [(float(p["x"]), float(p["y"])) for p in z.get("polygon", [])]
            zones.append(DetectionZone(name=z["name"], polygon=poly))
        return cls(zones=zones)
