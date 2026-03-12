import type { TaskChangeset, TaskRecord, TaskSnapshotResponse, TaskStatus, TaskTreeNode } from "@/lib/api";

export type LocalOperationState = "queued" | "sending" | "failed" | "conflict";

export type LocalTaskRecord = Omit<TaskRecord, "server_id" | "sync_error" | "sync_state"> & {
  server_id: string | null;
  sync_error: string | null;
  sync_state: "synced" | "queued" | "sending" | "failed" | "conflict";
};

export type LocalTaskSyncState = {
  rootId: string | null;
  serverToLocalId: Record<string, string>;
  syncSeq: number;
  tasksById: Record<string, LocalTaskRecord>;
};

type OperationBase = {
  attemptCount: number;
  base_meta_revision: number | null;
  base_sync_seq: number | null;
  createdAt: string;
  error: string | null;
  op_id: string;
  retryAt: number;
  state: LocalOperationState;
};

export type CreateTaskOperation = OperationBase & {
  assignee_user_id: string | null;
  client_id: string;
  content_markdown: string;
  parent_id: string;
  planned_due_at: string | null;
  title: string;
  type: "create_task";
  weight: number;
};

export type PatchTaskOperation = OperationBase & {
  patch: {
    assignee_user_id?: string | null;
    content_markdown?: string | null;
    planned_due_at?: string | null;
    score?: number | null;
    title?: string;
    weight?: number;
  };
  task_id: string;
  type: "patch_task";
};

export type SetStatusOperation = OperationBase & {
  remark: string | null;
  status: TaskStatus;
  task_id: string;
  type: "set_status";
};

export type DeleteTaskOperation = OperationBase & {
  task_id: string;
  type: "delete_task";
};

export type ReorderTasksOperation = OperationBase & {
  parent_id: string;
  task_ids: string[];
  type: "reorder_tasks";
};

export type LocalTaskOperation =
  | CreateTaskOperation
  | DeleteTaskOperation
  | PatchTaskOperation
  | ReorderTasksOperation
  | SetStatusOperation;

export type PersistedTaskWorkspaceState = {
  base: LocalTaskSyncState;
  outbox: LocalTaskOperation[];
  updatedAt: string;
  workspaceId: string;
};

export type ProjectedTaskWorkspace = {
  rootTask: TaskTreeNode | null;
  state: LocalTaskSyncState;
};

export type TaskPatchFields = PatchTaskOperation["patch"];

export const EMPTY_LOCAL_TASK_SYNC_STATE: LocalTaskSyncState = {
  rootId: null,
  serverToLocalId: {},
  syncSeq: 0,
  tasksById: {},
};

function nowIso() {
  return new Date().toISOString();
}

function cloneTask(task: LocalTaskRecord): LocalTaskRecord {
  return { ...task };
}

function cloneTasks(tasksById: Record<string, LocalTaskRecord>) {
  return Object.fromEntries(Object.entries(tasksById).map(([taskId, task]) => [taskId, cloneTask(task)]));
}

function sortTaskRecords(tasks: LocalTaskRecord[]) {
  return [...tasks].sort((left, right) => {
    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }

    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order;
    }

    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });
}

function buildChildMap(tasksById: Record<string, LocalTaskRecord>) {
  const childIdsByParent: Record<string, string[]> = {};

  for (const task of sortTaskRecords(Object.values(tasksById))) {
    if (!task.parent_id) {
      continue;
    }

    const siblings = childIdsByParent[task.parent_id] ?? [];
    siblings.push(task.id);
    childIdsByParent[task.parent_id] = siblings;
  }

  return childIdsByParent;
}

function updateSyncState(task: LocalTaskRecord, nextState: LocalTaskRecord["sync_state"], error: string | null) {
  const priority = {
    synced: 0,
    queued: 1,
    failed: 2,
    conflict: 3,
    sending: 4,
  } as const;

  if (priority[nextState] < priority[task.sync_state]) {
    if (error && !task.sync_error) {
      task.sync_error = error;
    }
    return;
  }

  task.sync_state = nextState;
  task.sync_error = error;
}

function touchTask(task: LocalTaskRecord, patch: Partial<LocalTaskRecord> = {}): LocalTaskRecord {
  return {
    ...task,
    ...patch,
    meta_revision: task.meta_revision + 1,
    updated_at: nowIso(),
  };
}

