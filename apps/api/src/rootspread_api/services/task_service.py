from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rootspread_api.core.time import utc_now
from rootspread_api.models.task import TaskNode, TaskNodeKind, TaskStatus, TaskStatusTransition
from rootspread_api.schemas.task import TaskNodeRead, TaskTreeNodeRead


def get_next_sort_order(session: Session, workspace_id: str, parent_id: str | None) -> int:
    statement = select(func.max(TaskNode.sort_order)).where(TaskNode.workspace_id == workspace_id)
    if parent_id is None:
        statement = statement.where(TaskNode.parent_id.is_(None))
    else:
        statement = statement.where(TaskNode.parent_id == parent_id)

    current_max = session.scalar(statement)
    return 0 if current_max is None else int(current_max) + 1


def append_transition(
    session: Session,
    task: TaskNode,
    operator_user_id: str,
    to_status: str,
    action_type: str,
    remark: str | None = None,
    from_status: str | None = None,
) -> None:
    session.add(
        TaskStatusTransition(
            task_node_id=task.id,
            from_status=task.status if from_status is None else from_status,
            to_status=to_status,
            action_type=action_type,
            remark=remark,
            operator_user_id=operator_user_id,
        )
    )


def is_system_root_task(task: TaskNode) -> bool:
    return task.node_kind == TaskNodeKind.SYSTEM_ROOT.value


def get_system_root(session: Session, workspace_id: str) -> TaskNode | None:
    return session.scalar(
        select(TaskNode).where(
            TaskNode.workspace_id == workspace_id,
            TaskNode.node_kind == TaskNodeKind.SYSTEM_ROOT.value,
            TaskNode.parent_id.is_(None),
            TaskNode.archived_at.is_(None),
        )
    )


def create_system_root(
    session: Session, workspace_id: str, user_id: str, title: str = "根节点"
) -> TaskNode:
    task = TaskNode(
        workspace_id=workspace_id,
        parent_id=None,
        root_id="",
        path="",
        depth=0,
        sort_order=0,
        title=title,
        content_markdown="",
        node_kind=TaskNodeKind.SYSTEM_ROOT.value,
        status=TaskStatus.IN_PROGRESS.value,
        created_by_user_id=user_id,
        assignee_user_id=None,
        planned_due_at=None,
        weight=0,
    )
    session.add(task)
    session.flush()
    update_task_path(task, None)
    return task


def ensure_system_root(
    session: Session, workspace_id: str, user_id: str, title: str = "根节点"
) -> TaskNode:
    root = get_system_root(session, workspace_id)
    if root is not None:
        return root

    return create_system_root(session, workspace_id, user_id, title)


def change_task_status(
    session: Session,
    task: TaskNode,
    new_status: TaskStatus,
    operator_user_id: str,
    action_type: str,
    remark: str | None = None,
) -> None:
    previous_status = task.status
    if previous_status == new_status.value:
        return

    task.status = new_status.value
    task.completed_at = utc_now() if new_status == TaskStatus.COMPLETED else None
    append_transition(
        session,
        task,
        operator_user_id=operator_user_id,
        to_status=new_status.value,
        action_type=action_type,
        remark=remark,
        from_status=previous_status,
    )


def recompute_ancestor_statuses(session: Session, task: TaskNode, operator_user_id: str) -> None:
    current = task.parent

    while current is not None:
        recompute_task_status_from_children(session, current, operator_user_id)
        current = current.parent


def recompute_task_status_from_children(
    session: Session, task: TaskNode, operator_user_id: str
) -> None:
    if is_system_root_task(task):
        return

    child_statuses = session.scalars(
        select(TaskNode.status)
        .where(TaskNode.parent_id == task.id)
        .order_by(TaskNode.sort_order.asc())
    ).all()

    if child_statuses and all(status == TaskStatus.COMPLETED.value for status in child_statuses):
        if task.status != TaskStatus.COMPLETED.value:
            change_task_status(
                session,
                task,
                TaskStatus.COMPLETED,
                operator_user_id=operator_user_id,
                action_type="auto_complete_from_children",
            )
    elif task.status == TaskStatus.COMPLETED.value:
        change_task_status(
            session,
            task,
            TaskStatus.IN_PROGRESS,
            operator_user_id=operator_user_id,
            action_type="auto_reopen_from_children",
        )


def task_has_children(session: Session, task_id: str) -> bool:
    return (
        session.scalar(select(TaskNode.id).where(TaskNode.parent_id == task_id).limit(1))
        is not None
    )


def build_task_tree(
    tasks: Sequence[TaskNode], statuses: set[str] | None = None
) -> TaskTreeNodeRead | None:
    ordered_tasks = sorted(tasks, key=lambda item: (item.depth, item.sort_order, item.created_at))
    by_id = {task.id: task for task in ordered_tasks}
    system_root = next(
        (
            task
            for task in ordered_tasks
            if task.node_kind == TaskNodeKind.SYSTEM_ROOT.value and task.parent_id is None
        ),
        None,
    )

    if system_root is None:
        return None

    visible_ids = {system_root.id}
    if statuses:
        matched_ids = {
            task.id
            for task in ordered_tasks
            if task.node_kind != TaskNodeKind.SYSTEM_ROOT.value and task.status in statuses
        }
        for task_id in matched_ids:
            current = by_id.get(task_id)
            while current is not None:
                visible_ids.add(current.id)
                current = by_id.get(current.parent_id) if current.parent_id else None
    else:
        visible_ids = set(by_id)

    nodes_by_id: dict[str, TaskTreeNodeRead] = {}

    for task in ordered_tasks:
        if task.id not in visible_ids:
            continue

        is_root = task.id == system_root.id
        node_data = TaskNodeRead.model_validate(task).model_dump()
        matched_filter = (
            False if (is_root and statuses) else (not statuses or task.status in statuses)
        )
        node = TaskTreeNodeRead(**node_data, matched_filter=matched_filter, children=[])
        nodes_by_id[task.id] = node

    for task in ordered_tasks:
        node = nodes_by_id.get(task.id)
        if node is None:
            continue

        if task.parent_id is None:
            continue

        parent = nodes_by_id.get(task.parent_id)
        if parent is not None:
            parent.children.append(node)

    return nodes_by_id.get(system_root.id)


def normalize_status_filters(statuses: list[TaskStatus] | None) -> set[str] | None:
    if not statuses:
        return None

    return {status.value for status in statuses}


def update_task_path(task: TaskNode, parent: TaskNode | None) -> None:
    if parent is None:
        task.root_id = task.id
        task.path = task.id
        task.depth = 0
        return

    task.root_id = parent.root_id
    task.path = f"{parent.path}/{task.id}"
    task.depth = parent.depth + 1


def flatten_tasks_for_response(tasks: Sequence[TaskNode]) -> list[TaskNodeRead]:
    return [
        TaskNodeRead.model_validate(task)
        for task in tasks
        if task.node_kind != TaskNodeKind.SYSTEM_ROOT.value
    ]
