from fastapi import APIRouter, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from rootspread_api.core.config import get_settings
from rootspread_api.core.database import get_session_factory
from rootspread_api.models.task import TaskNode
from rootspread_api.schemas.common import MessageResponse
from rootspread_api.schemas.task import TaskDocumentWriteRequest

router = APIRouter(prefix="/internal/collab", tags=["internal-collab"], include_in_schema=False)


@router.put("/workspaces/{workspace_id}/tasks/{task_id}/document", response_model=MessageResponse)
def persist_task_document(
    workspace_id: str,
    task_id: str,
    payload: TaskDocumentWriteRequest,
    x_collab_secret: str | None = Header(default=None),
) -> MessageResponse:
    settings = get_settings()
    if x_collab_secret != settings.collab_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="协同服务凭证无效。")

    session_factory = get_session_factory()
    session: Session = session_factory()
    try:
        task = session.scalar(
            select(TaskNode).where(
                TaskNode.workspace_id == workspace_id,
                TaskNode.id == task_id,
                TaskNode.archived_at.is_(None),
            )
        )
        if task is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在。")

        if task.content_markdown != payload.content_markdown:
            task.content_markdown = payload.content_markdown
            session.commit()

        return MessageResponse(message="任务文档已保存。")
    finally:
        session.close()