function normalizeLocalTasks(tasksById: Record<string, LocalTaskRecord>) {
  const nextTasks = cloneTasks(tasksById);
  const childIdsByParent = buildChildMap(nextTasks);
  const roots = sortTaskRecords(Object.values(nextTasks).filter((task) => task.parent_id === null));
  let resolvedRootId: string | null = null;

  function walk(taskId: string, rootId: string, depth: number, path: string) {
    const task = nextTasks[taskId];
    if (!task) {
      return;
    }

    nextTasks[taskId] = {
      ...task,
      depth,
      path,
      root_id: rootId,
    };

    (childIdsByParent[taskId] ?? []).forEach((childId) => {
      walk(childId, rootId, depth + 1, `${path}/${childId}`);
    });
  }

  roots.forEach((rootTask, index) => {
    const rootId = rootTask.id;
    if (index === 0) {
      resolvedRootId = rootId;
    }
    walk(rootId, rootId, 0, rootId);
  });

  return {
    rootId: resolvedRootId,
    tasksById: nextTasks,
  };
}

function recomputeAncestorStatuses(
  tasksById: Record<string, LocalTaskRecord>,
  childIdsByParent: Record<string, string[]>,
  startParentId: string | null,
) {
  let currentId = startParentId;

  while (currentId) {
    const current = tasksById[currentId];
    if (!current) {
      break;
    }

    if (current.node_kind !== "system_root") {
      const children = (childIdsByParent[current.id] ?? [])
        .map((childId) => tasksById[childId])
        .filter((child): child is LocalTaskRecord => Boolean(child));
      const allCompleted = children.length > 0 && children.every((child) => child.status === "completed");

      if (allCompleted && current.status !== "completed") {
        tasksById[current.id] = touchTask(current, {
          completed_at: nowIso(),
          status: "completed",
        });
      } else if (!allCompleted && current.status === "completed") {
        tasksById[current.id] = touchTask(current, {
          completed_at: null,
          status: "in_progress",
        });
      }
    }

    currentId = current.parent_id;
  }
}

function createLocalTaskRecord(
  parentTask: LocalTaskRecord,
  clientId: string,
  title: string,
  contentMarkdown: string,
  assigneeUserId: string | null,
  plannedDueAt: string | null,
  weight: number,
  sortOrder: number,
): LocalTaskRecord {
  const createdAt = nowIso();

  return {
    archived_at: null,
    archived_by_milestone_id: null,
    assignee_user_id: assigneeUserId,
    completed_at: null,
    content_markdown: contentMarkdown,
    created_at: createdAt,
    created_by_user_id: parentTask.created_by_user_id,
    depth: parentTask.depth + 1,
    id: clientId,
    meta_revision: 0,
    node_kind: "task",
    parent_id: parentTask.id,
    path: `${parentTask.path}/${clientId}`,
    planned_due_at: plannedDueAt,
    root_id: parentTask.root_id,
    score: null,
    server_id: null,
    sort_order: sortOrder,
    status: "in_progress",
    sync_error: null,
    sync_state: "queued",
    title,
    updated_at: createdAt,
    weight,
    workspace_id: parentTask.workspace_id,
  };
}

function applyTaskRekey(tasksById: Record<string, LocalTaskRecord>, previousId: string, nextId: string) {
  if (previousId === nextId || !tasksById[previousId]) {
    return tasksById;
  }

  const nextTasks = cloneTasks(tasksById);
  const task = nextTasks[previousId];
  delete nextTasks[previousId];
  nextTasks[nextId] = { ...task, id: nextId };

  for (const currentTask of Object.values(nextTasks)) {
    if (currentTask.parent_id === previousId) {
      currentTask.parent_id = nextId;
    }
    if (currentTask.root_id === previousId) {
      currentTask.root_id = nextId;
    }
  }

  return normalizeLocalTasks(nextTasks).tasksById;
}

function resolveOperationTaskState(operation: LocalTaskOperation): LocalTaskRecord["sync_state"] {
  switch (operation.state) {
    case "failed":
      return "failed";
    case "conflict":
      return "conflict";
    case "sending":
      return "sending";
    default:
      return "queued";
  }
}

function createProjectedState(base: LocalTaskSyncState) {
  return {
    rootId: base.rootId,
    serverToLocalId: { ...base.serverToLocalId },
    syncSeq: base.syncSeq,
    tasksById: cloneTasks(base.tasksById),
  } satisfies LocalTaskSyncState;
}

