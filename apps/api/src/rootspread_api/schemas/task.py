from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from rootspread_api.models.task import TaskStatus
from rootspread_api.schemas.common import ORMModel


class TaskCreateRequest(BaseModel):
    parent_id: str | None = None
    title: str = Field(min_length=1, max_length=200)
    content_markdown: str = ""
    assignee_user_id: str | None = None
    planned_due_at: datetime | None = None
    weight: int = Field(default=0, ge=0, le=100000)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("标题不能为空")
        return value


class TaskUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content_markdown: str | None = None
    assignee_user_id: str | None = None
    planned_due_at: datetime | None = None
    weight: int | None = Field(default=None, ge=0, le=100000)
    score: int | None = Field(default=None, ge=0, le=100000)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None

        value = value.strip()
        if not value:
            raise ValueError("标题不能为空")
        return value


class TaskStatusUpdateRequest(BaseModel):
    status: TaskStatus
    remark: str | None = Field(default=None, max_length=4000)


class TaskReorderRequest(BaseModel):
    parent_id: str | None = None
    task_ids: list[str] = Field(min_length=1)


class TaskBulkStatusUpdateRequest(BaseModel):
    task_ids: list[str] = Field(min_length=1)
    status: TaskStatus
    remark: str | None = Field(default=None, max_length=4000)


class TaskBulkDeleteRequest(BaseModel):
    task_ids: list[str] = Field(min_length=1)


class TaskNodeRead(ORMModel):
    id: str
    workspace_id: str
    parent_id: str | None
    root_id: str
    path: str
    depth: int
    sort_order: int
    title: str
    content_markdown: str
    created_by_user_id: str
    assignee_user_id: str | None
    planned_due_at: datetime | None
    completed_at: datetime | None
    archived_at: datetime | None
    archived_by_milestone_id: str | None
    weight: int
    score: int | None
    status: TaskStatus
    created_at: datetime
    updated_at: datetime


class TaskTreeNodeRead(TaskNodeRead):
    matched_filter: bool = True
    children: list["TaskTreeNodeRead"] = Field(default_factory=list)


class TaskStatusTransitionRead(ORMModel):
    id: str
    task_node_id: str
    from_status: str | None
    to_status: str
    action_type: str
    remark: str | None
    operator_user_id: str
    created_at: datetime
    updated_at: datetime


TaskTreeNodeRead.model_rebuild()
