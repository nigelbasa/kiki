"""Central configuration — all simulation constants live here."""

# Timing (in seconds)
MIN_GREEN: float = 10.0
MAX_GREEN: float = 60.0
AMBER_DURATION: float = 3.0
TICK_RATE_HZ: float = 20.0

# Traffic generation (arrivals per second)
PEAK_ARRIVAL_RATE: float = 0.4
OFFPEAK_ARRIVAL_RATE: float = 0.1

# Network
SPILLBACK_THRESHOLD: int = 15
SEGMENT_TRAVEL_SECONDS: float = 30.0

# Emergency (in seconds)
PREEMPTION_ACTIVATION_SECONDS: float = 2.0
PREEMPTION_HOLD_SECONDS: float = 10.0
RECOVERY_SECONDS: float = 5.0
PREEMPTION_ADAPTIVE_ONLY: bool = True

# Analytics
RUNS_RETENTION: int = 20