function applyCreateOperation(state: LocalTaskSyncState, operation: CreateTaskOperation) {
  if (state.tasksById[operation.client_id]) {
    updateSyncState(state.tasksById[operation.client_id], resolveOperationTaskState(operation), operation.error);
    return state;
  }

  const parentTask = state.tasksById[operation.parent_id];
  if (!parentTask) {
    return state;
  }

  const siblingCount = Object.values(state.tasksById).filter((task) => task.parent_id === parentTask.id).length;
  const createdTask = createLocalTaskRecord(
    parentTask,
    operation.client_id,
    operation.title,
    operation.content_markdown,
    operation.assignee_user_id,
    operation.planned_due_at,
    operation.weight,
    siblingCount,
  );
  createdTask.sync_state = resolveOperationTaskState(operation);
  createdTask.sync_error = operation.error;
  state.tasksById[createdTask.id] = createdTask;
  const normalized = normalizeLocalTasks(state.tasksById);
  state.tasksById = normalized.tasksById;
  state.rootId = normalized.rootId;
  return state;
}

function applyPatchOperation(state: LocalTaskSyncState, operation: PatchTaskOperation) {
  const task = state.tasksById[operation.task_id];
  if (!task) {
    return state;
  }

  const normalizedPatch: Partial<LocalTaskRecord> = {};
  if (operation.patch.assignee_user_id !== undefined) {
    normalizedPatch.assignee_user_id = operation.patch.assignee_user_id;
  }
  if (operation.patch.content_markdown !== undefined) {
    normalizedPatch.content_markdown = operation.patch.content_markdown ?? "";
  }
  if (operation.patch.planned_due_at !== undefined) {
    normalizedPatch.planned_due_at = operation.patch.planned_due_at;
  }
  if (operation.patch.score !== undefined) {
    normalizedPatch.score = operation.patch.score;
  }
  if (operation.patch.title !== undefined) {
    normalizedPatch.title = operation.patch.title;
  }
  if (operation.patch.weight !== undefined) {
    normalizedPatch.weight = operation.patch.weight;
  }

  state.tasksById[task.id] = touchTask(task, normalizedPatch);
  updateSyncState(state.tasksById[task.id], resolveOperationTaskState(operation), operation.error);
  return state;
}

function applySetStatusOperation(state: LocalTaskSyncState, operation: SetStatusOperation) {
  const task = state.tasksById[operation.task_id];
  if (!task) {
    return state;
  }

  state.tasksById[task.id] = touchTask(task, {
    completed_at: operation.status === "completed" ? nowIso() : null,
    status: operation.status,
  });
  updateSyncState(state.tasksById[task.id], resolveOperationTaskState(operation), operation.error);
  const childIdsByParent = buildChildMap(state.tasksById);
  recomputeAncestorStatuses(state.tasksById, childIdsByParent, task.parent_id);
  return state;
}

function collectSubtreeIds(tasksById: Record<string, LocalTaskRecord>, taskId: string) {
  const childIdsByParent = buildChildMap(tasksById);
  const deleteIds = new Set<string>();
  const stack = [taskId];

  while (stack.length) {
    const currentId = stack.pop()!;
    deleteIds.add(currentId);
    for (const childId of childIdsByParent[currentId] ?? []) {
      stack.push(childId);
    }
  }

  return deleteIds;
}

function applyDeleteOperation(state: LocalTaskSyncState, operation: DeleteTaskOperation) {
  const task = state.tasksById[operation.task_id];
  if (!task) {
    return state;
  }

  const deleteIds = collectSubtreeIds(state.tasksById, task.id);
  for (const deleteId of deleteIds) {
    delete state.tasksById[deleteId];
  }

  const normalized = normalizeLocalTasks(state.tasksById);
  state.tasksById = normalized.tasksById;
  state.rootId = normalized.rootId;
  const childIdsByParent = buildChildMap(state.tasksById);
  recomputeAncestorStatuses(state.tasksById, childIdsByParent, task.parent_id);
  return state;
}

function applyReorderOperation(state: LocalTaskSyncState, operation: ReorderTasksOperation) {
  for (const [index, taskId] of operation.task_ids.entries()) {
    const task = state.tasksById[taskId];
    if (!task || task.parent_id !== operation.parent_id) {
      continue;
    }

    state.tasksById[taskId] = touchTask(task, { sort_order: index });
    updateSyncState(state.tasksById[taskId], resolveOperationTaskState(operation), operation.error);
  }

  const normalized = normalizeLocalTasks(state.tasksById);
  state.tasksById = normalized.tasksById;
  state.rootId = normalized.rootId;
  return state;
}

