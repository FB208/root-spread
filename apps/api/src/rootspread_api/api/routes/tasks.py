from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from rootspread_api.api.dependencies.auth import get_current_verified_user
from rootspread_api.core.database import get_db
from rootspread_api.models.task import TaskNode, TaskStatus, TaskStatusTransition
from rootspread_api.models.user import User
from rootspread_api.models.workspace import WorkspaceMember
from rootspread_api.schemas.common import MessageResponse
from rootspread_api.schemas.task import (
    TaskBulkDeleteRequest,
    TaskBulkStatusUpdateRequest,
    TaskCreateRequest,
    TaskNodeRead,
    TaskReorderRequest,
    TaskStatusTransitionRead,
    TaskStatusUpdateRequest,
    TaskTreeNodeRead,
    TaskUpdateRequest,
)
from rootspread_api.services.audit_service import log_audit_event
from rootspread_api.services.task_service import (
    build_task_tree,
    change_task_status,
    flatten_tasks_for_response,
    get_next_sort_order,
    normalize_status_filters,
    recompute_task_status_from_children,
    recompute_ancestor_statuses,
    task_has_children,
    update_task_path,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/tasks", tags=["tasks"])


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


def ensure_workspace_member_exists(
    session: Session, workspace_id: str, user_id: str | None
) -> None:
    if user_id is None:
        return

    if get_workspace_membership(session, workspace_id, user_id) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="负责人必须是工作空间成员。"
        )


def require_admin_like_role(membership: WorkspaceMember) -> None:
    if membership.role not in {"owner", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="当前角色没有该操作权限。"
        )


def require_task_write_access(membership: WorkspaceMember, task: TaskNode, user_id: str) -> None:
    if membership.role in {"owner", "admin"}:
        return

    if task.created_by_user_id != user_id and task.assignee_user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="当前角色没有修改该任务的权限。",
        )


def get_task_or_404(session: Session, workspace_id: str, task_id: str) -> TaskNode:
    task = session.scalar(
        select(TaskNode).where(
            TaskNode.workspace_id == workspace_id,
            TaskNode.id == task_id,
            TaskNode.archived_at.is_(None),
        )
    )
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在。")
    return task


