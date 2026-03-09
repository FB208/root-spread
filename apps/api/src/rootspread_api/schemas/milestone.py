from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from rootspread_api.schemas.common import ORMModel
from rootspread_api.schemas.task import TaskTreeNodeRead


class MilestoneCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    target_at: datetime

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("里程碑名称不能为空")
        return value


class MilestoneRead(ORMModel):
    id: str
    workspace_id: str
    name: str
    description: str | None
    target_at: datetime
    archived_task_count: int
    created_by_user_id: str
    created_at: datetime
    updated_at: datetime


class MilestoneSnapshotRead(ORMModel):
    id: str
    milestone_id: str
    snapshot_name: str
    snapshot_data: list[dict]
    archived_task_count: int
    created_by_user_id: str
    created_at: datetime
    updated_at: datetime


class MilestoneTreeResponse(BaseModel):
    milestone: MilestoneRead
    tree: list[TaskTreeNodeRead]