function applyOperationSyncMarkers(state: LocalTaskSyncState, operation: LocalTaskOperation) {
  const nextSyncState = resolveOperationTaskState(operation);

  switch (operation.type) {
    case "create_task": {
      const task = state.tasksById[operation.client_id];
      if (task) {
        updateSyncState(task, nextSyncState, operation.error);
      }
      return;
    }
    case "patch_task":
    case "set_status":
    case "delete_task": {
      const task = state.tasksById[operation.task_id];
      if (task) {
        updateSyncState(task, nextSyncState, operation.error);
      }
      return;
    }
    case "reorder_tasks": {
      const parentTask = state.tasksById[operation.parent_id];
      if (parentTask) {
        updateSyncState(parentTask, nextSyncState, operation.error);
      }
      operation.task_ids.forEach((taskId) => {
        const task = state.tasksById[taskId];
        if (task) {
          updateSyncState(task, nextSyncState, operation.error);
        }
      });
    }
  }
}

export function createEmptyPersistedTaskWorkspaceState(workspaceId: string): PersistedTaskWorkspaceState {
  return {
    base: { ...EMPTY_LOCAL_TASK_SYNC_STATE },
    outbox: [],
    updatedAt: nowIso(),
    workspaceId,
  };
}

export function projectTaskWorkspaceState(
  workspaceState: PersistedTaskWorkspaceState,
  statusFilters: TaskStatus[],
): ProjectedTaskWorkspace {
  const projectedState = createProjectedState(workspaceState.base);
  const localDocumentTaskIds = new Set<string>();

  for (const operation of workspaceState.outbox) {
    if (operation.type === "create_task") {
      localDocumentTaskIds.add(operation.client_id);
    }
    if (operation.type === "patch_task" && operation.patch.content_markdown !== undefined) {
      localDocumentTaskIds.add(operation.task_id);
    }

    switch (operation.type) {
      case "create_task":
        applyCreateOperation(projectedState, operation);
        break;
      case "patch_task":
        applyPatchOperation(projectedState, operation);
        break;
      case "set_status":
        applySetStatusOperation(projectedState, operation);
        break;
      case "delete_task":
        if (operation.state === "failed" || operation.state === "conflict") {
          applyOperationSyncMarkers(projectedState, operation);
          break;
        }
        applyDeleteOperation(projectedState, operation);
        break;
      case "reorder_tasks":
        if (operation.state === "failed" || operation.state === "conflict") {
          applyOperationSyncMarkers(projectedState, operation);
          break;
        }
        applyReorderOperation(projectedState, operation);
        break;
    }
  }

  return {
    rootTask: buildVisibleTaskTree(projectedState, statusFilters, localDocumentTaskIds),
    state: projectedState,
  };
}

export function buildVisibleTaskTree(
  state: LocalTaskSyncState,
  statusFilters: TaskStatus[],
  localDocumentTaskIds: Set<string> = new Set(),
): TaskTreeNode | null {
  if (!state.rootId) {
    return null;
  }

  const root = state.tasksById[state.rootId];
  if (!root) {
    return null;
  }

  const childIdsByParent = buildChildMap(state.tasksById);
  const visibleIds = new Set<string>();
  const statusSet = statusFilters.length ? new Set(statusFilters) : null;

  if (!statusSet) {
    for (const taskId of Object.keys(state.tasksById)) {
      visibleIds.add(taskId);
    }
  } else {
    visibleIds.add(root.id);
    for (const task of Object.values(state.tasksById)) {
      if (task.node_kind === "system_root" || !statusSet.has(task.status)) {
        continue;
      }

      let current: LocalTaskRecord | undefined = task;
      while (current) {
        visibleIds.add(current.id);
        current = current.parent_id ? state.tasksById[current.parent_id] : undefined;
      }
    }
  }

  function buildNode(taskId: string): TaskTreeNode | null {
    const task = state.tasksById[taskId];
    if (!task || !visibleIds.has(taskId)) {
      return null;
    }

    const children = (childIdsByParent[task.id] ?? [])
      .map((childId) => buildNode(childId))
      .filter((child): child is TaskTreeNode => child !== null);

    return {
      ...task,
      children,
      document_sync_mode: !task.server_id || localDocumentTaskIds.has(task.id) ? "local" : "collab",
      matched_filter: statusSet ? task.id !== root.id && statusSet.has(task.status) : true,
    };
  }

  return buildNode(root.id);
}

