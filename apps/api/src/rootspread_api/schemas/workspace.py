from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from rootspread_api.schemas.common import MessageResponse, ORMModel

WorkspaceRole = Literal["owner", "admin", "member"]


class WorkspaceCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    slug: str | None = Field(default=None, min_length=2, max_length=160)


class WorkspaceRead(ORMModel):
    id: str
    name: str
    slug: str
    owner_user_id: str
    created_at: datetime
    updated_at: datetime


class WorkspaceListItem(BaseModel):
    id: str
    name: str
    slug: str
    role: WorkspaceRole
    created_at: datetime
    updated_at: datetime


class WorkspaceMemberSummary(BaseModel):
    id: str
    email: EmailStr
    display_name: str
    avatar_url: str | None = None


class WorkspaceMemberRead(BaseModel):
    id: str
    role: WorkspaceRole
    status: str
    joined_at: datetime
    user: WorkspaceMemberSummary


class WorkspaceMemberUpdateRequest(BaseModel):
    role: Literal["admin", "member"]


class InvitationCreateRequest(BaseModel):
    email: EmailStr
    role: Literal["admin", "member"] = "member"


class InvitationAcceptRequest(BaseModel):
    token: str = Field(min_length=20, max_length=255)


class WorkspaceInvitationRead(ORMModel):
    id: str
    workspace_id: str
    email: EmailStr
    role: WorkspaceRole
    invited_by_user_id: str
    expires_at: datetime
    accepted_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    updated_at: datetime


class WorkspaceInvitationDispatchResponse(MessageResponse):
    invitation: WorkspaceInvitationRead
    debug_invitation_token: str | None = None


class PendingInvitationRead(BaseModel):
    id: str
    workspace_id: str
    workspace_name: str
    role: WorkspaceRole
    email: EmailStr
    expires_at: datetime
    invited_by_user_id: str
