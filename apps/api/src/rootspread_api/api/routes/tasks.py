from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from rootspread_api.api.dependencies.auth import get_current_verified_user
from rootspread_api.core.database import get_db, get_session_factory
from rootspread_api.core.security import decode_access_token
from rootspread_api.core.task_stream import broadcast_task_changeset_from_thread, task_stream_hub
from rootspread_api.models.task import TaskNode, TaskNodeKind, TaskStatus, TaskStatusTransition
from rootspread_api.models.user import User
from rootspread_api.models.workspace import WorkspaceMember
from rootspread_api.schemas.common import MessageResponse
from rootspread_api.schemas.task import (
    TaskChangesResponse,
    TaskChangeset,
    TaskBulkDeleteRequest,
    TaskBulkStatusUpdateRequest,
    TaskCreateRequest,
    TaskDocumentRead,
    TaskIdMapping,
    TaskOperationRequest,
    TaskNodeRead,
    TaskReorderRequest,
    TaskSnapshotResponse,
    TaskStatusTransitionRead,
    TaskStatusUpdateRequest,
    TaskTreeResponse,
    TaskUpdateRequest,
)
from rootspread_api.services.audit_service import log_audit_event
from rootspread_api.services.task_service import (
    build_task_tree,
    change_task_status,
    ensure_system_root,
    flatten_tasks_for_response,
    get_next_sort_order,
    is_system_root_task,
    normalize_status_filters,
    recompute_task_status_from_children,
    recompute_ancestor_statuses,
    task_has_children,
    update_task_path,
)
from rootspread_api.services.task_sync import (
    build_task_snapshot,
    bump_task_meta_revisions,
    collect_self_and_ancestors,
    collect_self_and_ancestor_ids,
    collect_subtree_ids,
    find_task_changeset_by_op_id,
    get_latest_task_sync_seq,
    list_task_changes_since,
    persist_task_changeset,
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


def ensure_mutable_task(task: TaskNode) -> None:
    if is_system_root_task(task):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="系统根节点不能执行该操作。"
        )


def ensure_task_meta_revision(task: TaskNode, expected_revision: int | None) -> None:
    if expected_revision is None:
        return

    if int(task.meta_revision or 0) != expected_revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(f"任务《{task.title}》已被其他协作者更新，请同步最新结果后再重试。"),
        )


def commit_and_broadcast_changes(
    session: Session,
    workspace_id: str,
    actor_user_id: str | None,
    op_type: str,
    upsert_ids: list[str],
    delete_ids: list[str],
    *,
    id_mappings: list[TaskIdMapping] | None = None,
    op_id: str | None = None,
) -> TaskChangeset:
    changeset = persist_task_changeset(
        session,
        workspace_id,
        actor_user_id,
        op_type,
        upsert_ids,
        delete_ids,
        id_mappings=id_mappings,
        op_id=op_id,
    )
    session.commit()

    if changeset.upserts or changeset.deletes:
        broadcast_task_changeset_from_thread(workspace_id, changeset.model_dump(mode="json"))

    return changeset


