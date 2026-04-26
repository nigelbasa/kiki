"""Single source of truth for runtime-mutable config.

Initialised from config.py constants at import time. All simulation classes
import from here, not config.py directly, so values can be tuned at runtime
via POST /api/simulation/config.
"""
from __future__ import annotations

from threading import Lock

import config as _defaults


_lock = Lock()
_state: dict = {k: v for k, v in vars(_defaults).items() if k.isupper()}


def get(key: str):
    with _lock:
        return _state[key]


def update(updates: dict) -> dict:
    """Write only keys that already exist in state. Returns a snapshot."""
    normalised: dict = {}
    for k, v in updates.items():
        if v is None:
            continue
        normalised[k.upper()] = v
    with _lock:
        for k, v in normalised.items():
            if k in _state:
                _state[k] = v
        return dict(_state)


def snapshot() -> dict:
    with _lock:
        return dict(_state)
