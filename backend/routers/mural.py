import asyncio
import io
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError

from lib.db import db
from lib.storage import APP_NAME, get_object, put_object
from models.auth import AuthUser
from models.mural import MuralMessage, MuralMessageCreate, MuralPhotoUpload, UnreadCount
from routers.auth import optional_mural_user, require_mural_access

router = APIRouter(prefix="/mural")
logger = logging.getLogger(__name__)
ALLOWED_PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_PHOTO_SIDE = 1920


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


@router.get("/messages", response_model=list[MuralMessage])
async def list_messages(
    user: AuthUser = Depends(require_mural_access),
) -> list[MuralMessage]:
    # Public messages, plus private ones the user sent or received.
    docs = await db.mural_messages.find(
        {
            "$or": [
                {"recipient_user_id": None},
                {"recipient_user_id": user.user_id},
                {"sender_user_id": user.user_id},
            ]
        },
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    # Listing the messages counts as reading them: resets the tab counter.
    # Remember the previous mark so private messages that arrived since then can be flagged as new.
    previous = await db.users.find_one_and_update(
        {"user_id": user.user_id},
        {"$set": {"mural_messages_seen_at": datetime.now(timezone.utc)}},
        projection={"_id": 0, "mural_messages_seen_at": 1},
    )
    seen_at = (previous or {}).get("mural_messages_seen_at")
    seen_at = _as_utc(seen_at) if seen_at else None
    messages = []
    for doc in docs:
        created_at = _as_utc(doc["created_at"])
        is_new = doc["recipient_user_id"] == user.user_id and (
            seen_at is None or created_at > seen_at
        )
        messages.append(MuralMessage(**{**doc, "created_at": created_at, "is_new": is_new}))
    return messages


@router.get("/unread-count", response_model=UnreadCount)
async def unread_count(
    user: AuthUser | None = Depends(optional_mural_user),
) -> UnreadCount:
    if user is None:
        return UnreadCount(count=0)
    doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "mural_messages_seen_at": 1},
    )
    query: dict = {"recipient_user_id": user.user_id}
    seen_at = (doc or {}).get("mural_messages_seen_at")
    if seen_at:
        query["created_at"] = {"$gt": _as_utc(seen_at)}
    return UnreadCount(count=await db.mural_messages.count_documents(query))


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message_id: str,
    user: AuthUser = Depends(require_mural_access),
) -> Response:
    message = await db.mural_messages.find_one(
        {"id": message_id},
        {"_id": 0, "sender_user_id": 1, "recipient_user_id": 1},
    )
    visible = message is not None and (
        message["recipient_user_id"] is None
        or user.user_id in (message["sender_user_id"], message["recipient_user_id"])
    )
    if not visible:
        raise HTTPException(status_code=404, detail="Mensagem não encontrada.")
    if message["sender_user_id"] != user.user_id and not user.is_owner:
        raise HTTPException(status_code=403, detail="Você só pode apagar as suas mensagens.")
    await db.mural_messages.delete_one({"id": message_id})
    # Storage has no delete API: soft-delete the photos so they can no longer be served.
    await db.mural_photos.update_many({"message_id": message_id}, {"$set": {"is_deleted": True}})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _normalise_photo(raw: bytes) -> bytes:
    # Re-encode: fixes phone rotation, shrinks big photos and strips EXIF (incl. GPS location).
    with Image.open(io.BytesIO(raw)) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            background = Image.new("RGB", img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[-1])
            img = background
        else:
            img = img.convert("RGB")
        img.thumbnail((MAX_PHOTO_SIDE, MAX_PHOTO_SIDE))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=85, optimize=True)
        return out.getvalue()


