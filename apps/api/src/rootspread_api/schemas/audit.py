from datetime import datetime

from pydantic import BaseModel

from rootspread_api.schemas.common import ORMModel


class AuditLogRead(ORMModel):
    id: str
    workspace_id: str
    actor_user_id: str | None
    entity_type: str
    entity_id: str | None
    action: str
    message: str
    metadata_json: dict | None
    created_at: datetime
    updated_at: datetime


class WorkspaceStatsRead(BaseModel):
    workspace_id: str
    active_task_count: int
    archived_task_count: int
    member_count: int
    pending_invitation_count: int
    milestone_count: int
    completed_task_count: int
    pending_review_task_count: int
    terminated_task_count: int
    in_progress_task_count: int
    recent_activity_count: int