function applyIdMappings(base: LocalTaskSyncState, changeset: TaskChangeset) {
  if (!changeset.id_mappings.length) {
    return base;
  }

  let tasksById = cloneTasks(base.tasksById);
  const serverToLocalId = { ...base.serverToLocalId };

  for (const mapping of changeset.id_mappings) {
    const currentLocalId = serverToLocalId[mapping.task_id];
    if (currentLocalId && currentLocalId !== mapping.client_id) {
      tasksById = applyTaskRekey(tasksById, currentLocalId, mapping.client_id);
    }
    serverToLocalId[mapping.task_id] = mapping.client_id;
  }

  return {
    ...base,
    serverToLocalId,
    tasksById,
  };
}

function buildBaseTaskFromServer(task: TaskRecord, base: LocalTaskSyncState): LocalTaskRecord {
  const localId = base.serverToLocalId[task.id] ?? task.id;
  const parentLocalId = task.parent_id ? base.serverToLocalId[task.parent_id] ?? task.parent_id : null;
  const rootLocalId = base.serverToLocalId[task.root_id] ?? task.root_id;
  const parentTask = parentLocalId ? base.tasksById[parentLocalId] : null;

  return {
    ...task,
    id: localId,
    parent_id: parentLocalId,
    path: parentTask ? `${parentTask.path}/${localId}` : localId,
    root_id: rootLocalId,
    server_id: task.id,
    sync_error: null,
    sync_state: "synced",
  };
}

export function applySnapshotToTaskBase(
  base: LocalTaskSyncState,
  snapshot: TaskSnapshotResponse,
): LocalTaskSyncState {
  const nextBase: LocalTaskSyncState = {
    rootId: snapshot.root_id ? base.serverToLocalId[snapshot.root_id] ?? snapshot.root_id : null,
    serverToLocalId: { ...base.serverToLocalId },
    syncSeq: snapshot.sync_seq,
    tasksById: {},
  };

  const orderedTasks = [...snapshot.tasks].sort((left, right) => {
    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order;
    }
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });

  for (const task of orderedTasks) {
    const localId = nextBase.serverToLocalId[task.id] ?? task.id;
    nextBase.serverToLocalId[task.id] = localId;
    nextBase.tasksById[localId] = buildBaseTaskFromServer(task, nextBase);
  }

  const normalized = normalizeLocalTasks(nextBase.tasksById);
  return {
    ...nextBase,
    rootId: snapshot.root_id ? nextBase.serverToLocalId[snapshot.root_id] ?? normalized.rootId : normalized.rootId,
    tasksById: normalized.tasksById,
  };
}

export function applyChangesetToTaskBase(base: LocalTaskSyncState, changeset: TaskChangeset): LocalTaskSyncState {
  const nextBase = applyIdMappings(
    {
      rootId: base.rootId,
      serverToLocalId: { ...base.serverToLocalId },
      syncSeq: Math.max(base.syncSeq, changeset.sync_seq),
      tasksById: cloneTasks(base.tasksById),
    },
    changeset,
  );

  for (const deleteId of changeset.deletes) {
    const localId = nextBase.serverToLocalId[deleteId] ?? deleteId;
    const subtreeIds = collectSubtreeIds(nextBase.tasksById, localId);
    for (const subtreeId of subtreeIds) {
      const task = nextBase.tasksById[subtreeId];
      if (task?.server_id) {
        delete nextBase.serverToLocalId[task.server_id];
      }
      delete nextBase.tasksById[subtreeId];
    }
  }

  const orderedUpserts = [...changeset.upserts].sort((left, right) => {
    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order;
    }
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });

  for (const task of orderedUpserts) {
    const localId = nextBase.serverToLocalId[task.id] ?? task.id;
    nextBase.serverToLocalId[task.id] = localId;
    nextBase.tasksById[localId] = buildBaseTaskFromServer(task, nextBase);
  }

  const normalized = normalizeLocalTasks(nextBase.tasksById);
  return {
    ...nextBase,
    rootId: normalized.rootId,
    tasksById: normalized.tasksById,
  };
}

export function resolveServerTaskId(state: LocalTaskSyncState, localTaskId: string) {
  return state.tasksById[localTaskId]?.server_id ?? null;
}

export function findOperationIndex(outbox: LocalTaskOperation[], opId: string) {
  return outbox.findIndex((operation) => operation.op_id === opId);
}

export function findPendingCreateOperation(outbox: LocalTaskOperation[], localTaskId: string) {
  return outbox.find(
    (operation): operation is CreateTaskOperation => operation.type === "create_task" && operation.client_id === localTaskId,
  );
}

export function createOperationBase(opId: string): OperationBase {
  return {
    attemptCount: 0,
    base_meta_revision: null,
    base_sync_seq: null,
    createdAt: nowIso(),
    error: null,
    op_id: opId,
    retryAt: 0,
    state: "queued",
  };
}