@router.post("", response_model=TaskNodeRead, status_code=status.HTTP_201_CREATED)
def create_task(
    workspace_id: str,
    payload: TaskCreateRequest,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> TaskNodeRead:
    require_workspace_membership(session, workspace_id, current_user.id)
    ensure_workspace_member_exists(session, workspace_id, payload.assignee_user_id)

    parent: TaskNode | None = None
    if payload.parent_id is not None:
        parent = get_task_or_404(session, workspace_id, payload.parent_id)

    task = TaskNode(
        workspace_id=workspace_id,
        parent_id=payload.parent_id,
        root_id="",
        path="",
        depth=0,
        sort_order=get_next_sort_order(session, workspace_id, payload.parent_id),
        title=payload.title,
        content_markdown=payload.content_markdown,
        status=TaskStatus.IN_PROGRESS.value,
        created_by_user_id=current_user.id,
        assignee_user_id=payload.assignee_user_id,
        planned_due_at=payload.planned_due_at,
        weight=payload.weight,
    )
    session.add(task)
    session.flush()

    if parent is not None:
        task.parent = parent

    update_task_path(task, parent)
    if parent is not None:
        session.flush()
        recompute_ancestor_statuses(session, task, current_user.id)

    session.commit()
    session.refresh(task)
    log_audit_event(
        session,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        entity_type="task",
        entity_id=task.id,
        action="task_created",
        message=f"创建任务：{task.title}",
        metadata_json={"parent_id": payload.parent_id},
    )
    session.commit()
    return TaskNodeRead.model_validate(task)


@router.get("", response_model=list[TaskNodeRead])
def list_tasks(
    workspace_id: str,
    status_filters: list[TaskStatus] | None = Query(default=None, alias="status"),
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> list[TaskNodeRead]:
    require_workspace_membership(session, workspace_id, current_user.id)

    statement = select(TaskNode).where(TaskNode.workspace_id == workspace_id)
    statement = statement.where(TaskNode.archived_at.is_(None))
    if status_filters:
        statement = statement.where(TaskNode.status.in_([item.value for item in status_filters]))

    tasks = session.scalars(
        statement.order_by(TaskNode.depth.asc(), TaskNode.sort_order.asc())
    ).all()
    return flatten_tasks_for_response(tasks)


@router.get("/tree", response_model=list[TaskTreeNodeRead])
def get_task_tree(
    workspace_id: str,
    status_filters: list[TaskStatus] | None = Query(default=None, alias="status"),
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> list[TaskTreeNodeRead]:
    require_workspace_membership(session, workspace_id, current_user.id)

    tasks = session.scalars(
        select(TaskNode)
        .where(TaskNode.workspace_id == workspace_id, TaskNode.archived_at.is_(None))
        .order_by(TaskNode.depth.asc(), TaskNode.sort_order.asc(), TaskNode.created_at.asc())
    ).all()

    return build_task_tree(tasks, normalize_status_filters(status_filters))


@router.patch("/{task_id}", response_model=TaskNodeRead)
def update_task(
    workspace_id: str,
    task_id: str,
    payload: TaskUpdateRequest,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> TaskNodeRead:
    membership = require_workspace_membership(session, workspace_id, current_user.id)
    task = get_task_or_404(session, workspace_id, task_id)
    require_task_write_access(membership, task, current_user.id)

    update_data = payload.model_dump(exclude_unset=True)
    if "assignee_user_id" in update_data:
        ensure_workspace_member_exists(session, workspace_id, update_data["assignee_user_id"])

    if "score" in update_data:
        require_admin_like_role(membership)

    for field_name, value in update_data.items():
        setattr(task, field_name, value)

    log_audit_event(
        session,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        entity_type="task",
        entity_id=task.id,
        action="task_updated",
        message=f"更新任务：{task.title}",
        metadata_json={"fields": sorted(update_data.keys())},
    )
    session.commit()
    session.refresh(task)
    return TaskNodeRead.model_validate(task)


@router.post("/{task_id}/status", response_model=TaskNodeRead)
def update_task_status(
    workspace_id: str,
    task_id: str,
    payload: TaskStatusUpdateRequest,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> TaskNodeRead:
    membership = require_workspace_membership(session, workspace_id, current_user.id)
    task = get_task_or_404(session, workspace_id, task_id)
    require_task_write_access(membership, task, current_user.id)

    if payload.status == TaskStatus.COMPLETED and task_has_children(session, task.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="存在下级任务的节点不能手动标记为已完成。",
        )

    if task.status == TaskStatus.PENDING_REVIEW.value and payload.status not in {
        TaskStatus.COMPLETED,
        TaskStatus.IN_PROGRESS,
    }:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="待验证任务只能改为已完成或进行中。",
        )

    if task.status == TaskStatus.PENDING_REVIEW.value and payload.status in {
        TaskStatus.COMPLETED,
        TaskStatus.IN_PROGRESS,
    }:
        require_admin_like_role(membership)

    change_task_status(
        session,
        task,
        payload.status,
        operator_user_id=current_user.id,
        action_type="manual_status_update",
        remark=payload.remark,
    )
    session.flush()
    recompute_ancestor_statuses(session, task, current_user.id)

    log_audit_event(
        session,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        entity_type="task",
        entity_id=task.id,
        action="task_status_updated",
        message=f"更新任务状态：{task.title} -> {payload.status.value}",
        metadata_json={"status": payload.status.value, "remark": payload.remark},
    )

    session.commit()
    session.refresh(task)
    return TaskNodeRead.model_validate(task)


@router.delete("/{task_id}", response_model=MessageResponse)
def delete_task(
    workspace_id: str,
    task_id: str,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> MessageResponse:
    membership = require_workspace_membership(session, workspace_id, current_user.id)
    task = get_task_or_404(session, workspace_id, task_id)
    require_task_write_access(membership, task, current_user.id)

    parent = task.parent
    session.delete(task)
    session.flush()

    if parent is not None:
        recompute_task_status_from_children(session, parent, current_user.id)
        recompute_ancestor_statuses(session, parent, current_user.id)

    log_audit_event(
        session,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        entity_type="task",
        entity_id=task_id,
        action="task_deleted",
        message=f"删除任务：{task.title}",
        metadata_json={"parent_id": parent.id if parent is not None else None},
    )
    session.commit()
    return MessageResponse(message="任务已删除。")


@router.post("/bulk-status", response_model=MessageResponse)
def bulk_update_task_status(
    workspace_id: str,
    payload: TaskBulkStatusUpdateRequest,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> MessageResponse:
    membership = require_workspace_membership(session, workspace_id, current_user.id)
    tasks = session.scalars(
        select(TaskNode).where(
            TaskNode.workspace_id == workspace_id,
            TaskNode.id.in_(payload.task_ids),
            TaskNode.archived_at.is_(None),
        )
    ).all()

    if len(tasks) != len(payload.task_ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="批量任务列表不完整。")

    for task in tasks:
        require_task_write_access(membership, task, current_user.id)

        if payload.status == TaskStatus.COMPLETED and task_has_children(session, task.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"任务 {task.title} 存在子任务，不能手动标记为已完成。",
            )

        if task.status == TaskStatus.PENDING_REVIEW.value and payload.status in {
            TaskStatus.COMPLETED,
            TaskStatus.IN_PROGRESS,
        }:
            require_admin_like_role(membership)

    for task in tasks:
        change_task_status(
            session,
            task,
            payload.status,
            operator_user_id=current_user.id,
            action_type="bulk_status_update",
            remark=payload.remark,
        )
        session.flush()
        recompute_ancestor_statuses(session, task, current_user.id)

    log_audit_event(
        session,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        entity_type="task",
        entity_id=None,
        action="task_bulk_status_updated",
        message=f"批量更新 {len(tasks)} 个任务状态为 {payload.status.value}",
        metadata_json={"task_ids": payload.task_ids, "status": payload.status.value},
    )
    session.commit()
    return MessageResponse(message="批量状态更新完成。")


@router.post("/bulk-delete", response_model=MessageResponse)
def bulk_delete_tasks(
    workspace_id: str,
    payload: TaskBulkDeleteRequest,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> MessageResponse:
    membership = require_workspace_membership(session, workspace_id, current_user.id)
    tasks = session.scalars(
        select(TaskNode).where(
            TaskNode.workspace_id == workspace_id,
            TaskNode.id.in_(payload.task_ids),
            TaskNode.archived_at.is_(None),
        )
    ).all()

    if len(tasks) != len(payload.task_ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="批量任务列表不完整。")

    parents: list[TaskNode] = []
    titles = [task.title for task in tasks]
    for task in tasks:
        require_task_write_access(membership, task, current_user.id)
        if task.parent is not None:
            parents.append(task.parent)
        session.delete(task)

    session.flush()
    for parent in parents:
        recompute_task_status_from_children(session, parent, current_user.id)
        recompute_ancestor_statuses(session, parent, current_user.id)

    log_audit_event(
        session,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        entity_type="task",
        entity_id=None,
        action="task_bulk_deleted",
        message=f"批量删除 {len(tasks)} 个任务",
        metadata_json={"task_ids": payload.task_ids, "titles": titles},
    )
    session.commit()
    return MessageResponse(message="批量删除完成。")


@router.get("/{task_id}/transitions", response_model=list[TaskStatusTransitionRead])
def list_task_transitions(
    workspace_id: str,
    task_id: str,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> list[TaskStatusTransitionRead]:
    require_workspace_membership(session, workspace_id, current_user.id)
    get_task_or_404(session, workspace_id, task_id)

    transitions = session.scalars(
        select(TaskStatusTransition)
        .where(TaskStatusTransition.task_node_id == task_id)
        .order_by(TaskStatusTransition.created_at.desc())
    ).all()
    return [TaskStatusTransitionRead.model_validate(transition) for transition in transitions]


@router.post("/reorder", response_model=MessageResponse)
def reorder_tasks(
    workspace_id: str,
    payload: TaskReorderRequest,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> MessageResponse:
    require_workspace_membership(session, workspace_id, current_user.id)

    tasks = session.scalars(
        select(TaskNode).where(
            TaskNode.workspace_id == workspace_id, TaskNode.id.in_(payload.task_ids)
        )
    ).all()

    if len(tasks) != len(payload.task_ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="排序任务列表不完整。")

    if any(task.parent_id != payload.parent_id for task in tasks):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="只能调整同一父节点下的任务顺序。",
        )

    task_map = {task.id: task for task in tasks}
    for index, task_id in enumerate(payload.task_ids):
        task_map[task_id].sort_order = index

    log_audit_event(
        session,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        entity_type="task",
        entity_id=None,
        action="task_reordered",
        message="更新同级任务排序",
        metadata_json={"parent_id": payload.parent_id, "task_ids": payload.task_ids},
    )
    session.commit()
    return MessageResponse(message="排序已更新。")