@router.post("/photos", response_model=MuralPhotoUpload)
async def upload_photo(
    file: UploadFile = File(...),
    user: AuthUser = Depends(require_mural_access),
) -> MuralPhotoUpload:
    if file.content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(status_code=422, detail="Envie uma foto JPG, PNG ou WebP.")
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="A foto é muito grande (máximo 15 MB).")
    try:
        data = await asyncio.to_thread(_normalise_photo, raw)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Não foi possível ler essa imagem.") from exc

    photo_id = str(uuid.uuid4())
    path = f"{APP_NAME}/mural/{user.user_id}/{photo_id}.jpg"
    try:
        result = await put_object(path, data, "image/jpeg")
    except Exception as exc:  # storage outage / quota: surface a clear message
        logger.exception("Photo upload failed: %s", exc)
        raise HTTPException(status_code=502, detail="Não foi possível salvar a foto agora.") from exc

    await db.mural_photos.insert_one(
        {
            "id": photo_id,
            "storage_path": result["path"],
            "content_type": "image/jpeg",
            "size": result.get("size", len(data)),
            "uploader_user_id": user.user_id,
            "message_id": None,
            "is_deleted": False,
            "created_at": datetime.now(timezone.utc),
        }
    )
    return MuralPhotoUpload(id=photo_id)


@router.get("/photos/{photo_id}")
async def get_photo(
    photo_id: str,
    user: AuthUser = Depends(require_mural_access),
) -> Response:
    photo = await db.mural_photos.find_one({"id": photo_id, "is_deleted": False}, {"_id": 0})
    if not photo:
        raise HTTPException(status_code=404, detail="Foto não encontrada.")
    if photo["message_id"] is None:
        allowed = photo["uploader_user_id"] == user.user_id  # preview before sending
    else:
        message = await db.mural_messages.find_one(
            {"id": photo["message_id"]},
            {"_id": 0, "sender_user_id": 1, "recipient_user_id": 1},
        )
        allowed = message is not None and (
            message["recipient_user_id"] is None
            or user.user_id in (message["sender_user_id"], message["recipient_user_id"])
        )
    if not allowed:
        raise HTTPException(status_code=404, detail="Foto não encontrada.")
    try:
        data, _ = await get_object(photo["storage_path"])
    except Exception as exc:
        logger.exception("Photo download failed: %s", exc)
        raise HTTPException(status_code=502, detail="Não foi possível carregar a foto.") from exc
    return Response(
        content=data,
        media_type=photo["content_type"],
        headers={"Cache-Control": "private, max-age=86400"},
    )


@router.post("/messages", response_model=MuralMessage)
async def send_message(
    payload: MuralMessageCreate,
    user: AuthUser = Depends(require_mural_access),
) -> MuralMessage:
    body = payload.body.strip()
    photo_ids = list(dict.fromkeys(payload.photo_ids))
    if not body and not photo_ids:
        raise HTTPException(status_code=422, detail="Escreva uma mensagem ou adicione uma foto.")
    if photo_ids:
        owned = await db.mural_photos.count_documents(
            {
                "id": {"$in": photo_ids},
                "uploader_user_id": user.user_id,
                "message_id": None,
                "is_deleted": False,
            }
        )
        if owned != len(photo_ids):
            raise HTTPException(status_code=422, detail="Alguma foto não está disponível. Envie de novo.")

    recipient_name = None
    if payload.recipient_user_id:
        if payload.recipient_user_id == user.user_id:
            raise HTTPException(status_code=422, detail="Escolha outra pessoa do mural.")
        recipient = await db.users.find_one(
            {
                "user_id": payload.recipient_user_id,
                "mural_first_access_at": {"$exists": True},
            },
            {"_id": 0, "name": 1},
        )
        if not recipient:
            raise HTTPException(status_code=404, detail="Essa pessoa não tem acesso ao mural.")
        recipient_name = recipient["name"]

    message = MuralMessage(
        id=str(uuid.uuid4()),
        sender_user_id=user.user_id,
        sender_name=user.name,
        recipient_user_id=payload.recipient_user_id,
        recipient_name=recipient_name,
        body=body,
        created_at=datetime.now(timezone.utc),
        photo_ids=photo_ids,
    )
    await db.mural_messages.insert_one(message.model_dump(exclude={"is_new"}))
    if photo_ids:
        await db.mural_photos.update_many(
            {"id": {"$in": photo_ids}},
            {"$set": {"message_id": message.id}},
        )
    return message
