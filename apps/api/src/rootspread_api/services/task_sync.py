from collections.abc import Iterable, Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from rootspread_api.models.task import TaskChangeEvent, TaskNode, TaskNodeKind
from rootspread_api.schemas.task import (
    TaskChangesResponse,
    TaskChangeset,
    TaskNodeRead,
    TaskSnapshotResponse,
)


def bump_task_meta_revision(task: TaskNode) -> None:
    task.meta_revision = int(task.meta_revision or 0) + 1


def bump_task_meta_revisions(tasks: Iterable[TaskNode | None]) -> None:
    seen: set[str] = set()
    for task in tasks:
        if task is None or task.id in seen:
            continue
        seen.add(task.id)
        bump_task_meta_revision(task)


def collect_ancestor_ids(task: TaskNode | None) -> list[str]:
    return [ancestor.id for ancestor in collect_ancestors(task)]


def collect_ancestors(task: TaskNode | None) -> list[TaskNode]:
    ancestors: list[TaskNode] = []
    current = task.parent if task is not None else None

    while current is not None:
        ancestors.append(current)
        current = current.parent

    return ancestors


def collect_self_and_ancestors(task: TaskNode | None) -> list[TaskNode]:
    if task is None:
        return []

    return [task, *collect_ancestors(task)]


def collect_self_and_ancestor_ids(task: TaskNode | None) -> list[str]:
    ids: list[str] = []
    for current in collect_self_and_ancestors(task):
        ids.append(current.id)
    return ids


def collect_subtree_ids(session: Session, workspace_id: str, task: TaskNode) -> list[str]:
    subtree_prefix = f"{task.path}/%"
    return list(
        session.scalars(
            select(TaskNode.id).where(
                TaskNode.workspace_id == workspace_id,
                TaskNode.archived_at.is_(None),
                or_(TaskNode.id == task.id, TaskNode.path.like(subtree_prefix)),
            )
        ).all()
    )


def get_latest_task_sync_seq(session: Session, workspace_id: str) -> int:
    latest = session.scalar(
        select(func.max(TaskChangeEvent.seq)).where(TaskChangeEvent.workspace_id == workspace_id)
    )
    return int(latest or 0)


def build_task_snapshot(session: Session, workspace_id: str) -> TaskSnapshotResponse:
    tasks = session.scalars(
        select(TaskNode)
        .where(TaskNode.workspace_id == workspace_id, TaskNode.archived_at.is_(None))
        .order_by(TaskNode.depth.asc(), TaskNode.sort_order.asc(), TaskNode.created_at.asc())
    ).all()
    root = next(
        (
            task
            for task in tasks
            if task.node_kind == TaskNodeKind.SYSTEM_ROOT.value and task.parent_id is None
        ),
        None,
    )
    return TaskSnapshotResponse(
        workspace_id=workspace_id,
        root_id=root.id if root is not None else None,
        sync_seq=get_latest_task_sync_seq(session, workspace_id),
        tasks=[TaskNodeRead.model_validate(task) for task in tasks],
    )


def persist_task_changeset(
    session: Session,
    workspace_id: str,
    actor_user_id: str | None,
    op_type: str,
    upsert_ids: Sequence[str],
    delete_ids: Sequence[str],
    *,
    op_id: str | None = None,
) -> TaskChangeset:
    normalized_upsert_ids = list(dict.fromkeys(task_id for task_id in upsert_ids if task_id))
    normalized_delete_ids = list(dict.fromkeys(task_id for task_id in delete_ids if task_id))
    filtered_upsert_ids = [
        task_id for task_id in normalized_upsert_ids if task_id not in set(normalized_delete_ids)
    ]

    upserts = []
    if filtered_upsert_ids:
        task_map = {
            task.id: task
            for task in session.scalars(
                select(TaskNode).where(
                    TaskNode.workspace_id == workspace_id,
                    TaskNode.archived_at.is_(None),
                    TaskNode.id.in_(filtered_upsert_ids),
                )
            ).all()
        }
        upserts = [
            TaskNodeRead.model_validate(task_map[task_id])
            for task_id in filtered_upsert_ids
            if task_id in task_map
        ]

    if not upserts and not normalized_delete_ids:
        return TaskChangeset(
            workspace_id=workspace_id,
            sync_seq=get_latest_task_sync_seq(session, workspace_id),
            op_type=op_type,
            op_id=op_id,
        )

    event = TaskChangeEvent(
        workspace_id=workspace_id,
        actor_user_id=actor_user_id,
        op_type=op_type,
        op_id=op_id,
        payload_json={},
    )
    session.add(event)
    session.flush()

    changeset = TaskChangeset(
        workspace_id=workspace_id,
        sync_seq=int(event.seq),
        op_type=op_type,
        op_id=op_id,
        upserts=upserts,
        deletes=normalized_delete_ids,
    )
    event.payload_json = changeset.model_dump(mode="json")
    session.flush()
    return changeset


def list_task_changes_since(
    session: Session,
    workspace_id: str,
    since: int,
) -> TaskChangesResponse:
    events = session.scalars(
        select(TaskChangeEvent)
        .where(TaskChangeEvent.workspace_id == workspace_id, TaskChangeEvent.seq > since)
        .order_by(TaskChangeEvent.seq.asc())
    ).all()
    changesets = [TaskChangeset.model_validate(event.payload_json) for event in events]
    sync_seq = (
        changesets[-1].sync_seq if changesets else get_latest_task_sync_seq(session, workspace_id)
    )
    return TaskChangesResponse(
        workspace_id=workspace_id,
        sync_seq=sync_seq,
        events=changesets,
    )
