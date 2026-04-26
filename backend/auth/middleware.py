"""FastAPI dependencies — guards for authenticated and admin-only routes."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request

from auth import store
from auth.store import User


COOKIE_NAME = "session_token"


async def get_current_user(request: Request) -> User:
    token = request.cookies.get(COOKIE_NAME)
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
