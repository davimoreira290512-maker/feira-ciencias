import asyncio
import hmac
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

import secrets

from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from passlib.context import CryptContext
from pymongo import ReturnDocument

from lib.db import db
from models.auth import (
    AuthorizedMuralUser,
    AuthUser,
    GoogleCredentialExchange,
    MuralOwnerGrant,
    MuralPasswordChange,
    MuralUnlockRequest,
)

router = APIRouter(prefix="/auth")
logger = logging.getLogger(__name__)
SESSION_COOKIE = "session_token"
SESSION_SECONDS = 7 * 24 * 60 * 60
MURAL_SETTINGS_ID = "mural"
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _is_original_owner(email: str) -> bool:
    owner = os.environ.get("MURAL_OWNER_EMAIL", "").strip().lower()
    return bool(owner) and email.strip().lower() == owner


async def _is_owner(email: str) -> bool:
    normalized = email.strip().lower()
    if _is_original_owner(normalized):
        return True
    return bool(await db.mural_owners.find_one({"email": normalized}, {"_id": 1}))


async def _owner_flags(email: str) -> tuple[bool, bool]:
    original = _is_original_owner(email)
    return original or await _is_owner(email), original


async def _password_matches(password: str) -> bool:
    # A password changed in-app (stored as a bcrypt hash) overrides the initial secret.
    settings = await db.settings.find_one({"_id": MURAL_SETTINGS_ID}, {"password_hash": 1})
    if settings and settings.get("password_hash"):
        return pwd_context.verify(password, settings["password_hash"])
    return hmac.compare_digest(
        password.encode("utf-8"),
        os.environ["FEEDBACK_MURAL_PASSWORD"].encode("utf-8"),
    )


def _session_token(request: Request) -> str | None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        return token
    authorization = request.headers.get("Authorization", "")
    if authorization.startswith("Bearer "):
        return authorization.removeprefix("Bearer ").strip() or None
    return None