def execute_task_operation(
    session: Session,
    workspace_id: str,
    membership: WorkspaceMember,
    current_user: User,
    payload: TaskOperationRequest,
) -> TaskChangeset:
    if payload.type == "create_task":
        ensure_workspace_member_exists(session, workspace_id, payload.assignee_user_id)
        system_root = ensure_system_root(session, workspace_id, current_user.id)
        parent = (
            system_root
            if payload.parent_id is None
            else get_task_or_404(session, workspace_id, payload.parent_id)
        )

        task = TaskNode(
            workspace_id=workspace_id,
            parent_id=parent.id,
            root_id="",
            path="",
            depth=0,
            sort_order=get_next_sort_order(session, workspace_id, parent.id),
            title=payload.title or "新节点",
            content_markdown=payload.content_markdown or "",
            node_kind=TaskNodeKind.TASK.value,
            status=TaskStatus.IN_PROGRESS.value,
            created_by_user_id=current_user.id,
            assignee_user_id=payload.assignee_user_id,
            planned_due_at=payload.planned_due_at,
            weight=payload.weight or 0,
        )
        session.add(task)
        session.flush()

        task.parent = parent
        update_task_path(task, parent)
        session.flush()
        recompute_ancestor_statuses(session, task, current_user.id)
        bump_task_meta_revisions(collect_self_and_ancestors(task))
        log_audit_event(
            session,
            workspace_id=workspace_id,
            actor_user_id=current_user.id,
            entity_type="task",
            entity_id=task.id,
            action="task_created",
            message=f"创建任务：{task.title}",
            metadata_json={"parent_id": parent.id, "source": "ops"},
        )
        return commit_and_broadcast_changes(
            session,
            workspace_id,
            current_user.id,
            payload.type,
            collect_self_and_ancestor_ids(task),
            [],
            id_mappings=[TaskIdMapping(client_id=payload.client_id, task_id=task.id)]
            if payload.client_id
            else None,
            op_id=payload.op_id,
        )

    if payload.type == "patch_task":
        if payload.task_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="缺少 task_id。")

        task = get_task_or_404(session, workspace_id, payload.task_id)
        require_task_write_access(membership, task, current_user.id)
        ensure_task_meta_revision(task, payload.base_meta_revision)

        update_data = payload.model_dump(
            exclude_unset=True,
            exclude={
                "base_meta_revision",
                "base_sync_seq",
                "client_id",
                "op_id",
                "type",
                "task_id",
                "parent_id",
                "task_ids",
                "status",
                "remark",
            },
        )
        if is_system_root_task(task):
            disallowed_fields = set(update_data) - {"title", "content_markdown"}
            if disallowed_fields:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="系统根节点只允许更新标题和描述。",
                )

        if "assignee_user_id" in update_data:
            ensure_workspace_member_exists(session, workspace_id, update_data["assignee_user_id"])

        if "score" in update_data:
            require_admin_like_role(membership)

        for field_name, value in update_data.items():
            setattr(task, field_name, value)

        bump_task_meta_revisions([task])
        log_audit_event(
            session,
            workspace_id=workspace_id,
            actor_user_id=current_user.id,
            entity_type="task",
            entity_id=task.id,
            action="task_updated",
            message=f"更新任务：{task.title}",
            metadata_json={"fields": sorted(update_data.keys()), "source": "ops"},
        )
        return commit_and_broadcast_changes(
            session,
            workspace_id,
            current_user.id,
            payload.type,
            [task.id],
            [],
            op_id=payload.op_id,
        )

    if payload.type == "set_status":
        if payload.task_id is None or payload.status is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="缺少状态更新参数。"
            )

        task = get_task_or_404(session, workspace_id, payload.task_id)
        require_task_write_access(membership, task, current_user.id)
        ensure_mutable_task(task)
        ensure_task_meta_revision(task, payload.base_meta_revision)

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
        bump_task_meta_revisions(collect_self_and_ancestors(task))
        log_audit_event(
            session,
            workspace_id=workspace_id,
            actor_user_id=current_user.id,
            entity_type="task",
            entity_id=task.id,
            action="task_status_updated",
            message=f"更新任务状态：{task.title} -> {payload.status.value}",
            metadata_json={
                "status": payload.status.value,
                "remark": payload.remark,
                "source": "ops",
            },
        )
        return commit_and_broadcast_changes(
            session,
            workspace_id,
            current_user.id,
            payload.type,
            collect_self_and_ancestor_ids(task),
            [],
            op_id=payload.op_id,
        )

    if payload.type == "delete_task":
        if payload.task_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="缺少 task_id。")

        task = get_task_or_404(session, workspace_id, payload.task_id)
        require_task_write_access(membership, task, current_user.id)
        ensure_mutable_task(task)
        ensure_task_meta_revision(task, payload.base_meta_revision)

        delete_ids = collect_subtree_ids(session, workspace_id, task)
        parent = task.parent
        session.delete(task)
        session.flush()

        if parent is not None:
            recompute_task_status_from_children(session, parent, current_user.id)
            recompute_ancestor_statuses(session, parent, current_user.id)

        bump_task_meta_revisions(collect_self_and_ancestors(parent))
        log_audit_event(
            session,
            workspace_id=workspace_id,
            actor_user_id=current_user.id,
            entity_type="task",
            entity_id=payload.task_id,
            action="task_deleted",
            message=f"删除任务：{task.title}",
            metadata_json={"parent_id": parent.id if parent is not None else None, "source": "ops"},
        )
        return commit_and_broadcast_changes(
            session,
            workspace_id,
            current_user.id,
            payload.type,
            collect_self_and_ancestor_ids(parent),
            delete_ids,
            op_id=payload.op_id,
        )

    if payload.type == "reorder_tasks":
        if payload.parent_id is None or not payload.task_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="缺少排序参数。")

        parent_task = get_task_or_404(session, workspace_id, payload.parent_id)
        ensure_task_meta_revision(parent_task, payload.base_meta_revision)

        tasks = session.scalars(
            select(TaskNode).where(
                TaskNode.workspace_id == workspace_id, TaskNode.id.in_(payload.task_ids)
            )
        ).all()
        if len(tasks) != len(payload.task_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="排序任务列表不完整。"
            )
        if any(task.node_kind == TaskNodeKind.SYSTEM_ROOT.value for task in tasks):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="系统根节点不能参与排序。"
            )
        if any(task.parent_id != payload.parent_id for task in tasks):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="只能调整同一父节点下的任务顺序。",
            )

        task_map = {task.id: task for task in tasks}
        for index, task_id in enumerate(payload.task_ids):
            task_map[task_id].sort_order = index

        bump_task_meta_revisions(tasks)
        log_audit_event(
            session,
            workspace_id=workspace_id,
            actor_user_id=current_user.id,
            entity_type="task",
            entity_id=None,
            action="task_reordered",
            message="更新同级任务排序",
            metadata_json={
                "parent_id": payload.parent_id,
                "task_ids": payload.task_ids,
                "source": "ops",
            },
        )
        return commit_and_broadcast_changes(
            session,
            workspace_id,
            current_user.id,
            payload.type,
            list(payload.task_ids),
            [],
            op_id=payload.op_id,
        )

    if payload.type == "bulk_set_status":
        if not payload.task_ids or payload.status is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="缺少批量状态参数。"
            )

        tasks = session.scalars(
            select(TaskNode).where(
                TaskNode.workspace_id == workspace_id,
                TaskNode.id.in_(payload.task_ids),
                TaskNode.archived_at.is_(None),
            )
        ).all()
        if len(tasks) != len(payload.task_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="批量任务列表不完整。"
            )

        for task in tasks:
            require_task_write_access(membership, task, current_user.id)
            ensure_mutable_task(task)
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

        upsert_ids: list[str] = []
        affected_tasks: list[TaskNode | None] = []
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
            upsert_ids.extend(collect_self_and_ancestor_ids(task))
            affected_tasks.extend(collect_self_and_ancestors(task))

        bump_task_meta_revisions(affected_tasks)
        log_audit_event(
            session,
            workspace_id=workspace_id,
            actor_user_id=current_user.id,
            entity_type="task",
            entity_id=None,
            action="task_bulk_status_updated",
            message=f"批量更新 {len(tasks)} 个任务状态为 {payload.status.value}",
            metadata_json={
                "task_ids": payload.task_ids,
                "status": payload.status.value,
                "source": "ops",
            },
        )
        return commit_and_broadcast_changes(
            session,
            workspace_id,
            current_user.id,
            payload.type,
            upsert_ids,
            [],
            op_id=payload.op_id,
        )

    if payload.type == "bulk_delete_tasks":
        if not payload.task_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="缺少批量删除参数。"
            )

        tasks = session.scalars(
            select(TaskNode).where(
                TaskNode.workspace_id == workspace_id,
                TaskNode.id.in_(payload.task_ids),
                TaskNode.archived_at.is_(None),
            )
        ).all()
        if len(tasks) != len(payload.task_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="批量任务列表不完整。"
            )

        selected_ids = set(payload.task_ids)
        tasks_to_delete = [
            task
            for task in tasks
            if not any(ancestor_id in selected_ids for ancestor_id in task.path.split("/")[:-1])
        ]
        parents: list[TaskNode] = []
        delete_ids: list[str] = []
        titles = [task.title for task in tasks_to_delete]

        for task in tasks_to_delete:
            require_task_write_access(membership, task, current_user.id)
            ensure_mutable_task(task)
            delete_ids.extend(collect_subtree_ids(session, workspace_id, task))
            if task.parent is not None:
                parents.append(task.parent)
            session.delete(task)

        session.flush()
        for parent in parents:
            recompute_task_status_from_children(session, parent, current_user.id)
            recompute_ancestor_statuses(session, parent, current_user.id)

        affected_tasks: list[TaskNode | None] = []
        upsert_ids: list[str] = []
        for parent in parents:
            affected_tasks.extend(collect_self_and_ancestors(parent))
            upsert_ids.extend(collect_self_and_ancestor_ids(parent))

        bump_task_meta_revisions(affected_tasks)
        log_audit_event(
            session,
            workspace_id=workspace_id,
            actor_user_id=current_user.id,
            entity_type="task",
            entity_id=None,
            action="task_bulk_deleted",
            message=f"批量删除 {len(tasks_to_delete)} 个任务",
            metadata_json={"task_ids": payload.task_ids, "titles": titles, "source": "ops"},
        )
        return commit_and_broadcast_changes(
            session,
            workspace_id,
            current_user.id,
            payload.type,
            upsert_ids,
            delete_ids,
            op_id=payload.op_id,
        )

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的任务操作。")


