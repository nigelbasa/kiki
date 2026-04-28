"""FastAPI dependencies — guards for authenticated and admin-only routes."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request

from auth import store
from auth.store import User


ADMIN_COOKIE_NAME = "admin_session_token"
PUBLIC_COOKIE_NAME = "public_session_token"


def get_request_portal(request: Request) -> str:
    header_value = (request.headers.get("x-rwendo-portal") or "").strip().lower()
    query_value = (request.query_params.get("portal") or "").strip().lower()
    portal = header_value or query_value
    if portal in {"admin", "public"}:
        return portal
    return ""


async def get_current_user(request: Request) -> User:
    portal = get_request_portal(request)
    if portal == "admin":
        token = request.cookies.get(ADMIN_COOKIE_NAME)
    elif portal == "public":
        token = request.cookies.get(PUBLIC_COOKIE_NAME)
    else:
        token = request.cookies.get(ADMIN_COOKIE_NAME) or request.cookies.get(PUBLIC_COOKIE_NAME)
    user = store.get_user_from_token(token)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


async def require_any_auth(user: User = Depends(get_current_user)) -> User:
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user