async def get_session_context(request: Request) -> dict:
    token = _session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Entre com sua conta Google.")

    session = await db.user_sessions.find_one(
        {"session_token": token},
        {"_id": 0},
    )
    if not session:
        raise HTTPException(status_code=401, detail="Sessão não encontrada.")

    expires_at = session["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        await db.user_sessions.delete_one({"session_token": token})
        raise HTTPException(status_code=401, detail="Sua sessão expirou. Entre novamente.")

    user = await db.users.find_one(
        {"user_id": session["user_id"]},
        {"_id": 0},
    )
    if not user:
        raise HTTPException(status_code=401, detail="Conta não encontrada.")

    is_owner, is_original_owner = await _owner_flags(user["email"])
    is_revoked = bool(
        await db.mural_access_revocations.find_one(
            {"email": user["email"].strip().lower()},
            {"_id": 1},
        )
    )
    auth_user = AuthUser(
        user_id=user["user_id"],
        email=user["email"],
        name=user["name"],
        picture=user.get("picture"),
        mural_unlocked=bool(session.get("mural_unlocked", False)) and not is_revoked,
        is_owner=is_owner,
        is_original_owner=is_original_owner,
    )
    return {"token": token, "session": session, "user": auth_user}


async def require_mural_access(
    context: dict = Depends(get_session_context),
) -> AuthUser:
    if not context["user"].mural_unlocked:
        raise HTTPException(status_code=403, detail="Digite a senha para acessar o mural.")
    return context["user"]


async def optional_mural_user(request: Request) -> AuthUser | None:
    # For soft endpoints (e.g. the tab counter): anonymous or locked visitors get None, not an error.
    try:
        context = await get_session_context(request)
    except HTTPException:
        return None
    user = context["user"]
    return user if user.mural_unlocked else None


async def require_owner(
    user: AuthUser = Depends(require_mural_access),
) -> AuthUser:
    if not user.is_owner:
        raise HTTPException(status_code=403, detail="Somente um dono do mural pode fazer isso.")
    return user


async def require_original_owner(
    user: AuthUser = Depends(require_mural_access),
) -> AuthUser:
    if not user.is_original_owner:
        raise HTTPException(status_code=403, detail="Somente o dono original pode administrar outros donos.")
    return user


@router.post("/google", response_model=AuthUser)
async def sign_in_with_google(
    payload: GoogleCredentialExchange,
    response: Response,
) -> AuthUser:
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        logger.error("GOOGLE_CLIENT_ID is not configured")
        raise HTTPException(
            status_code=503,
            detail="O login Google ainda não está configurado no servidor.",
        )

    try:
        claims = await asyncio.to_thread(
            id_token.verify_oauth2_token,
            payload.credential,
            google_requests.Request(),
            client_id,
        )
    except Exception as exc:
        logger.warning("Google ID token verification failed: %s", exc)
        raise HTTPException(
            status_code=401,
            detail="Não foi possível confirmar sua conta Google. Entre novamente.",
        ) from exc

    email = str(claims.get("email", "")).strip().lower()
    if not email or claims.get("email_verified") is not True:
        raise HTTPException(
            status_code=401,
            detail="O Google não confirmou o endereço de e-mail desta conta.",
        )

    now = datetime.now(timezone.utc)
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = await db.users.find_one_and_update(
        {"email": email},
        {
            "$set": {
                "name": str(claims.get("name") or email),
                "picture": claims.get("picture"),
            },
            "$setOnInsert": {
                "user_id": user_id,
                "email": email,
                "created_at": now,
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )

    session_token = secrets.token_urlsafe(32)
    expires_at = now + timedelta(seconds=SESSION_SECONDS)
    await db.user_sessions.insert_one(
        {
            "session_token": session_token,
            "user_id": user["user_id"],
            "expires_at": expires_at,
            "created_at": now,
            "mural_unlocked": False,
        }
    )
    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_token,
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )
    is_owner, is_original_owner = await _owner_flags(user["email"])
    return AuthUser(
        user_id=user["user_id"],
        email=user["email"],
        name=user["name"],
        picture=user.get("picture"),
        mural_unlocked=False,
        is_owner=is_owner,
        is_original_owner=is_original_owner,
    )

@router.get("/me", response_model=AuthUser)
async def get_current_user(
    context: dict = Depends(get_session_context),
) -> AuthUser:
    return context["user"]


@router.post("/unlock", response_model=AuthUser)
async def unlock_mural(
    payload: MuralUnlockRequest,
    context: dict = Depends(get_session_context),
) -> AuthUser:
    email = context["user"].email.strip().lower()
    if await db.mural_access_revocations.find_one({"email": email}, {"_id": 1}):
        raise HTTPException(
            status_code=403,
            detail="Seu acesso ao mural foi removido. Peça autorização a um dono.",
        )
    if not await _password_matches(payload.password):
        raise HTTPException(status_code=403, detail="A senha do mural está incorreta.")

    await db.user_sessions.update_one(
        {"session_token": context["token"]},
        {"$set": {"mural_unlocked": True}},
    )
    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"user_id": context["user"].user_id},
        {
            "$set": {"mural_last_access_at": now},
            "$min": {"mural_first_access_at": now},
        },
    )
    return context["user"].model_copy(update={"mural_unlocked": True})


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


@router.get("/authorized-users", response_model=list[AuthorizedMuralUser])
async def list_authorized_users(
    _: AuthUser = Depends(require_mural_access),
) -> list[AuthorizedMuralUser]:
    docs = await db.users.find(
        {"mural_first_access_at": {"$exists": True}},
        {
            "_id": 0,
            "user_id": 1,
            "name": 1,
            "email": 1,
            "mural_first_access_at": 1,
            "mural_last_access_at": 1,
            "mural_access_revoked_at": 1,
        },
    ).sort("mural_last_access_at", -1).to_list(500)
    return [
        AuthorizedMuralUser(
            user_id=doc["user_id"],
            is_owner=await _is_owner(doc["email"]),
            access_revoked=bool(doc.get("mural_access_revoked_at")),
            name=doc["name"],
            email=doc["email"],
            first_access_at=_as_utc(doc["mural_first_access_at"]),
            last_access_at=_as_utc(
                doc.get("mural_last_access_at") or doc["mural_first_access_at"]
            ),
        )
        for doc in docs
    ]


