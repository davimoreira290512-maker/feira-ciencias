from datetime import datetime

from pydantic import BaseModel, Field


class GoogleCredentialExchange(BaseModel):
    credential: str = Field(min_length=1, max_length=8192)


class AuthUser(BaseModel):
    user_id: str
    email: str
    name: str
    picture: str | None
    mural_unlocked: bool
    is_owner: bool = False
    is_original_owner: bool = False


class MuralOwnerGrant(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class MuralUnlockRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class MuralPasswordChange(BaseModel):
    new_password: str = Field(min_length=6, max_length=256)


class AuthorizedMuralUser(BaseModel):
    user_id: str
    is_owner: bool
    access_revoked: bool = False
    name: str
    email: str
    first_access_at: datetime
    last_access_at: datetime
