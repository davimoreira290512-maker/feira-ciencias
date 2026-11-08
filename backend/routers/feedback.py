import hashlib
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel

from lib.db import db
from models.auth import AuthUser
from models.feedback import (
    FeedbackCreate,
    FeedbackCriteriaAverages,
    FeedbackReceipt,
    FeedbackSummary,
    FeedbackSuggestion,
    RatingCount,
    new_feedback_id,
    utc_now,
)
from routers.auth import optional_mural_user, require_mural_access, require_owner

router = APIRouter()


ANONYMOUS_FEEDBACK_COOKIE = "feedback_visitor"
ANONYMOUS_FEEDBACK_COOKIE_SECONDS = 365 * 24 * 60 * 60


class FeedbackStatus(BaseModel):
    already_submitted: bool
    can_repeat: bool


@router.get("/feedback/status", response_model=FeedbackStatus)
async def get_feedback_status(
    request: Request,
    mural_user: AuthUser | None = Depends(optional_mural_user),
) -> FeedbackStatus:
    # People with authorized mural access are explicitly allowed to submit again.
    if mural_user is not None:
        return FeedbackStatus(already_submitted=False, can_repeat=True)

    visitor_token = request.cookies.get(ANONYMOUS_FEEDBACK_COOKIE)
    if not visitor_token:
        return FeedbackStatus(already_submitted=False, can_repeat=False)

    visitor_hash = hashlib.sha256(visitor_token.encode("utf-8")).hexdigest()
    already_submitted = await db.feedback_visitor_claims.find_one(
        {"visitor_hash": visitor_hash}, {"_id": 1}
    ) is not None
    return FeedbackStatus(already_submitted=already_submitted, can_repeat=False)


@router.post("/feedback", response_model=FeedbackReceipt)
async def create_feedback(
    payload: FeedbackCreate,
    request: Request,
    response: Response,
    mural_user: AuthUser | None = Depends(optional_mural_user),
) -> FeedbackReceipt:
    feedback_id = new_feedback_id()
    rating = payload.rating
    document = {
        "id": feedback_id,
        "rating": rating,
        "decoration_rating": payload.decoration_rating,
        "information_rating": payload.information_rating,
        "project_name": payload.project_name.strip() or "Apresentação geral",
        "suggestion": payload.suggestion.strip(),
        "created_at": utc_now(),
    }

    # Authorized mural users may continue submitting multiple evaluations.
    if mural_user is not None:
        await db.feedback.insert_one(document)
        return FeedbackReceipt(id=feedback_id, rating=rating)

    # The unique index is also created here so simultaneous first requests cannot
    # bypass the one-visitor/one-evaluation rule during application startup.
    await db.feedback_visitor_claims.create_index(
        [("visitor_hash", 1)], name="visitor_hash_unique", unique=True
    )

    visitor_token = request.cookies.get(ANONYMOUS_FEEDBACK_COOKIE)
    is_new_cookie = not visitor_token
    if is_new_cookie:
        visitor_token = secrets.token_urlsafe(32)

    visitor_hash = hashlib.sha256(visitor_token.encode("utf-8")).hexdigest()
    if await db.feedback_visitor_claims.find_one(
        {"visitor_hash": visitor_hash}, {"_id": 1}
    ):
        raise HTTPException(
            status_code=409,
            detail="Este navegador já enviou uma avaliação. Cada visitante pode avaliar apenas uma vez.",
        )

    try:
        await db.feedback_visitor_claims.insert_one(
            {
                "visitor_hash": visitor_hash,
                "feedback_id": feedback_id,
                "created_at": utc_now(),
            }
        )
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="Este navegador já enviou uma avaliação. Cada visitante pode avaliar apenas uma vez.",
        )

    try:
        await db.feedback.insert_one(document)
    except Exception:
        # Do not leave a visitor blocked if the evaluation itself was not saved.
        await db.feedback_visitor_claims.delete_one(
            {"visitor_hash": visitor_hash, "feedback_id": feedback_id}
        )
        raise

    if is_new_cookie:
        response.set_cookie(
            key=ANONYMOUS_FEEDBACK_COOKIE,
            value=visitor_token,
            max_age=ANONYMOUS_FEEDBACK_COOKIE_SECONDS,
            httponly=True,
            secure=True,
            samesite="none",
            path="/",
        )

    return FeedbackReceipt(id=feedback_id, rating=rating)


@router.get("/feedback/summary", response_model=FeedbackSummary)
async def get_feedback_summary(
    _: AuthUser = Depends(require_mural_access),
) -> FeedbackSummary:
    total = await db.feedback.count_documents({})
    rating_rows = await db.feedback.aggregate(
        [
            {
                "$group": {
                    "_id": "$rating",
                    "count": {"$sum": 1},
                }
            }
        ]
    ).to_list(5)
    rating_counts = [
        RatingCount(rating=row["_id"], count=row["count"])
        for row in sorted(rating_rows, key=lambda row: row["_id"])
    ]
    rating_total = sum(row.rating * row.count for row in rating_counts)
    average_rating = round(rating_total / total, 1) if total else None
    averages_rows = await db.feedback.aggregate(
        [
            {
                "$group": {
                    "_id": None,
                    "decoration": {"$avg": "$decoration_rating"},
                    "information": {"$avg": "$information_rating"},
                }
            }
        ]
    ).to_list(1)
    averages = averages_rows[0] if averages_rows else {}
    criteria_averages = FeedbackCriteriaAverages(
        decoration=(
            round(averages["decoration"], 1)
            if averages.get("decoration") is not None
            else None
        ),
        information=(
            round(averages["information"], 1)
            if averages.get("information") is not None
            else None
        ),
    )

    suggestion_docs = await db.feedback.find(
        {"suggestion": {"$ne": ""}},
        {"_id": 0, "project_name": 1, "suggestion": 1},
    ).sort("created_at", -1).to_list(50)
    suggestions = [FeedbackSuggestion(**doc) for doc in suggestion_docs]

    return FeedbackSummary(
        total=total,
        average_rating=average_rating,
        criteria_averages=criteria_averages,
        rating_counts=rating_counts,
        suggestions=suggestions,
    )


class FeedbackAdminItem(BaseModel):
    id: str
    rating: int
    decoration_rating: int
    information_rating: int
    project_name: str
    suggestion: str
    created_at: datetime


@router.get("/feedback/manage", response_model=list[FeedbackAdminItem])
async def list_feedback_for_owner(
    _: AuthUser = Depends(require_owner),
) -> list[FeedbackAdminItem]:
    """Return individual anonymous evaluations only to the mural owner."""
    documents = await db.feedback.find(
        {},
        {
            "_id": 0,
            "id": 1,
            "rating": 1,
            "decoration_rating": 1,
            "information_rating": 1,
            "project_name": 1,
            "suggestion": 1,
            "created_at": 1,
        },
    ).sort("created_at", -1).to_list(500)
    return [FeedbackAdminItem(**document) for document in documents]


@router.delete("/feedback/{feedback_id}", status_code=204)
async def delete_feedback(
    feedback_id: str,
    _: AuthUser = Depends(require_owner),
):
    """Permanently delete one evaluation; the owner check is enforced server-side."""
    result = await db.feedback.delete_one({"id": feedback_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Avaliação não encontrada.")
    return None
