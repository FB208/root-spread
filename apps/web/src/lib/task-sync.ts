"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  API_WS_BASE_URL,
  apiRequest,
  ApiError,
  type TaskChangeset,
  type TaskOperationRequest,
  type TaskRecord,
  type TaskSnapshotResponse,
  type TaskStatus,
  type TaskTreeNode,
} from "@/lib/api";

type TaskSyncState = {
  rootId: string | null;
  syncSeq: number;
  tasksById: Record<string, TaskRecord>;
};

type UseTaskSyncOptions = {
  accessToken: string | null;
  enabled: boolean;
  statusFilters: TaskStatus[];
  workspaceId: string;
};

type TaskPatch = Partial<TaskRecord>;

type UseTaskSyncResult = {
  connected: boolean;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  rootTask: TaskTreeNode | null;
  syncSeq: number;
  bulkDeleteTasks: (taskIds: string[]) => Promise<void>;
  bulkSetStatus: (taskIds: string[], status: TaskStatus, remark?: string | null) => Promise<void>;
  createTask: (parentId: string, title?: string) => Promise<string | null>;
  deleteTask: (taskId: string) => Promise<void>;
  patchTask: (taskId: string, patch: TaskPatch) => Promise<void>;
  reorderTasks: (parentId: string, orderedTaskIds: string[]) => Promise<void>;
  setTaskStatus: (taskId: string, status: TaskStatus, remark?: string | null) => Promise<void>;
};

const EMPTY_SYNC_STATE: TaskSyncState = {
  rootId: null,
  syncSeq: 0,
  tasksById: {},
};

function nowIso() {
  return new Date().toISOString();
}

