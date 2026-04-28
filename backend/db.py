"""SQLite database for persisting simulation, auth, and detection data."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).parent / "data" / "rwendo.db"


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS simulation_runs (
            run_id TEXT PRIMARY KEY,
            started_at TEXT,
            ended_at TEXT,
            scenario TEXT,
            mode TEXT,
            duration_ticks INTEGER,
            avg_wait_time REAL,
            throughput_per_min REAL,
            avg_congestion REAL,
            vehicles_completed INTEGER,
            spillback_events INTEGER,
            preemption_events INTEGER,
            green_wave_success_rate REAL
        )
    """)
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(simulation_runs)").fetchall()}
    if "ran_at" not in columns:
        conn.execute("ALTER TABLE simulation_runs ADD COLUMN ran_at TEXT")
    if "junction_metrics_json" not in columns:
        conn.execute("ALTER TABLE simulation_runs ADD COLUMN junction_metrics_json TEXT")
    if "total_wait_seconds" not in columns:
        conn.execute("ALTER TABLE simulation_runs ADD COLUMN total_wait_seconds REAL DEFAULT 0")
    if "emergency_vehicles_completed" not in columns:
        conn.execute("ALTER TABLE simulation_runs ADD COLUMN emergency_vehicles_completed INTEGER DEFAULT 0")
    if "avg_emergency_travel_time" not in columns:
        conn.execute("ALTER TABLE simulation_runs ADD COLUMN avg_emergency_travel_time REAL DEFAULT 0")
    if "run_seed" not in columns:
        conn.execute("ALTER TABLE simulation_runs ADD COLUMN run_seed INTEGER")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tick_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT,
            tick INTEGER,
            avg_wait_time REAL,
            throughput_per_min REAL,
            avg_congestion REAL,
            vehicles_completed INTEGER,
            FOREIGN KEY (run_id) REFERENCES simulation_runs(run_id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            message TEXT,
            level TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS analytics_reports (
            report_id TEXT PRIMARY KEY,
            generated_at TEXT,
            period_label TEXT,
            period_start TEXT,
            period_end TEXT,
            payload_json TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT DEFAULT '',
            job_title TEXT DEFAULT '',
            contact TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS auth_sessions (
            token TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (username) REFERENCES users(username)
        )
    """)
    conn.commit()
    conn.close()


def save_run(run: dict) -> None:
    conn = get_connection()
    conn.execute(
        """INSERT OR REPLACE INTO simulation_runs
        (run_id, started_at, ended_at, scenario, mode, duration_ticks,
         avg_wait_time, total_wait_seconds, throughput_per_min, avg_congestion,
         vehicles_completed, emergency_vehicles_completed, avg_emergency_travel_time,
         spillback_events, preemption_events, green_wave_success_rate,
         ran_at, junction_metrics_json, run_seed)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            run["run_id"], run["started_at"], run.get("ended_at", ""),
            run["scenario"], run["mode"], run["duration_ticks"],
            run["avg_wait_time"], run.get("total_wait_seconds", 0.0), run["throughput_per_min"],
            run["avg_congestion"], run["vehicles_completed"],
            run.get("emergency_vehicles_completed", 0), run.get("avg_emergency_travel_time", 0.0),
            run["spillback_events"], run["preemption_events"],
            run["green_wave_success_rate"], run.get("ran_at", ""),
            json.dumps(run.get("junction_metrics") or {}),
            run.get("run_seed"),
        ),
    )
    conn.commit()
    conn.close()


def save_tick_snapshot(run_id: str, tick: int, avg_wait: float,
                       throughput: float, congestion: float,
                       vehicles: int) -> None:
    conn = get_connection()
    conn.execute(
        """INSERT INTO tick_snapshots
        (run_id, tick, avg_wait_time, throughput_per_min,
         avg_congestion, vehicles_completed)
        VALUES (?,?,?,?,?,?)""",
        (run_id, tick, avg_wait, throughput, congestion, vehicles),
    )
    conn.commit()
    conn.close()


def get_all_runs() -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM simulation_runs ORDER BY COALESCE(ran_at, ended_at, started_at) DESC"
    ).fetchall()
    conn.close()
    return [_decode_run_row(dict(r)) for r in rows]


def get_run(run_id: str) -> Optional[dict]:
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM simulation_runs WHERE run_id = ?", (run_id,)
    ).fetchone()
    conn.close()
    return _decode_run_row(dict(row)) if row else None