@router.post("", response_model=TaskNodeRead, status_code=status.HTTP_201_CREATED)
def create_task(
    workspace_id: str,
    payload: TaskCreateRequest,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> TaskNodeRead:
    require_workspace_membership(session, workspace_id, current_user.id)
    ensure_workspace_member_exists(session, workspace_id, payload.assignee_user_id)

    system_root = ensure_system_root(session, workspace_id, current_user.id)
    parent = (
        system_root
        if payload.parent_id is None
        else get_task_or_404(session, workspace_id, payload.parent_id)
    )
    parent_id = parent.id

    task = TaskNode(
        workspace_id=workspace_id,
        parent_id=parent_id,
        root_id="",
        path="",
        depth=0,
        sort_order=get_next_sort_order(session, workspace_id, parent_id),
        title=payload.title,
        content_markdown=payload.content_markdown,
        node_kind=TaskNodeKind.TASK.value,
        status=TaskStatus.IN_PROGRESS.value,
        created_by_user_id=current_user.id,
        assignee_user_id=payload.assignee_user_id,
        planned_due_at=payload.planned_due_at,
        weight=payload.weight,
    )
    session.add(task)
    session.flush()

    task.parent = parent
    update_task_path(task, parent)
    session.flush()
    recompute_ancestor_statuses(session, task, current_user.id)
    bump_task_meta_revisions(collect_self_and_ancestors(task))

    log_audit_event(
        session,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        entity_type="task",
        entity_id=task.id,
        action="task_created",
        message=f"创建任务：{task.title}",
        metadata_json={"parent_id": parent_id},
    )
    commit_and_broadcast_changes(
        session,
        workspace_id,
        current_user.id,
        "create_task",
        collect_self_and_ancestor_ids(task),
        [],
    )
    session.refresh(task)
    return TaskNodeRead.model_validate(task)


@router.get("", response_model=list[TaskNodeRead])
def list_tasks(
    workspace_id: str,
    status_filters: list[TaskStatus] | None = Query(default=None, alias="status"),
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> list[TaskNodeRead]:
    require_workspace_membership(session, workspace_id, current_user.id)

    statement = select(TaskNode).where(
        TaskNode.workspace_id == workspace_id,
        TaskNode.archived_at.is_(None),
        TaskNode.node_kind != TaskNodeKind.SYSTEM_ROOT.value,
    )
    if status_filters:
        statement = statement.where(TaskNode.status.in_([item.value for item in status_filters]))

    tasks = session.scalars(
        statement.order_by(TaskNode.depth.asc(), TaskNode.sort_order.asc())
    ).all()
    return flatten_tasks_for_response(tasks)


@router.get("/tree", response_model=TaskTreeResponse)
def get_task_tree(
    workspace_id: str,
    status_filters: list[TaskStatus] | None = Query(default=None, alias="status"),
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> TaskTreeResponse:
    require_workspace_membership(session, workspace_id, current_user.id)

    tasks = session.scalars(
        select(TaskNode)
        .where(TaskNode.workspace_id == workspace_id, TaskNode.archived_at.is_(None))
        .order_by(TaskNode.depth.asc(), TaskNode.sort_order.asc(), TaskNode.created_at.asc())
    ).all()

    root = build_task_tree(tasks, normalize_status_filters(status_filters))
    if root is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="工作空间缺少系统根节点。"
        )

    return TaskTreeResponse(root=root)


@router.get("/snapshot", response_model=TaskSnapshotResponse)
def get_task_snapshot(
    workspace_id: str,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> TaskSnapshotResponse:
    require_workspace_membership(session, workspace_id, current_user.id)
    return build_task_snapshot(session, workspace_id)


@router.get("/changes", response_model=TaskChangesResponse)
def get_task_changes(
    workspace_id: str,
    since: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> TaskChangesResponse:
    require_workspace_membership(session, workspace_id, current_user.id)
    return list_task_changes_since(session, workspace_id, since)


@router.get("/{task_id}/document", response_model=TaskDocumentRead)
def get_task_document(
    workspace_id: str,
    task_id: str,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> TaskDocumentRead:
    require_workspace_membership(session, workspace_id, current_user.id)
    task = get_task_or_404(session, workspace_id, task_id)
    return TaskDocumentRead(
        task_id=task.id,
        workspace_id=workspace_id,
        content_markdown=task.content_markdown,
        updated_at=task.updated_at,
    )


@router.post("/ops", response_model=TaskChangeset)
def operate_task(
    workspace_id: str,
    payload: TaskOperationRequest,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> TaskChangeset:
    membership = require_workspace_membership(session, workspace_id, current_user.id)
    handled_changeset = find_task_changeset_by_op_id(
        session, workspace_id, current_user.id, payload.op_id
    )
    if handled_changeset is not None:
        return handled_changeset
    return execute_task_operation(session, workspace_id, membership, current_user, payload)


@router.websocket("/stream")
async def task_stream(
    websocket: WebSocket,
    workspace_id: str,
) -> None:
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401)
        return

    try:
        payload = decode_access_token(token)
    except ValueError:
        await websocket.close(code=4401)
        return

    session_factory = get_session_factory()
    session = session_factory()
    try:
        if get_workspace_membership(session, workspace_id, payload["sub"]) is None:
            await websocket.close(code=4403)
            return

        since = int(websocket.query_params.get("since", "0") or 0)
        await websocket.accept()
        await task_stream_hub.connect(workspace_id, websocket)

        pending_changes = list_task_changes_since(session, workspace_id, since)
        if not pending_changes.reset_required:
            for event in pending_changes.events:
                await websocket.send_json(event.model_dump(mode="json"))

        await websocket.send_json(
            {
                "reset_required": pending_changes.reset_required,
                "type": "ready",
                "workspace_id": workspace_id,
                "sync_seq": get_latest_task_sync_seq(session, workspace_id),
            }
        )

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        session.close()
        await task_stream_hub.disconnect(workspace_id, websocket)


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
    if is_system_root_task(task):
        disallowed_fields = set(update_data) - {"title", "content_markdown"}
        if disallowed_fields:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="系统根节点只允许更新标题和描述。",
            )

    if "assignee_user_id" in update_data:
        ensure_workspace_member_exists(session, workspace_id, update_data["assignee_user_id"])

    if "score" in update_data:
        require_admin_like_role(membership)

    for field_name, value in update_data.items():
        setattr(task, field_name, value)

    bump_task_meta_revisions([task])
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
    commit_and_broadcast_changes(
        session,
        workspace_id,
        current_user.id,
        "patch_task",
        [task.id],
        [],
    )
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
    ensure_mutable_task(task)

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
    bump_task_meta_revisions(collect_self_and_ancestors(task))

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

    commit_and_broadcast_changes(
        session,
        workspace_id,
        current_user.id,
        "set_status",
        collect_self_and_ancestor_ids(task),
        [],
    )
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
    ensure_mutable_task(task)

    delete_ids = collect_subtree_ids(session, workspace_id, task)
    parent = task.parent
    session.delete(task)
    session.flush()

    if parent is not None:
        recompute_task_status_from_children(session, parent, current_user.id)
        recompute_ancestor_statuses(session, parent, current_user.id)

    bump_task_meta_revisions(collect_self_and_ancestors(parent))

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
    commit_and_broadcast_changes(
        session,
        workspace_id,
        current_user.id,
        "delete_task",
        collect_self_and_ancestor_ids(parent),
        delete_ids,
    )
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
        ensure_mutable_task(task)

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

    upsert_ids: list[str] = []
    affected_tasks: list[TaskNode | None] = []
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
        upsert_ids.extend(collect_self_and_ancestor_ids(task))
        affected_tasks.extend(collect_self_and_ancestors(task))

    bump_task_meta_revisions(affected_tasks)

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
    commit_and_broadcast_changes(
        session,
        workspace_id,
        current_user.id,
        "bulk_set_status",
        upsert_ids,
        [],
    )
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

    selected_ids = set(payload.task_ids)
    tasks_to_delete = [
        task
        for task in tasks
        if not any(ancestor_id in selected_ids for ancestor_id in task.path.split("/")[:-1])
    ]

    parents: list[TaskNode] = []
    delete_ids: list[str] = []
    titles = [task.title for task in tasks_to_delete]
    for task in tasks_to_delete:
        require_task_write_access(membership, task, current_user.id)
        ensure_mutable_task(task)
        delete_ids.extend(collect_subtree_ids(session, workspace_id, task))
        if task.parent is not None:
            parents.append(task.parent)
        session.delete(task)

    session.flush()
    for parent in parents:
        recompute_task_status_from_children(session, parent, current_user.id)
        recompute_ancestor_statuses(session, parent, current_user.id)

    affected_tasks: list[TaskNode | None] = []
    upsert_ids: list[str] = []
    for parent in parents:
        affected_tasks.extend(collect_self_and_ancestors(parent))
        upsert_ids.extend(collect_self_and_ancestor_ids(parent))

    bump_task_meta_revisions(affected_tasks)

    log_audit_event(
        session,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        entity_type="task",
        entity_id=None,
        action="task_bulk_deleted",
        message=f"批量删除 {len(tasks_to_delete)} 个任务",
        metadata_json={"task_ids": payload.task_ids, "titles": titles},
    )
    commit_and_broadcast_changes(
        session,
        workspace_id,
        current_user.id,
        "bulk_delete_tasks",
        upsert_ids,
        delete_ids,
    )
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

    if any(task.node_kind == TaskNodeKind.SYSTEM_ROOT.value for task in tasks):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="系统根节点不能参与排序。"
        )

    if any(task.parent_id != payload.parent_id for task in tasks):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="只能调整同一父节点下的任务顺序。",
        )

    task_map = {task.id: task for task in tasks}
    for index, task_id in enumerate(payload.task_ids):
        task_map[task_id].sort_order = index

    bump_task_meta_revisions(tasks)

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
    commit_and_broadcast_changes(
        session,
        workspace_id,
        current_user.id,
        "reorder_tasks",
        list(payload.task_ids),
        [],
    )
    return MessageResponse(message="排序已更新。")
