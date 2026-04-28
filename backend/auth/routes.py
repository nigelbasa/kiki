"""Auth REST routes — login, logout, me."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from auth import store
from auth.middleware import ADMIN_COOKIE_NAME, PUBLIC_COOKIE_NAME, get_current_user
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


def _set_portal_cookie(response: Response, cookie_name: str, token: str) -> None:
    response.set_cookie(
        key=cookie_name,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=86400,
        # Without path="/", the cookie defaults to the directory of the login
        # URL (/api/auth/admin), and the browser will refuse to attach it on
        # later calls to /api/analytics, /api/simulation, etc — every guarded
        # route then 401s after a successful login.
        path="/",
    )


@router.post("/admin/login", response_model=LoginResponse)
async def admin_login(body: LoginRequest, response: Response) -> LoginResponse:
    token = store.authenticate(body.username, body.password)
    if token is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user = store.get_user(body.username)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin accounts only")
    _set_portal_cookie(response, ADMIN_COOKIE_NAME, token)
    return LoginResponse(
        username=user.username, display_name=user.display_name, role=user.role
    )


@router.post("/public/login", response_model=LoginResponse)
async def public_login(body: LoginRequest, response: Response) -> LoginResponse:
    token = store.authenticate(body.username, body.password)
    if token is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user = store.get_user(body.username)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role != "public":
        raise HTTPException(status_code=403, detail="Public accounts only")
    _set_portal_cookie(response, PUBLIC_COOKIE_NAME, token)
    return LoginResponse(
        username=user.username, display_name=user.display_name, role=user.role
    )


@router.post("/public/signup", response_model=LoginResponse)
async def public_signup(body: SignupRequest, response: Response) -> LoginResponse:
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

    _set_portal_cookie(response, PUBLIC_COOKIE_NAME, token)
    return LoginResponse(username=user.username, display_name=user.display_name, role=user.role)


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict:
    portal = (request.headers.get("x-rwendo-portal") or request.query_params.get("portal") or "").strip().lower()
    cookie_name = ADMIN_COOKIE_NAME if portal == "admin" else PUBLIC_COOKIE_NAME if portal == "public" else ""
    token = request.cookies.get(cookie_name) if cookie_name else None
    store.logout(token)
    # Match the path used when the cookie was set, otherwise the browser
    # treats this as a different cookie and the original is left in place.
    if portal == "admin":
        response.delete_cookie(ADMIN_COOKIE_NAME, path="/")
    elif portal == "public":
        response.delete_cookie(PUBLIC_COOKIE_NAME, path="/")
    else:
        response.delete_cookie(ADMIN_COOKIE_NAME, path="/")
        response.delete_cookie(PUBLIC_COOKIE_NAME, path="/")
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