function sortTaskRecords(tasks: TaskRecord[]) {
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

function buildSyncState(snapshot: TaskSnapshotResponse): TaskSyncState {
  const tasksById: Record<string, TaskRecord> = {};
  for (const task of sortTaskRecords(snapshot.tasks)) {
    tasksById[task.id] = task;
  }

  return {
    rootId: snapshot.root_id,
    syncSeq: snapshot.sync_seq,
    tasksById,
  };
}

function buildChildMap(tasksById: Record<string, TaskRecord>) {
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

function touchTask(task: TaskRecord, patch: Partial<TaskRecord> = {}): TaskRecord {
  return {
    ...task,
    ...patch,
    meta_revision: task.meta_revision + 1,
    updated_at: nowIso(),
  };
}

function recomputeAncestorStatuses(
  tasksById: Record<string, TaskRecord>,
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
        .filter((child): child is TaskRecord => Boolean(child));
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

function buildVisibleTaskTree(state: TaskSyncState, statusFilters: TaskStatus[]): TaskTreeNode | null {
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

      let current: TaskRecord | undefined = task;
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
      matched_filter: statusSet ? task.id !== root.id && statusSet.has(task.status) : true,
    };
  }

  return buildNode(root.id);
}

function applyChangeset(state: TaskSyncState, changeset: TaskChangeset): TaskSyncState {
  const tasksById = { ...state.tasksById };

  for (const taskId of changeset.deletes) {
    delete tasksById[taskId];
  }

  for (const task of changeset.upserts) {
    tasksById[task.id] = task;
  }

  const rootId = state.rootId && tasksById[state.rootId] ? state.rootId : changeset.upserts.find((task) => task.parent_id === null)?.id ?? null;

  return {
    rootId,
    syncSeq: Math.max(state.syncSeq, changeset.sync_seq),
    tasksById,
  };
}

function patchTaskInState(state: TaskSyncState, taskId: string, patch: Partial<TaskRecord>): TaskSyncState {
  const task = state.tasksById[taskId];
  if (!task) {
    return state;
  }

  return {
    ...state,
    tasksById: {
      ...state.tasksById,
      [taskId]: touchTask(task, patch),
    },
  };
}

function insertTaskInState(state: TaskSyncState, task: TaskRecord): TaskSyncState {
  const tasksById = {
    ...state.tasksById,
    [task.id]: task,
  };
  const childIdsByParent = buildChildMap(tasksById);
  recomputeAncestorStatuses(tasksById, childIdsByParent, task.parent_id);

  return {
    ...state,
    tasksById,
  };
}

function removeTaskFromState(
  state: TaskSyncState,
  taskId: string,
): { nextState: TaskSyncState; removedParentId: string | null } {
  const task = state.tasksById[taskId];
  if (!task) {
    return { nextState: state, removedParentId: null };
  }

  const childIdsByParent = buildChildMap(state.tasksById);
  const stack = [taskId];
  const deleteIds = new Set<string>();
  while (stack.length) {
    const currentId = stack.pop()!;
    deleteIds.add(currentId);
    for (const childId of childIdsByParent[currentId] ?? []) {
      stack.push(childId);
    }
  }

  const tasksById = { ...state.tasksById };
  for (const deleteId of deleteIds) {
    delete tasksById[deleteId];
  }

  const nextChildMap = buildChildMap(tasksById);
  recomputeAncestorStatuses(tasksById, nextChildMap, task.parent_id);

  return {
    nextState: {
      ...state,
      tasksById,
    },
    removedParentId: task.parent_id,
  };
}

function reorderTasksInState(state: TaskSyncState, parentId: string, orderedTaskIds: string[]): TaskSyncState {
  const tasksById = { ...state.tasksById };
  for (const [index, taskId] of orderedTaskIds.entries()) {
    const task = tasksById[taskId];
    if (!task || task.parent_id !== parentId) {
      continue;
    }
    tasksById[taskId] = touchTask(task, { sort_order: index });
  }

  return {
    ...state,
    tasksById,
  };
}

function setTaskStatusInState(state: TaskSyncState, taskId: string, status: TaskStatus): TaskSyncState {
  const task = state.tasksById[taskId];
  if (!task) {
    return state;
  }

  const tasksById = {
    ...state.tasksById,
    [taskId]: touchTask(task, {
      completed_at: status === "completed" ? nowIso() : null,
      status,
    }),
  };
  const childIdsByParent = buildChildMap(tasksById);
  recomputeAncestorStatuses(tasksById, childIdsByParent, task.parent_id);

  return {
    ...state,
    tasksById,
  };
}

function bulkSetTaskStatusInState(state: TaskSyncState, taskIds: string[], status: TaskStatus): TaskSyncState {
  let nextState = state;
  for (const taskId of taskIds) {
    nextState = setTaskStatusInState(nextState, taskId, status);
  }
  return nextState;
}

function bulkDeleteTasksInState(state: TaskSyncState, taskIds: string[]): TaskSyncState {
  const selectedIds = new Set(taskIds);
  const rootDeletes = taskIds.filter((taskId) => {
    const task = state.tasksById[taskId];
    if (!task) {
      return false;
    }

    return !task.path.split("/").slice(0, -1).some((ancestorId) => selectedIds.has(ancestorId));
  });

  let nextState = state;
  for (const taskId of rootDeletes) {
    nextState = removeTaskFromState(nextState, taskId).nextState;
  }
  return nextState;
}

function createOptimisticTask(parentTask: TaskRecord, title: string, sortOrder: number): TaskRecord {
  const createdAt = nowIso();
  const optimisticId = `optimistic:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  return {
    archived_at: null,
    archived_by_milestone_id: null,
    assignee_user_id: null,
    completed_at: null,
    content_markdown: "",
    created_at: createdAt,
    created_by_user_id: parentTask.created_by_user_id,
    depth: parentTask.depth + 1,
    id: optimisticId,
    meta_revision: 0,
    node_kind: "task",
    parent_id: parentTask.id,
    path: `${parentTask.path}/${optimisticId}`,
    planned_due_at: null,
    root_id: parentTask.root_id,
    score: null,
    sort_order: sortOrder,
    status: "in_progress",
    title,
    updated_at: createdAt,
    weight: 0,
    workspace_id: parentTask.workspace_id,
  };
}

function createWebSocketUrl(workspaceId: string, token: string, since: number) {
  const url = new URL(`${API_WS_BASE_URL}/workspaces/${workspaceId}/tasks/stream`);
  url.searchParams.set("token", token);
  url.searchParams.set("since", String(Math.max(0, since)));
  return url.toString();
}

export function useTaskSync({ accessToken, enabled, statusFilters, workspaceId }: UseTaskSyncOptions): UseTaskSyncResult {
  const [syncState, setSyncState] = useState<TaskSyncState>(EMPTY_SYNC_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const syncStateRef = useRef(syncState);
  const handledOpIdsRef = useRef<string[]>([]);

  useEffect(() => {
    syncStateRef.current = syncState;
  }, [syncState]);

  const rememberHandledOpId = useCallback((opId?: string | null) => {
    if (!opId) {
      return;
    }

    const next = handledOpIdsRef.current.filter((item) => item !== opId);
    next.push(opId);
    handledOpIdsRef.current = next.slice(-200);
  }, []);

  const refresh = useCallback(async () => {
    if (!accessToken || !enabled) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const snapshot = await apiRequest<TaskSnapshotResponse>(`/workspaces/${workspaceId}/tasks/snapshot`, {
        token: accessToken,
      });
      setSyncState(buildSyncState(snapshot));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载实时任务快照失败。");
      setSyncState(EMPTY_SYNC_STATE);
    } finally {
      setLoading(false);
    }
  }, [accessToken, enabled, workspaceId]);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      setLoading(false);
      return;
    }

    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || !accessToken) {
      setConnected(false);
      return;
    }

    let disposed = false;
    let reconnectTimer: number | null = null;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (disposed) {
        return;
      }

      socket = new WebSocket(createWebSocketUrl(workspaceId, accessToken, syncStateRef.current.syncSeq));
      socket.onopen = () => {
        setConnected(true);
      };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as TaskChangeset | { type: string; sync_seq: number };
          if ("type" in payload && payload.type === "ready") {
            return;
          }

          if ("op_id" in payload && payload.op_id && handledOpIdsRef.current.includes(payload.op_id)) {
            return;
          }

          setSyncState((current) => applyChangeset(current, payload as TaskChangeset));
        } catch {
          setError("实时任务流解析失败。正在尝试恢复连接。");
        }
      };
      socket.onerror = () => {
        setConnected(false);
      };
      socket.onclose = () => {
        setConnected(false);
        if (disposed) {
          return;
        }

        reconnectTimer = window.setTimeout(connect, 1600);
      };
    };

    connect();

    return () => {
      disposed = true;
      setConnected(false);
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [accessToken, enabled, workspaceId]);

  const submitOperation = useCallback(
    async (
      operation: TaskOperationRequest,
      optimisticApply?: (state: TaskSyncState) => TaskSyncState,
      optimisticSuccess?: (state: TaskSyncState, changeset: TaskChangeset) => TaskSyncState,
    ) => {
      if (!accessToken) {
        throw new ApiError("请先登录，再编辑任务。", 401);
      }

      const opId = operation.op_id ?? crypto.randomUUID();
      const requestBody = { ...operation, op_id: opId };
      const previousState = syncStateRef.current;

      if (optimisticApply) {
        setSyncState((current) => optimisticApply(current));
      }

      try {
        setError(null);
        const changeset = await apiRequest<TaskChangeset>(`/workspaces/${workspaceId}/tasks/ops`, {
          json: requestBody,
          method: "POST",
          token: accessToken,
        });
        rememberHandledOpId(opId);
        setSyncState((current) =>
          optimisticSuccess ? optimisticSuccess(current, changeset) : applyChangeset(current, changeset),
        );
        return changeset;
      } catch (submitError) {
        setSyncState(previousState);
        throw submitError;
      }
    },
    [accessToken, rememberHandledOpId, workspaceId],
  );

  const patchTask = useCallback(
    async (taskId: string, patch: TaskPatch) => {
      await submitOperation(
        {
          ...patch,
          task_id: taskId,
          type: "patch_task",
        },
        (state) => patchTaskInState(state, taskId, patch),
      );
    },
    [submitOperation],
  );

  const setTaskStatus = useCallback(
    async (taskId: string, status: TaskStatus, remark?: string | null) => {
      await submitOperation(
        {
          remark: remark ?? null,
          status,
          task_id: taskId,
          type: "set_status",
        },
        (state) => setTaskStatusInState(state, taskId, status),
      );
    },
    [submitOperation],
  );

  const createTask = useCallback(
    async (parentId: string, title = "新节点") => {
      const parentTask = syncStateRef.current.tasksById[parentId];
      if (!parentTask) {
        return null;
      }

      const childIdsByParent = buildChildMap(syncStateRef.current.tasksById);
      const optimisticTask = createOptimisticTask(parentTask, title, childIdsByParent[parentId]?.length ?? 0);
      const changeset = await submitOperation(
        {
          parent_id: parentId,
          title,
          type: "create_task",
        },
        (state) => insertTaskInState(state, optimisticTask),
        (state, response) => applyChangeset(removeTaskFromState(state, optimisticTask.id).nextState, response),
      );

      const createdTask = changeset.upserts.find((task) => task.parent_id === parentId && !task.id.startsWith("optimistic:"));
      return createdTask?.id ?? null;
    },
    [submitOperation],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      await submitOperation(
        {
          task_id: taskId,
          type: "delete_task",
        },
        (state) => removeTaskFromState(state, taskId).nextState,
      );
    },
    [submitOperation],
  );

  const reorderTasks = useCallback(
    async (parentId: string, orderedTaskIds: string[]) => {
      await submitOperation(
        {
          parent_id: parentId,
          task_ids: orderedTaskIds,
          type: "reorder_tasks",
        },
        (state) => reorderTasksInState(state, parentId, orderedTaskIds),
      );
    },
    [submitOperation],
  );

  const bulkSetStatus = useCallback(
    async (taskIds: string[], status: TaskStatus, remark?: string | null) => {
      await submitOperation(
        {
          remark: remark ?? null,
          status,
          task_ids: taskIds,
          type: "bulk_set_status",
        },
        (state) => bulkSetTaskStatusInState(state, taskIds, status),
      );
    },
    [submitOperation],
  );

  const bulkDeleteTasks = useCallback(
    async (taskIds: string[]) => {
      await submitOperation(
        {
          task_ids: taskIds,
          type: "bulk_delete_tasks",
        },
        (state) => bulkDeleteTasksInState(state, taskIds),
      );
    },
    [submitOperation],
  );

  const rootTask = useMemo(() => buildVisibleTaskTree(syncState, statusFilters), [statusFilters, syncState]);

  return {
    bulkDeleteTasks,
    bulkSetStatus,
    connected,
    createTask,
    deleteTask,
    error,
    loading,
    patchTask,
    refresh,
    reorderTasks,
    rootTask,
    setTaskStatus,
    syncSeq: syncState.syncSeq,
  };
}
