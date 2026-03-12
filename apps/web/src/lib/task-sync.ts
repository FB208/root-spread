"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  API_WS_BASE_URL,
  ApiError,
  apiRequest,
  type TaskChangeset,
  type TaskChangesResponse,
  type TaskOperationRequest,
  type TaskSnapshotResponse,
  type TaskStatus,
  type TaskStreamReadyEvent,
  type TaskTreeNode,
} from "@/lib/api";
import {
  applyChangesetToTaskBase,
  applySnapshotToTaskBase,
  createEmptyPersistedTaskWorkspaceState,
  createOperationBase,
  findOperationIndex,
  findPendingCreateOperation,
  projectTaskWorkspaceState,
  resolveServerTaskId,
  type CreateTaskOperation,
  type DeleteTaskOperation,
  type LocalTaskOperation,
  type LocalTaskSyncState,
  type PatchTaskOperation,
  type PersistedTaskWorkspaceState,
  type ReorderTasksOperation,
  type SetStatusOperation,
  type TaskPatchFields,
} from "@/lib/task-sync-local";
import {
  claimTaskSyncLeader,
  loadPersistedTaskWorkspaceState,
  notifyTaskWorkspacePersistence,
  releaseTaskSyncLeader,
  subscribeTaskSyncLeader,
  savePersistedTaskWorkspaceState,
  subscribeTaskWorkspacePersistence,
} from "@/lib/task-sync-storage";

type UseTaskSyncOptions = {
  accessToken: string | null;
  enabled: boolean;
  statusFilters: TaskStatus[];
  workspaceId: string;
};

type UseTaskSyncResult = {
  connected: boolean;
  discardTaskChanges: (taskId: string) => Promise<void>;
  error: string | null;
  isSyncLeader: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  rootTask: TaskTreeNode | null;
  retryTaskSync: (taskId: string) => Promise<void>;
  syncSeq: number;
  bulkDeleteTasks: (taskIds: string[]) => Promise<void>;
  bulkSetStatus: (taskIds: string[], status: TaskStatus, remark?: string | null) => Promise<void>;
  createTask: (parentId: string, title?: string) => Promise<string | null>;
  deleteTask: (taskId: string) => Promise<void>;
  patchTask: (taskId: string, patch: TaskPatchFields) => Promise<void>;
  reorderTasks: (parentId: string, orderedTaskIds: string[]) => Promise<void>;
  setTaskStatus: (taskId: string, status: TaskStatus, remark?: string | null) => Promise<void>;
};

const LEADER_HEARTBEAT_MS = 1500;
const LEADER_TTL_MS = 5000;

function createWebSocketUrl(workspaceId: string, token: string, since: number) {
  const url = new URL(`${API_WS_BASE_URL}/workspaces/${workspaceId}/tasks/stream`);
  url.searchParams.set("token", token);
  url.searchParams.set("since", String(Math.max(0, since)));
  return url.toString();
}

