from copy import deepcopy

from sqlalchemy.orm import Session

from rootspread_api.core.time import utc_now
from rootspread_api.models.task import TaskNode, TaskNodeKind, TaskStatus
from rootspread_api.schemas.task import TaskNodeRead, TaskTreeNodeRead


def is_task_ready_for_archive(task: TaskNode, target_at) -> bool:
    if task.node_kind == TaskNodeKind.SYSTEM_ROOT.value:
        return False

    if task.archived_at is not None:
        return False

    if task.status == TaskStatus.COMPLETED.value:
        return task.completed_at is not None and task.completed_at <= target_at

    if task.status == TaskStatus.TERMINATED.value:
        return task.updated_at <= target_at

    return False


def build_milestone_snapshot_tree(
    tasks: list[TaskNode], archived_ids: set[str]
) -> TaskTreeNodeRead | None:
    by_id = {task.id: task for task in tasks}
    system_root = next(
        (task for task in tasks if task.node_kind == TaskNodeKind.SYSTEM_ROOT.value),
        None,
    )

    if system_root is None:
        return None

    included_ids = {system_root.id}
    included_ids.update(archived_ids)

    for task_id in list(archived_ids):
        parent_id = by_id[task_id].parent_id
        while parent_id:
            included_ids.add(parent_id)
            parent_id = by_id[parent_id].parent_id if parent_id in by_id else None

    nodes_by_id: dict[str, TaskTreeNodeRead] = {}
    for task in sorted(tasks, key=lambda item: (item.depth, item.sort_order, item.created_at)):
        if task.id not in included_ids:
            continue

        node = TaskTreeNodeRead(
            **TaskNodeRead.model_validate(task).model_dump(),
            matched_filter=(
                task.id in archived_ids and task.node_kind != TaskNodeKind.SYSTEM_ROOT.value
            ),
            children=[],
        )
        nodes_by_id[task.id] = node

    for task in sorted(tasks, key=lambda item: (item.depth, item.sort_order, item.created_at)):
        node = nodes_by_id.get(task.id)
        if node is None:
            continue

        parent = nodes_by_id.get(task.parent_id) if task.parent_id else None
        if parent is not None:
            parent.children.append(node)

    return nodes_by_id.get(system_root.id)


def archive_tasks_for_milestone(session: Session, tasks: list[TaskNode], milestone_id: str) -> int:
    archived_at = utc_now()
    archived_count = 0
    for task in tasks:
        if task.archived_at is None:
            task.archived_at = archived_at
            task.archived_by_milestone_id = milestone_id
            archived_count += 1
    return archived_count


def filter_snapshot_tree(node: dict | None, statuses: set[str] | None) -> dict | None:
    if node is None:
        return None

    if not statuses:
        return deepcopy(node)

    is_root = node.get("node_kind") == TaskNodeKind.SYSTEM_ROOT.value
    filtered_children = [
        child
        for child in (filter_snapshot_tree(child, statuses) for child in node.get("children", []))
        if child is not None
    ]
    matched = (not is_root) and node.get("status") in statuses

    if is_root or matched or filtered_children:
        new_node = deepcopy(node)
        new_node["matched_filter"] = matched
        new_node["children"] = filtered_children
        return new_node

    return None
