"""Auth REST routes — login, logout, me."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from auth import store
from auth.middleware import COOKIE_NAME, get_current_user
from auth.store import User
from models.schemas import (
    LoginRequest,
    LoginResponse,
    SignupRequest,
    UserProfile,
    UserProfileUpdate,
    UserPublic,
)


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, response: Response) -> LoginResponse:
    token = store.authenticate(body.username, body.password)
    if token is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user = store.get_user(body.username)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=86400,
    )
    return LoginResponse(
        username=user.username, display_name=user.display_name, role=user.role
    )


@router.post("/signup", response_model=LoginResponse)
async def signup(body: SignupRequest, response: Response) -> LoginResponse:
    username = body.username.strip()
    display_name = body.display_name.strip()
    if store.get_user(username) is not None:
        raise HTTPException(status_code=409, detail="Username already exists")

    user = store.create_public_user(
        username=username,
        password=body.password,
        display_name=display_name,
        email=body.email.strip(),
        contact=body.contact.strip(),
    )
    token = store.authenticate(username, body.password)
    if token is None:
        raise HTTPException(status_code=500, detail="Could not create session")

    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=86400,
    )
    return LoginResponse(username=user.username, display_name=user.display_name, role=user.role)


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict:
    token = request.cookies.get(COOKIE_NAME)
    store.logout(token)
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/me", response_model=UserPublic)
async def me(user: User = Depends(get_current_user)) -> UserPublic:
    return UserPublic(username=user.username, display_name=user.display_name, role=user.role)


def _profile(user: User) -> UserProfile:
    return UserProfile(
        username=user.username,
        display_name=user.display_name,
        role=user.role,
        email=user.email,
        job_title=user.job_title,
        contact=user.contact,
    )


@router.get("/profile", response_model=UserProfile)
async def get_profile(user: User = Depends(get_current_user)) -> UserProfile:
    return _profile(user)


@router.patch("/profile", response_model=UserProfile)
async def patch_profile(
    body: UserProfileUpdate, user: User = Depends(get_current_user)
) -> UserProfile:
    updated = store.update_profile(user.username, body.model_dump(exclude_none=True))
    if updated is None:
        raise HTTPException(status_code=404, detail="user not found")
    return _profile(updated)
