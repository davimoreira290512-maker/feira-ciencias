from datetime import datetime

from pydantic import BaseModel, Field


class MuralMessageCreate(BaseModel):
    body: str = Field(default="", max_length=1000)
    # None = message for everyone with mural access
    recipient_user_id: str | None = None
    photo_ids: list[str] = Field(default_factory=list, max_length=4)


class MuralPhotoUpload(BaseModel):
    id: str


class MuralMessage(BaseModel):
    id: str
    sender_user_id: str
    sender_name: str
    recipient_user_id: str | None
    recipient_name: str | None
    body: str
    created_at: datetime
    photo_ids: list[str] = Field(default_factory=list)
    # Response-only: private message to the viewer that arrived since their last visit.
    is_new: bool = False


class UnreadCount(BaseModel):
    count: int
