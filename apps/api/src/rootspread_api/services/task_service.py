from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rootspread_api.core.time import utc_now
from rootspread_api.models.task import TaskNode, TaskStatus, TaskStatusTransition
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
) -> list[TaskTreeNodeRead]:
    ordered_tasks = sorted(tasks, key=lambda item: (item.depth, item.sort_order, item.created_at))
    by_id = {task.id: task for task in ordered_tasks}

    if statuses:
        visible_ids = {task.id for task in ordered_tasks if task.status in statuses}
        for task_id in list(visible_ids):
            parent_id = by_id[task_id].parent_id
            while parent_id:
                visible_ids.add(parent_id)
                parent_id = by_id[parent_id].parent_id if parent_id in by_id else None
    else:
        visible_ids = set(by_id)

    children_map: dict[str | None, list[TaskTreeNodeRead]] = defaultdict(list)

    for task in ordered_tasks:
        if task.id not in visible_ids:
            continue

        node_data = TaskNodeRead.model_validate(task).model_dump()
        node = TaskTreeNodeRead(
            **node_data,
            matched_filter=(not statuses or task.status in statuses),
        )
        children_map[task.parent_id].append(node)
        children_map[task.id]

    for nodes in children_map.values():
        for node in nodes:
            node.children = children_map[node.id]

    return children_map[None]


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
    return [TaskNodeRead.model_validate(task) for task in tasks]
