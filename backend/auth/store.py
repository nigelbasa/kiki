"""DB-backed user store + session helpers."""
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from typing import Literal, Optional

import db


SALT = "rwendo-fixed-salt-capstone"


def hash_pw(password: str) -> str:
    return hashlib.sha256(f"{password}{SALT}".encode()).hexdigest()


@dataclass
class User:
    username: str
    display_name: str
    role: Literal["admin", "public"]
    _password_hash: str
    email: str = ""
    job_title: str = ""
    contact: str = ""


def _row_to_user(row: dict | None) -> Optional[User]:
    if row is None:
        return None
    return User(
        username=row["username"],
        display_name=row["display_name"],
        role=row["role"],
        _password_hash=row["password_hash"],
        email=row.get("email", ""),
        job_title=row.get("job_title", ""),
        contact=row.get("contact", ""),
    )


def seed_admin_user() -> User:
    row = db.ensure_user(
        {
            "username": "admin",
            "display_name": "Traffic Admin",
            "role": "admin",
            "password_hash": hash_pw("rwendo-admin-2025"),
            "email": "admin@rwendo.zw",
            "job_title": "Traffic Operations Officer",
            "contact": "+263 77 000 0001",
        }
    )
    return _row_to_user(row)  # type: ignore[return-value]


def create_public_user(
    username: str,
    password: str,
    display_name: str,
    email: str = "",
    contact: str = "",
) -> User:
    row = db.create_user(
        {
            "username": username,
            "display_name": display_name,
            "role": "public",
            "password_hash": hash_pw(password),
            "email": email,
            "job_title": "",
            "contact": contact,
        }
    )
    return _row_to_user(row)  # type: ignore[return-value]


def get_user(username: str) -> Optional[User]:
    return _row_to_user(db.get_user(username))


def authenticate(username: str, password: str) -> Optional[str]:
    user = get_user(username)
    if user is None or user._password_hash != hash_pw(password):
        return None
    token = secrets.token_hex(32)
    db.create_session(token, username)
    return token


def get_user_from_token(token: Optional[str]) -> Optional[User]:
    if not token:
        return None
    return _row_to_user(db.get_user_by_session(token))


def logout(token: Optional[str]) -> None:
    if token:
        db.delete_session(token)


def update_profile(username: str, updates: dict) -> Optional[User]:
    return _row_to_user(db.update_user_profile(username, updates))