function nextWorkspaceState(
  workspaceState: PersistedTaskWorkspaceState,
  patch: Partial<PersistedTaskWorkspaceState>,
): PersistedTaskWorkspaceState {
  return {
    ...workspaceState,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

function createTemporaryTaskId() {
  return `tmp:${crypto.randomUUID()}`;
}

function isRetryableError(error: unknown) {
  if (error instanceof ApiError) {
    return error.status >= 500 || error.status === 429;
  }

  return true;
}

function retryDelay(attemptCount: number) {
  return Math.min(16000, 800 * 2 ** Math.max(0, attemptCount));
}

function getOperationTaskIds(operation: LocalTaskOperation) {
  switch (operation.type) {
    case "create_task":
      return [operation.client_id];
    case "patch_task":
    case "set_status":
    case "delete_task":
      return [operation.task_id];
    case "reorder_tasks":
      return [operation.parent_id, ...operation.task_ids];
  }
}

function isConflictError(error: unknown) {
  return error instanceof ApiError && error.status === 409;
}

function isGapDetected(currentSyncSeq: number, changesets: TaskChangeset[]) {
  let expectedSyncSeq = currentSyncSeq;
  const orderedChangesets = [...changesets].sort((left, right) => left.sync_seq - right.sync_seq);

  for (const changeset of orderedChangesets) {
    if (changeset.sync_seq <= expectedSyncSeq) {
      continue;
    }

    if (changeset.sync_seq !== expectedSyncSeq + 1) {
      return true;
    }

    expectedSyncSeq = changeset.sync_seq;
  }

  return false;
}

function applyIncomingChangesets(
  workspaceState: PersistedTaskWorkspaceState,
  changesets: TaskChangeset[],
): PersistedTaskWorkspaceState | null {
  if (!changesets.length) {
    return workspaceState;
  }

  if (isGapDetected(workspaceState.base.syncSeq, changesets)) {
    return null;
  }

  const orderedChangesets = [...changesets].sort((left, right) => left.sync_seq - right.sync_seq);
  let nextBase = workspaceState.base;
  let nextOutbox = workspaceState.outbox;

  for (const changeset of orderedChangesets) {
    if (changeset.sync_seq <= nextBase.syncSeq) {
      continue;
    }

    nextBase = applyChangesetToTaskBase(nextBase, changeset);
    if (changeset.op_id) {
      nextOutbox = nextOutbox.filter((operation) => operation.op_id !== changeset.op_id);
    }
  }

  return {
    ...workspaceState,
    base: nextBase,
    outbox: nextOutbox,
  };
}

function refreshOperationForRetry(current: PersistedTaskWorkspaceState, operation: LocalTaskOperation): LocalTaskOperation {
  switch (operation.type) {
    case "create_task":
      return {
        ...operation,
        attemptCount: 0,
        base_sync_seq: current.base.syncSeq,
        error: null,
        retryAt: 0,
        state: "queued",
      };
    case "patch_task":
    case "set_status":
    case "delete_task": {
      const baseTask = current.base.tasksById[operation.task_id];
      return {
        ...operation,
        attemptCount: 0,
        base_meta_revision: baseTask?.meta_revision ?? operation.base_meta_revision,
        base_sync_seq: current.base.syncSeq,
        error: null,
        retryAt: 0,
        state: "queued",
      };
    }
    case "reorder_tasks": {
      const parentTask = current.base.tasksById[operation.parent_id];
      return {
        ...operation,
        attemptCount: 0,
        base_meta_revision: parentTask?.meta_revision ?? operation.base_meta_revision,
        base_sync_seq: current.base.syncSeq,
        error: null,
        retryAt: 0,
        state: "queued",
      };
    }
  }
}

function buildDeleteSubtreeIds(projectedState: LocalTaskSyncState, taskId: string) {
  const deleteIds = new Set<string>();
  const stack = [taskId];

  while (stack.length) {
    const currentId = stack.pop()!;
    if (deleteIds.has(currentId)) {
      continue;
    }
    deleteIds.add(currentId);
    for (const task of Object.values(projectedState.tasksById)) {
      if (task.parent_id === currentId) {
        stack.push(task.id);
      }
    }
  }

  return deleteIds;
}

function buildRequestFromOperation(
  baseState: LocalTaskSyncState,
  projectedState: LocalTaskSyncState,
  operation: LocalTaskOperation,
): TaskOperationRequest | null {
  switch (operation.type) {
    case "create_task": {
      const parentServerId = resolveServerTaskId(projectedState, operation.parent_id);
      if (!parentServerId) {
        return null;
      }

      return {
        assignee_user_id: operation.assignee_user_id,
        base_meta_revision: operation.base_meta_revision,
        base_sync_seq: operation.base_sync_seq,
        client_id: operation.client_id,
        content_markdown: operation.content_markdown,
        op_id: operation.op_id,
        parent_id: parentServerId,
        planned_due_at: operation.planned_due_at,
        title: operation.title,
        type: operation.type,
        weight: operation.weight,
      };
    }
    case "patch_task": {
      const taskServerId = resolveServerTaskId(projectedState, operation.task_id);
      if (!taskServerId) {
        return null;
      }

      return {
        ...operation.patch,
        base_meta_revision: operation.base_meta_revision ?? baseState.tasksById[operation.task_id]?.meta_revision ?? null,
        base_sync_seq: operation.base_sync_seq,
        op_id: operation.op_id,
        task_id: taskServerId,
        type: operation.type,
      };
    }
    case "set_status": {
      const taskServerId = resolveServerTaskId(projectedState, operation.task_id);
      if (!taskServerId) {
        return null;
      }

      return {
        base_meta_revision: operation.base_meta_revision ?? baseState.tasksById[operation.task_id]?.meta_revision ?? null,
        base_sync_seq: operation.base_sync_seq,
        op_id: operation.op_id,
        remark: operation.remark,
        status: operation.status,
        task_id: taskServerId,
        type: operation.type,
      };
    }
    case "delete_task": {
      const taskServerId = resolveServerTaskId(projectedState, operation.task_id);
      if (!taskServerId) {
        return null;
      }

      return {
        base_meta_revision: operation.base_meta_revision ?? baseState.tasksById[operation.task_id]?.meta_revision ?? null,
        base_sync_seq: operation.base_sync_seq,
        op_id: operation.op_id,
        task_id: taskServerId,
        type: operation.type,
      };
    }
    case "reorder_tasks": {
      const parentServerId = resolveServerTaskId(projectedState, operation.parent_id);
      const orderedTaskIds = operation.task_ids
        .map((taskId) => resolveServerTaskId(projectedState, taskId))
        .filter((taskId): taskId is string => Boolean(taskId));
      if (!parentServerId || orderedTaskIds.length !== operation.task_ids.length) {
        return null;
      }

      return {
        base_meta_revision: operation.base_meta_revision ?? baseState.tasksById[operation.parent_id]?.meta_revision ?? null,
        base_sync_seq: operation.base_sync_seq,
        op_id: operation.op_id,
        parent_id: parentServerId,
        task_ids: orderedTaskIds,
        type: operation.type,
      };
    }
  }
}

function createOperationId() {
  return crypto.randomUUID();
}

function mergePatchIntoCreate(operation: CreateTaskOperation, patch: TaskPatchFields) {
  const nextOperation: CreateTaskOperation = { ...operation };
  if (patch.title !== undefined) {
    nextOperation.title = patch.title;
  }
  if (patch.content_markdown !== undefined && patch.content_markdown !== null) {
    nextOperation.content_markdown = patch.content_markdown;
  }
  if (patch.assignee_user_id !== undefined) {
    nextOperation.assignee_user_id = patch.assignee_user_id;
  }
  if (patch.planned_due_at !== undefined) {
    nextOperation.planned_due_at = patch.planned_due_at;
  }
  if (patch.weight !== undefined) {
    nextOperation.weight = patch.weight;
  }
  nextOperation.error = null;
  nextOperation.retryAt = 0;
  nextOperation.state = "queued";
  return nextOperation;
}

function sanitizePatchForPendingCreate(patch: TaskPatchFields) {
  const { assignee_user_id, content_markdown, planned_due_at, title, weight } = patch;
  return {
    ...(assignee_user_id !== undefined ? { assignee_user_id } : {}),
    ...(content_markdown !== undefined ? { content_markdown } : {}),
    ...(planned_due_at !== undefined ? { planned_due_at } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(weight !== undefined ? { weight } : {}),
  } satisfies TaskPatchFields;
}

function hasPatchFields(patch: TaskPatchFields) {
  return Object.keys(patch).length > 0;
}

export function useTaskSync({ accessToken, enabled, statusFilters, workspaceId }: UseTaskSyncOptions): UseTaskSyncResult {
  const [workspaceState, setWorkspaceState] = useState<PersistedTaskWorkspaceState>(() =>
    createEmptyPersistedTaskWorkspaceState(workspaceId),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [isSyncLeader, setIsSyncLeader] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [drainToken, setDrainToken] = useState(0);
  const [recoveryToken, setRecoveryToken] = useState(0);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const tabIdRef = useRef(createOperationId());
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const recoveryInFlightRef = useRef(false);
  const workspaceStateRef = useRef(workspaceState);
  const sendingOpIdRef = useRef<string | null>(null);
  const persistTimerRef = useRef<number | null>(null);

  const projectedWorkspace = useMemo(() => projectTaskWorkspaceState(workspaceState, statusFilters), [statusFilters, workspaceState]);
  const projectedStateRef = useRef(projectedWorkspace.state);

  useEffect(() => {
    workspaceStateRef.current = workspaceState;
  }, [workspaceState]);

  useEffect(() => {
    projectedStateRef.current = projectedWorkspace.state;
  }, [projectedWorkspace.state]);

  const updateWorkspaceState = useCallback(
    (updater: (current: PersistedTaskWorkspaceState) => PersistedTaskWorkspaceState) => {
      setWorkspaceState((current) => {
        const nextState = updater(current);
        return nextWorkspaceState(nextState, {});
      });
    },
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleOnline = () => {
      setIsOnline(true);
      setDrainToken((current) => current + 1);
      setRecoveryToken((current) => current + 1);
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    if (!enabled) {
      setLoading(false);
      setConnected(false);
      setIsHydrated(false);
      return;
    }

    setLoading(true);
    setIsHydrated(false);

    void loadPersistedTaskWorkspaceState(workspaceId)
      .then((persistedState) => {
        if (disposed) {
          return;
        }

        setWorkspaceState(persistedState.workspaceId === workspaceId ? persistedState : createEmptyPersistedTaskWorkspaceState(workspaceId));
        setIsHydrated(true);
        setLoading(false);
      })
      .catch((loadError) => {
        if (disposed) {
          return;
        }

        setWorkspaceState(createEmptyPersistedTaskWorkspaceState(workspaceId));
        setError(loadError instanceof Error ? loadError.message : "读取本地任务缓存失败。")
        setIsHydrated(true);
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [enabled, workspaceId]);

  useEffect(() => {
    if (!enabled || !isHydrated) {
      return;
    }

    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = window.setTimeout(() => {
      void savePersistedTaskWorkspaceState(workspaceStateRef.current)
        .then(() => {
          notifyTaskWorkspacePersistence(workspaceId, tabIdRef.current);
        })
        .catch(() => undefined);
      persistTimerRef.current = null;
    }, 120);

    return () => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [enabled, isHydrated, workspaceId, workspaceState]);

  useEffect(() => {
    if (!enabled || !isHydrated) {
      return;
    }

    return subscribeTaskWorkspacePersistence(workspaceId, tabIdRef.current, () => {
      void loadPersistedTaskWorkspaceState(workspaceId).then((persistedState) => {
        setWorkspaceState((current) => {
          if (new Date(persistedState.updatedAt).getTime() <= new Date(current.updatedAt).getTime()) {
            return current;
          }
          return persistedState;
        });
      });
    });
  }, [enabled, isHydrated, workspaceId]);

  useEffect(() => {
    if (!enabled || !isHydrated) {
      setIsSyncLeader(false);
      return;
    }

    const evaluateLeadership = () => {
      const nextLeader = claimTaskSyncLeader(workspaceId, tabIdRef.current, LEADER_TTL_MS);
      setIsSyncLeader(nextLeader);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        evaluateLeadership();
      }
    };

    const releaseLeadership = () => {
      releaseTaskSyncLeader(workspaceId, tabIdRef.current);
    };

    evaluateLeadership();
    const interval = window.setInterval(evaluateLeadership, LEADER_HEARTBEAT_MS);
    const unsubscribeLeader = subscribeTaskSyncLeader(workspaceId, evaluateLeadership);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", releaseLeadership);

    return () => {
      window.clearInterval(interval);
      unsubscribeLeader();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", releaseLeadership);
      releaseLeadership();
      setIsSyncLeader(false);
    };
  }, [enabled, isHydrated, workspaceId]);

  const loadSnapshot = useCallback(async () => {
    if (!accessToken || !enabled || !isSyncLeader) {
      setLoading(false);
      return;
    }

    try {
      const hasLocalData =
        Boolean(workspaceStateRef.current.base.rootId) || workspaceStateRef.current.outbox.length > 0;
      if (!hasLocalData) {
        setLoading(true);
      }
      setError(null);
      const snapshot = await apiRequest<TaskSnapshotResponse>(`/workspaces/${workspaceId}/tasks/snapshot`, {
        token: accessToken,
      });
      updateWorkspaceState((current) => ({
        ...current,
        base: applySnapshotToTaskBase(current.base, snapshot),
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载实时任务快照失败。");
    } finally {
      setLoading(false);
    }
  }, [accessToken, enabled, isSyncLeader, updateWorkspaceState, workspaceId]);

  const reconcileState = useCallback(async () => {
    if (!accessToken || !enabled || !isSyncLeader) {
      setLoading(false);
      return;
    }

    if (!workspaceStateRef.current.base.rootId) {
      await loadSnapshot();
      return;
    }

    try {
      setError(null);
      const changes = await apiRequest<TaskChangesResponse>(
        `/workspaces/${workspaceId}/tasks/changes?since=${workspaceStateRef.current.base.syncSeq}`,
        {
          token: accessToken,
        },
      );

      if (changes.reset_required) {
        await loadSnapshot();
        return;
      }

      let gapDetected = false;
      updateWorkspaceState((current) => {
        const nextState = applyIncomingChangesets(current, changes.events);
        if (nextState === null) {
          gapDetected = true;
          return current;
        }
        return nextState;
      });

      if (gapDetected) {
        await loadSnapshot();
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "对账实时任务变更失败。");
      await loadSnapshot();
    } finally {
      setLoading(false);
    }
  }, [accessToken, enabled, isSyncLeader, loadSnapshot, updateWorkspaceState, workspaceId]);

  const refresh = useCallback(async () => {
    await reconcileState();
  }, [reconcileState]);

  useEffect(() => {
    refreshRef.current = loadSnapshot;
  }, [loadSnapshot]);

  useEffect(() => {
    if (!enabled || !isHydrated) {
      return;
    }

    if (!accessToken) {
      setConnected(false);
      setLoading(false);
      return;
    }

    if (!isSyncLeader) {
      setConnected(false);
      setLoading(false);
      return;
    }

    void refresh();
  }, [accessToken, enabled, isHydrated, isSyncLeader, refresh]);

  useEffect(() => {
    if (!enabled || !accessToken || !isHydrated || !isSyncLeader) {
      setConnected(false);
      return;
    }

    let disposed = false;
    let reconnectTimer: number | null = null;
    let socket: WebSocket | null = null;

    const requestRecovery = () => {
      setRecoveryToken((current) => current + 1);
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      socket = new WebSocket(createWebSocketUrl(workspaceId, accessToken, workspaceStateRef.current.base.syncSeq));
      socket.onopen = () => {
        setConnected(true);
      };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as TaskChangeset | TaskStreamReadyEvent;
          if ("type" in payload && payload.type === "ready") {
            if (payload.reset_required || payload.sync_seq < workspaceStateRef.current.base.syncSeq) {
              requestRecovery();
            }
            return;
          }

          const changeset = payload as TaskChangeset;
          let gapDetected = false;
          updateWorkspaceState((current) => {
            const nextState = applyIncomingChangesets(current, [changeset]);
            if (nextState === null) {
              gapDetected = true;
              return current;
            }
            return nextState;
          });
          if (gapDetected) {
            requestRecovery();
            return;
          }
          setError(null);
        } catch {
          setError("实时任务流解析失败。正在尝试恢复连接。");
          requestRecovery();
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
  }, [accessToken, enabled, isHydrated, isSyncLeader, updateWorkspaceState, workspaceId]);

  useEffect(() => {
    if (!recoveryToken || !isSyncLeader || recoveryInFlightRef.current) {
      return;
    }

    recoveryInFlightRef.current = true;
    void (refreshRef.current?.() ?? Promise.resolve()).finally(() => {
      recoveryInFlightRef.current = false;
    });
  }, [isSyncLeader, recoveryToken]);

  useEffect(() => {
    if (!enabled || !accessToken || !isHydrated || !isOnline || !isSyncLeader) {
      return;
    }

    if (sendingOpIdRef.current) {
      return;
    }

    const now = Date.now();
    const nextOperation = workspaceState.outbox.find((operation) => {
      if (operation.state === "failed") {
        return false;
      }
      if (operation.retryAt > now) {
        return false;
      }
      return buildRequestFromOperation(workspaceStateRef.current.base, projectedStateRef.current, operation) !== null;
    });

    const nextRetryAt = workspaceState.outbox
      .filter((operation) => operation.state !== "failed" && operation.retryAt > now)
      .reduce<number | null>((closest, operation) => {
        if (closest === null || operation.retryAt < closest) {
          return operation.retryAt;
        }
        return closest;
      }, null);

    if (!nextOperation) {
      if (nextRetryAt !== null) {
        const timer = window.setTimeout(() => {
          setDrainToken((current) => current + 1);
        }, Math.max(60, nextRetryAt - now));
        return () => window.clearTimeout(timer);
      }
      return;
    }

    const requestBody = buildRequestFromOperation(workspaceStateRef.current.base, projectedStateRef.current, nextOperation);
    if (!requestBody) {
      return;
    }

    sendingOpIdRef.current = nextOperation.op_id;
    updateWorkspaceState((current) => ({
      ...current,
      outbox: current.outbox.map((operation) =>
        operation.op_id === nextOperation.op_id ? { ...operation, error: null, state: "sending" } : operation,
      ),
    }));

    void apiRequest<TaskChangeset>(`/workspaces/${workspaceId}/tasks/ops`, {
      json: requestBody,
      method: "POST",
      token: accessToken,
    })
      .then((changeset) => {
        updateWorkspaceState((current) => ({
          ...current,
          base: applyChangesetToTaskBase(current.base, changeset),
          outbox: current.outbox.filter((operation) => operation.op_id !== nextOperation.op_id),
        }));
        setError(null);
      })
      .catch((submitError) => {
        updateWorkspaceState((current) => ({
          ...current,
          outbox: current.outbox.map((operation) => {
            if (operation.op_id !== nextOperation.op_id) {
              return operation;
            }

            const attemptCount = operation.attemptCount + 1;
            const retryable = isRetryableError(submitError);
            const nextState = isConflictError(submitError)
              ? "conflict"
              : retryable
                ? "queued"
                : "failed";
            return {
              ...operation,
              attemptCount,
              error: submitError instanceof Error ? submitError.message : "同步任务操作失败。",
              retryAt: retryable ? Date.now() + retryDelay(attemptCount) : 0,
              state: nextState,
            };
          }),
        }));
        setError(submitError instanceof Error ? submitError.message : "同步任务操作失败。")
      })
      .finally(() => {
        sendingOpIdRef.current = null;
        setDrainToken((current) => current + 1);
      });
  }, [accessToken, drainToken, enabled, isHydrated, isOnline, isSyncLeader, updateWorkspaceState, workspaceId, workspaceState]);

  const createTask = useCallback(async (parentId: string, title = "新节点") => {
    const parentTask = projectedStateRef.current.tasksById[parentId];
    if (!parentTask) {
      return null;
    }

    const clientId = createTemporaryTaskId();
    const opId = createOperationId();

    updateWorkspaceState((current) => ({
      ...current,
      outbox: [
        ...current.outbox,
        {
          ...createOperationBase(opId),
          assignee_user_id: null,
          base_sync_seq: current.base.syncSeq,
          client_id: clientId,
          content_markdown: "",
          parent_id: parentId,
          planned_due_at: null,
          title,
          type: "create_task",
          weight: 0,
        } satisfies CreateTaskOperation,
      ],
    }));

    return clientId;
  }, [updateWorkspaceState]);

  const patchTask = useCallback(async (taskId: string, patch: TaskPatchFields) => {
    if (!hasPatchFields(patch)) {
      return;
    }

    updateWorkspaceState((current) => {
      const pendingCreate = findPendingCreateOperation(current.outbox, taskId);
      const nextOutbox = [...current.outbox];
      const remainingPatch = { ...patch };

      if (pendingCreate) {
        const createIndex = findOperationIndex(nextOutbox, pendingCreate.op_id);
        const createPatch = sanitizePatchForPendingCreate(remainingPatch);
        if (hasPatchFields(createPatch)) {
          nextOutbox[createIndex] = mergePatchIntoCreate(pendingCreate, createPatch);
          delete remainingPatch.assignee_user_id;
          delete remainingPatch.content_markdown;
          delete remainingPatch.planned_due_at;
          delete remainingPatch.title;
          delete remainingPatch.weight;
        }
      }

      if (!hasPatchFields(remainingPatch)) {
        return {
          ...current,
          outbox: nextOutbox,
        };
      }

      const patchIndex = [...nextOutbox]
        .reverse()
        .findIndex((operation) => operation.type === "patch_task" && operation.task_id === taskId && operation.state !== "sending");

      if (patchIndex !== -1) {
        const resolvedIndex = nextOutbox.length - patchIndex - 1;
        const operation = nextOutbox[resolvedIndex] as PatchTaskOperation;
        const baseTask = current.base.tasksById[taskId];
        nextOutbox[resolvedIndex] = {
          ...operation,
          base_meta_revision: baseTask?.meta_revision ?? operation.base_meta_revision,
          base_sync_seq: current.base.syncSeq,
          error: null,
          patch: {
            ...operation.patch,
            ...remainingPatch,
          },
          retryAt: 0,
          state: "queued",
        };
      } else {
        const baseTask = current.base.tasksById[taskId];
        nextOutbox.push({
          ...createOperationBase(createOperationId()),
          base_meta_revision: baseTask?.meta_revision ?? null,
          base_sync_seq: current.base.syncSeq,
          patch: remainingPatch,
          task_id: taskId,
          type: "patch_task",
        });
      }

      return {
        ...current,
        outbox: nextOutbox,
      };
    });
  }, [updateWorkspaceState]);

  const setTaskStatus = useCallback(async (taskId: string, status: TaskStatus, remark?: string | null) => {
    updateWorkspaceState((current) => {
      const nextOutbox = [...current.outbox];
      const statusIndex = [...nextOutbox]
        .reverse()
        .findIndex((operation) => operation.type === "set_status" && operation.task_id === taskId && operation.state !== "sending");

      if (statusIndex !== -1) {
        const resolvedIndex = nextOutbox.length - statusIndex - 1;
        const operation = nextOutbox[resolvedIndex] as SetStatusOperation;
        const baseTask = current.base.tasksById[taskId];
        nextOutbox[resolvedIndex] = {
          ...operation,
          base_meta_revision: baseTask?.meta_revision ?? operation.base_meta_revision,
          base_sync_seq: current.base.syncSeq,
          error: null,
          remark: remark ?? null,
          retryAt: 0,
          state: "queued",
          status,
        };
      } else {
        const baseTask = current.base.tasksById[taskId];
        nextOutbox.push({
          ...createOperationBase(createOperationId()),
          base_meta_revision: baseTask?.meta_revision ?? null,
          base_sync_seq: current.base.syncSeq,
          remark: remark ?? null,
          status,
          task_id: taskId,
          type: "set_status",
        });
      }

      return {
        ...current,
        outbox: nextOutbox,
      };
    });
  }, [updateWorkspaceState]);

  const deleteTask = useCallback(async (taskId: string) => {
    updateWorkspaceState((current) => {
      const projectedState = projectTaskWorkspaceState(current, []).state;
      const deleteIds = buildDeleteSubtreeIds(projectedState, taskId);
      const nextOutbox: LocalTaskOperation[] = [];

      for (const operation of current.outbox) {
        if (operation.type === "create_task" && deleteIds.has(operation.client_id)) {
          continue;
        }
        if ((operation.type === "patch_task" || operation.type === "set_status" || operation.type === "delete_task") && deleteIds.has(operation.task_id)) {
          continue;
        }
        if (operation.type === "reorder_tasks") {
          if (deleteIds.has(operation.parent_id) || operation.task_ids.some((childId) => deleteIds.has(childId))) {
            continue;
          }
        }
        nextOutbox.push(operation);
      }

      const hasServerId = Boolean(resolveServerTaskId(projectedState, taskId));
      if (hasServerId) {
        const baseTask = current.base.tasksById[taskId];
        nextOutbox.push({
          ...createOperationBase(createOperationId()),
          base_meta_revision: baseTask?.meta_revision ?? null,
          base_sync_seq: current.base.syncSeq,
          task_id: taskId,
          type: "delete_task",
        } satisfies DeleteTaskOperation);
      }

      return {
        ...current,
        outbox: nextOutbox,
      };
    });
  }, [updateWorkspaceState]);

  const reorderTasks = useCallback(async (parentId: string, orderedTaskIds: string[]) => {
    updateWorkspaceState((current) => {
      const parentTask = current.base.tasksById[parentId];
      const nextOutbox = current.outbox.filter(
        (operation) => !(operation.type === "reorder_tasks" && operation.parent_id === parentId && operation.state !== "sending"),
      );
      nextOutbox.push({
        ...createOperationBase(createOperationId()),
        base_meta_revision: parentTask?.meta_revision ?? null,
        base_sync_seq: current.base.syncSeq,
        parent_id: parentId,
        task_ids: [...orderedTaskIds],
        type: "reorder_tasks",
      } satisfies ReorderTasksOperation);

      return {
        ...current,
        outbox: nextOutbox,
      };
    });
  }, [updateWorkspaceState]);

  const bulkSetStatus = useCallback(async (taskIds: string[], status: TaskStatus, remark?: string | null) => {
    updateWorkspaceState((current) => {
      const nextOutbox = [...current.outbox];

      taskIds.forEach((taskId) => {
        const existingIndex = [...nextOutbox]
          .reverse()
          .findIndex((operation) => operation.type === "set_status" && operation.task_id === taskId && operation.state !== "sending");
        if (existingIndex !== -1) {
          const resolvedIndex = nextOutbox.length - existingIndex - 1;
          const operation = nextOutbox[resolvedIndex] as SetStatusOperation;
          const baseTask = current.base.tasksById[taskId];
          nextOutbox[resolvedIndex] = {
            ...operation,
            base_meta_revision: baseTask?.meta_revision ?? operation.base_meta_revision,
            base_sync_seq: current.base.syncSeq,
            error: null,
            remark: remark ?? null,
            retryAt: 0,
            state: "queued",
            status,
          };
          return;
        }

        nextOutbox.push({
          ...createOperationBase(createOperationId()),
          base_meta_revision: current.base.tasksById[taskId]?.meta_revision ?? null,
          base_sync_seq: current.base.syncSeq,
          remark: remark ?? null,
          status,
          task_id: taskId,
          type: "set_status",
        });
      });

      return {
        ...current,
        outbox: nextOutbox,
      };
    });
  }, [updateWorkspaceState]);

  const bulkDeleteTasks = useCallback(async (taskIds: string[]) => {
    updateWorkspaceState((current) => {
      let nextState = current;
      taskIds.forEach((taskId) => {
        const projectedState = projectTaskWorkspaceState(nextState, []).state;
        const deleteIds = buildDeleteSubtreeIds(projectedState, taskId);
        const filteredOutbox = nextState.outbox.filter((operation) => {
          if (operation.type === "create_task" && deleteIds.has(operation.client_id)) {
            return false;
          }
          if ((operation.type === "patch_task" || operation.type === "set_status" || operation.type === "delete_task") && deleteIds.has(operation.task_id)) {
            return false;
          }
          if (operation.type === "reorder_tasks") {
            if (deleteIds.has(operation.parent_id) || operation.task_ids.some((childId) => deleteIds.has(childId))) {
              return false;
            }
          }
          return true;
        });

        const hasServerId = Boolean(resolveServerTaskId(projectedState, taskId));
        nextState = {
          ...nextState,
          outbox: hasServerId
            ? [
                ...filteredOutbox,
                {
                  ...createOperationBase(createOperationId()),
                  base_meta_revision: nextState.base.tasksById[taskId]?.meta_revision ?? null,
                  base_sync_seq: nextState.base.syncSeq,
                  task_id: taskId,
                  type: "delete_task",
                } satisfies DeleteTaskOperation,
              ]
            : filteredOutbox,
        };
      });

      return nextState;
    });
  }, [updateWorkspaceState]);

  const retryTaskSync = useCallback(async (taskId: string) => {
    updateWorkspaceState((current) => {
      const projectedState = projectTaskWorkspaceState(current, []).state;
      const relatedTaskIds = buildDeleteSubtreeIds(projectedState, taskId);

      return {
        ...current,
        outbox: current.outbox.map((operation) => {
          if (operation.state !== "failed" && operation.state !== "conflict") {
            return operation;
          }

          if (!getOperationTaskIds(operation).some((candidateTaskId) => relatedTaskIds.has(candidateTaskId))) {
            return operation;
          }

          return refreshOperationForRetry(current, operation);
        }),
      };
    });
    setError(null);
    setDrainToken((current) => current + 1);
  }, [updateWorkspaceState]);

  const discardTaskChanges = useCallback(async (taskId: string) => {
    updateWorkspaceState((current) => {
      const projectedState = projectTaskWorkspaceState(current, []).state;
      const relatedTaskIds = buildDeleteSubtreeIds(projectedState, taskId);

      return {
        ...current,
        outbox: current.outbox.filter(
          (operation) => !getOperationTaskIds(operation).some((candidateTaskId) => relatedTaskIds.has(candidateTaskId)),
        ),
      };
    });
    setError(null);
    setDrainToken((current) => current + 1);
  }, [updateWorkspaceState]);

  return {
    bulkDeleteTasks,
    bulkSetStatus,
    connected,
    createTask,
    discardTaskChanges,
    deleteTask,
    error,
    isSyncLeader,
    loading,
    patchTask,
    refresh,
    reorderTasks,
    rootTask: projectedWorkspace.rootTask,
    retryTaskSync,
    setTaskStatus,
    syncSeq: workspaceState.base.syncSeq,
  };
}
