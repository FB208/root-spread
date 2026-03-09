from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from rootspread_api.api.dependencies.auth import get_current_verified_user
from rootspread_api.core.database import get_db
from rootspread_api.models.milestone import Milestone, MilestoneSnapshot
from rootspread_api.models.task import TaskNode, TaskStatus
from rootspread_api.models.user import User
from rootspread_api.models.workspace import WorkspaceMember
from rootspread_api.schemas.milestone import (
    MilestoneCreateRequest,
    MilestoneRead,
    MilestoneTreeResponse,
)
from rootspread_api.services.audit_service import log_audit_event
from rootspread_api.services.milestone_service import (
    archive_tasks_for_milestone,
    build_milestone_snapshot_tree,
    filter_snapshot_tree,
    is_task_ready_for_archive,
)
from rootspread_api.services.task_service import normalize_status_filters

router = APIRouter(prefix="/workspaces/{workspace_id}/milestones", tags=["milestones"])


def get_workspace_membership(
    session: Session, workspace_id: str, user_id: str
) -> WorkspaceMember | None:
    return session.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.status == "active",
        )
    )


def require_workspace_membership(
    session: Session, workspace_id: str, user_id: str
) -> WorkspaceMember:
    membership = get_workspace_membership(session, workspace_id, user_id)
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工作空间不存在。")

    return membership


def require_admin_like_role(membership: WorkspaceMember) -> None:
    if membership.role not in {"owner", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="当前角色没有该操作权限。"
        )


@router.post("", response_model=MilestoneRead, status_code=status.HTTP_201_CREATED)
def create_milestone(
    workspace_id: str,
    payload: MilestoneCreateRequest,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> MilestoneRead:
    membership = require_workspace_membership(session, workspace_id, current_user.id)
    require_admin_like_role(membership)

    live_tasks = list(
        session.scalars(
            select(TaskNode)
            .where(TaskNode.workspace_id == workspace_id, TaskNode.archived_at.is_(None))
            .order_by(TaskNode.depth.asc(), TaskNode.sort_order.asc(), TaskNode.created_at.asc())
        ).all()
    )

    archivable_tasks = [
        task for task in live_tasks if is_task_ready_for_archive(task, payload.target_at)
    ]

    milestone = Milestone(
        workspace_id=workspace_id,
        name=payload.name,
        description=payload.description,
        target_at=payload.target_at,
        archived_task_count=len(archivable_tasks),
        created_by_user_id=current_user.id,
    )
    session.add(milestone)
    session.flush()

    archive_tasks_for_milestone(session, archivable_tasks, milestone.id)
    archived_ids = {task.id for task in archivable_tasks}
    snapshot_tree = build_milestone_snapshot_tree(live_tasks, archived_ids)
    session.add(
        MilestoneSnapshot(
            milestone_id=milestone.id,
            snapshot_name=f"{payload.name} snapshot",
            snapshot_data=[node.model_dump(mode="json") for node in snapshot_tree],
            archived_task_count=len(archivable_tasks),
            created_by_user_id=current_user.id,
        )
    )
    log_audit_event(
        session,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        entity_type="milestone",
        entity_id=milestone.id,
        action="milestone_created",
        message=f"创建里程碑：{payload.name}",
        metadata_json={"archived_task_count": len(archivable_tasks)},
    )

    session.commit()
    session.refresh(milestone)
    return MilestoneRead.model_validate(milestone)


@router.get("", response_model=list[MilestoneRead])
def list_milestones(
    workspace_id: str,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> list[MilestoneRead]:
    require_workspace_membership(session, workspace_id, current_user.id)

    milestones = session.scalars(
        select(Milestone)
        .where(Milestone.workspace_id == workspace_id)
        .order_by(Milestone.target_at.desc(), Milestone.created_at.desc())
    ).all()
    return [MilestoneRead.model_validate(milestone) for milestone in milestones]


@router.get("/{milestone_id}/tree", response_model=MilestoneTreeResponse)
def get_milestone_tree(
    workspace_id: str,
    milestone_id: str,
    status_filters: list[TaskStatus] | None = Query(default=None, alias="status"),
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> MilestoneTreeResponse:
    require_workspace_membership(session, workspace_id, current_user.id)

    milestone = session.scalar(
        select(Milestone).where(
            Milestone.id == milestone_id, Milestone.workspace_id == workspace_id
        )
    )
    if milestone is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="里程碑不存在。")

    snapshot = session.scalar(
        select(MilestoneSnapshot)
        .where(MilestoneSnapshot.milestone_id == milestone.id)
        .order_by(MilestoneSnapshot.created_at.desc())
    )
    if snapshot is None:
        return MilestoneTreeResponse.model_validate(
            {"milestone": MilestoneRead.model_validate(milestone).model_dump(), "tree": []}
        )

    tree = filter_snapshot_tree(snapshot.snapshot_data, normalize_status_filters(status_filters))
    return MilestoneTreeResponse.model_validate(
        {
            "milestone": MilestoneRead.model_validate(milestone).model_dump(),
            "tree": tree,
        }
    )