def get_tick_snapshots(run_id: str) -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM tick_snapshots WHERE run_id = ? ORDER BY tick",
        (run_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def save_alert(alert: dict) -> None:
    conn = get_connection()
    conn.execute(
        "INSERT INTO alerts (timestamp, message, level) VALUES (?,?,?)",
        (alert["timestamp"], alert["message"], alert["level"]),
    )
    conn.commit()
    conn.close()


def get_alerts(limit: int = 100) -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM alerts ORDER BY id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def clear_alerts() -> None:
    conn = get_connection()
    conn.execute("DELETE FROM alerts")
    conn.commit()
    conn.close()


def get_user(username: str) -> Optional[dict]:
    conn = get_connection()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    return dict(row) if row else None


def create_user(user: dict) -> dict:
    conn = get_connection()
    conn.execute(
        """INSERT INTO users
        (username, display_name, role, password_hash, email, job_title, contact)
        VALUES (?,?,?,?,?,?,?)""",
        (
            user["username"],
            user["display_name"],
            user["role"],
            user["password_hash"],
            user.get("email", ""),
            user.get("job_title", ""),
            user.get("contact", ""),
        ),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (user["username"],)).fetchone()
    conn.close()
    return dict(row)


def ensure_user(user: dict) -> dict:
    existing = get_user(user["username"])
    if existing:
        return existing
    return create_user(user)


def update_user_profile(username: str, updates: dict) -> Optional[dict]:
    allowed = ("display_name", "email", "job_title", "contact")
    fields = [(key, updates[key]) for key in allowed if key in updates and updates[key] is not None]
    if not fields:
        return get_user(username)

    conn = get_connection()
    assignments = ", ".join(f"{key} = ?" for key, _ in fields)
    values = [value for _, value in fields]
    values.append(username)
    conn.execute(f"UPDATE users SET {assignments} WHERE username = ?", values)
    conn.commit()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    return dict(row) if row else None


def create_session(token: str, username: str) -> None:
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO auth_sessions (token, username) VALUES (?, ?)",
        (token, username),
    )
    conn.commit()
    conn.close()


def get_user_by_session(token: str) -> Optional[dict]:
    conn = get_connection()
    row = conn.execute(
        """SELECT u.* FROM auth_sessions s
        JOIN users u ON u.username = s.username
        WHERE s.token = ?""",
        (token,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def delete_session(token: str) -> None:
    conn = get_connection()
    conn.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))
    conn.commit()
    conn.close()


def clear_detection_state() -> None:
    conn = get_connection()
    conn.execute("DELETE FROM alerts")
    conn.execute("DELETE FROM tick_snapshots")
    conn.execute("DELETE FROM simulation_runs")
    conn.commit()
    conn.close()


def save_report(report: dict) -> None:
    conn = get_connection()
    conn.execute(
        """INSERT OR REPLACE INTO analytics_reports
        (report_id, generated_at, period_label, period_start, period_end, payload_json)
        VALUES (?,?,?,?,?,?)""",
        (
            report["report_id"],
            report["generated_at"],
            report["period"]["label"],
            report["period"]["start"],
            report["period"]["end"],
            json.dumps(report),
        ),
    )
    conn.commit()
    conn.close()


def get_all_reports() -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT payload_json FROM analytics_reports ORDER BY generated_at DESC"
    ).fetchall()
    conn.close()
    reports: list[dict] = []
    for row in rows:
        payload = row["payload_json"]
        if not payload:
            continue
        try:
            reports.append(json.loads(payload))
        except json.JSONDecodeError:
            continue
    return reports


def get_report(report_id: str) -> Optional[dict]:
    conn = get_connection()
    row = conn.execute(
        "SELECT payload_json FROM analytics_reports WHERE report_id = ?",
        (report_id,),
    ).fetchone()
    conn.close()
    if not row or not row["payload_json"]:
        return None
    try:
        return json.loads(row["payload_json"])
    except json.JSONDecodeError:
        return None


def _decode_run_row(row: dict) -> dict:
    junction_metrics_json = row.pop("junction_metrics_json", None)
    if junction_metrics_json:
        try:
            row["junction_metrics"] = json.loads(junction_metrics_json)
        except json.JSONDecodeError:
            row["junction_metrics"] = {}
    else:
        row["junction_metrics"] = {}
    return row