@router.delete("/authorized-users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_authorized_user(
    user_id: str,
    owner: AuthUser = Depends(require_owner),
) -> Response:
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0, "email": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Essa pessoa não está na lista do mural.")
    target_email = target["email"].strip().lower()
    if user_id == owner.user_id or await _is_owner(target_email):
        raise HTTPException(status_code=422, detail="Não é permitido remover o acesso de um dono.")
    await db.mural_access_revocations.update_one(
        {"email": target_email},
        {"$set": {"email": target_email, "revoked_by": owner.email, "revoked_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"mural_access_revoked_at": datetime.now(timezone.utc)}},
    )
    # Every session of that person is locked immediately.
    await db.user_sessions.update_many(
        {"user_id": user_id},
        {"$set": {"mural_unlocked": False}},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/authorized-users/{user_id}/authorize", status_code=status.HTTP_204_NO_CONTENT)
async def authorize_mural_user(
    user_id: str,
    owner: AuthUser = Depends(require_owner),
) -> Response:
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0, "email": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Conta não encontrada.")
    email = target["email"].strip().lower()
    await db.mural_access_revocations.delete_one({"email": email})
    await db.users.update_one({"user_id": user_id}, {"$unset": {"mural_access_revoked_at": ""}})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/owners")
async def list_mural_owners(
    _: AuthUser = Depends(require_owner),
) -> list[dict]:
    original_email = os.environ.get("MURAL_OWNER_EMAIL", "").strip().lower()
    delegated = await db.mural_owners.find({}, {"_id": 0, "email": 1, "granted_by": 1, "created_at": 1}).to_list(200)
    result = []
    if original_email:
        result.append({"email": original_email, "is_original": True, "granted_by": None, "created_at": None})
    result.extend({**item, "is_original": False} for item in delegated)
    return result


@router.post("/owners", status_code=status.HTTP_201_CREATED)
async def grant_mural_owner(
    payload: MuralOwnerGrant,
    owner: AuthUser = Depends(require_original_owner),
) -> dict:
    email = payload.email.strip().lower()
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise HTTPException(status_code=422, detail="Informe um e-mail válido.")
    if _is_original_owner(email):
        raise HTTPException(status_code=409, detail="Essa pessoa já é o dono original.")
    now = datetime.now(timezone.utc)
    await db.mural_owners.update_one(
        {"email": email},
        {"$setOnInsert": {"email": email, "granted_by": owner.email, "created_at": now}},
        upsert=True,
    )
    # If this email had been blocked as a participant, promotion explicitly restores its access.
    await db.mural_access_revocations.delete_one({"email": email})
    await db.users.update_one({"email": email}, {"$unset": {"mural_access_revoked_at": ""}})
    return {"email": email, "is_original": False, "granted_by": owner.email, "created_at": now}


@router.delete("/owners/{email}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_mural_owner(
    email: str,
    owner: AuthUser = Depends(require_original_owner),
) -> Response:
    normalized = email.strip().lower()
    if _is_original_owner(normalized):
        raise HTTPException(status_code=422, detail="O dono original não pode ser removido.")
    result = await db.mural_owners.delete_one({"email": normalized})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Dono delegado não encontrado.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/mural-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_mural_password(
    payload: MuralPasswordChange,
    _: AuthUser = Depends(require_owner),
) -> Response:
    # People already inside keep access (owner's choice); new entries need the new password.
    await db.settings.update_one(
        {"_id": MURAL_SETTINGS_ID},
        {
            "$set": {
                "password_hash": pwd_context.hash(payload.new_password),
                "password_updated_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request) -> Response:
    token = _session_token(request)
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        key=SESSION_COOKIE,
        path="/",
        httponly=True,
        secure=True,
        samesite="none",
    )
    return response