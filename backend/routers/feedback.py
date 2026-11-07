from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
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
from routers.auth import require_mural_access, require_owner

router = APIRouter()


@router.post("/feedback", response_model=FeedbackReceipt)
async def create_feedback(payload: FeedbackCreate) -> FeedbackReceipt:
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
    await db.feedback.insert_one(document)
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
