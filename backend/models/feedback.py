import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, Field


class FeedbackCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    decoration_rating: int = Field(ge=1, le=5)
    information_rating: int = Field(ge=1, le=5)
    project_name: str = Field(default="", max_length=100)
    suggestion: str = Field(default="", max_length=280)


class FeedbackReceipt(BaseModel):
    id: str
    rating: int


class RatingCount(BaseModel):
    rating: int
    count: int


class FeedbackSuggestion(BaseModel):
    project_name: str
    suggestion: str


class FeedbackCriteriaAverages(BaseModel):
    decoration: float | None
    information: float | None


class FeedbackSummary(BaseModel):
    total: int
    average_rating: float | None
    criteria_averages: FeedbackCriteriaAverages
    rating_counts: list[RatingCount]
    suggestions: list[FeedbackSuggestion]


def new_feedback_id() -> str:
    return str(uuid.uuid4())


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class FeedbackAdminItem(BaseModel):
    id: str
    rating: int
    decoration_rating: int
    information_rating: int
    project_name: str
    suggestion: str
    created_at: datetime


class FeedbackBulkDelete(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)


class FeedbackDeleteResult(BaseModel):
    deleted_count: int
