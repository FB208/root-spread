import { createEmptyPersistedTaskWorkspaceState, type PersistedTaskWorkspaceState } from "@/lib/task-sync-local";

const DB_NAME = "rootspread-task-sync";
const DB_VERSION = 1;
const WORKSPACE_STORE = "workspaces";
const CHANNEL_NAME = "rootspread-task-sync";
const LEADER_KEY_PREFIX = "rootspread-task-sync-leader:";

const memoryStore = new Map<string, PersistedTaskWorkspaceState>();

function canUseIndexedDb() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function canUseBroadcastChannel() {
  return typeof window !== "undefined" && typeof window.BroadcastChannel !== "undefined";
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

type TaskSyncLeaderRecord = {
  expiresAt: number;
  tabId: string;
};

function leaderStorageKey(workspaceId: string) {
  return `${LEADER_KEY_PREFIX}${workspaceId}`;
}

function readLeaderRecord(workspaceId: string): TaskSyncLeaderRecord | null {
  if (!canUseLocalStorage()) {
    return null;
  }

  const rawValue = window.localStorage.getItem(leaderStorageKey(workspaceId));
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as TaskSyncLeaderRecord;
    if (!parsed || typeof parsed.tabId !== "string" || typeof parsed.expiresAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeLeaderRecord(workspaceId: string, record: TaskSyncLeaderRecord) {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(leaderStorageKey(workspaceId), JSON.stringify(record));
}

export function claimTaskSyncLeader(workspaceId: string, tabId: string, ttlMs: number) {
  if (!canUseLocalStorage()) {
    return true;
  }

  const now = Date.now();
  const currentLeader = readLeaderRecord(workspaceId);
  if (currentLeader && currentLeader.tabId !== tabId && currentLeader.expiresAt > now) {
    return false;
  }

  const nextLeader = {
    expiresAt: now + ttlMs,
    tabId,
  } satisfies TaskSyncLeaderRecord;
  writeLeaderRecord(workspaceId, nextLeader);
  return readLeaderRecord(workspaceId)?.tabId === tabId;
}

export function releaseTaskSyncLeader(workspaceId: string, tabId: string) {
  if (!canUseLocalStorage()) {
    return;
  }

  const currentLeader = readLeaderRecord(workspaceId);
  if (currentLeader?.tabId === tabId) {
    window.localStorage.removeItem(leaderStorageKey(workspaceId));
  }
}

export function readTaskSyncLeader(workspaceId: string) {
  return readLeaderRecord(workspaceId);
}

export function subscribeTaskSyncLeader(workspaceId: string, callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === leaderStorageKey(workspaceId)) {
      callback();
    }
  };

  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener("storage", handleStorage);
  };
}

async function openDatabase() {
  if (!canUseIndexedDb()) {
    return null;
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error ?? new Error("打开任务同步数据库失败。"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE, { keyPath: "workspaceId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function loadPersistedTaskWorkspaceState(workspaceId: string) {
  const memoryState = memoryStore.get(workspaceId);
  if (memoryState) {
    return memoryState;
  }

  const database = await openDatabase();
  if (!database) {
    return createEmptyPersistedTaskWorkspaceState(workspaceId);
  }

  return new Promise<PersistedTaskWorkspaceState>((resolve, reject) => {
    const transaction = database.transaction(WORKSPACE_STORE, "readonly");
    const store = transaction.objectStore(WORKSPACE_STORE);
    const request = store.get(workspaceId);

    request.onerror = () => reject(request.error ?? new Error("读取任务同步缓存失败。"));
    request.onsuccess = () => {
      const state = (request.result as PersistedTaskWorkspaceState | undefined) ?? createEmptyPersistedTaskWorkspaceState(workspaceId);
      memoryStore.set(workspaceId, state);
      resolve(state);
    };

    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error("读取任务同步缓存失败。"));
  });
}

export async function savePersistedTaskWorkspaceState(state: PersistedTaskWorkspaceState) {
  memoryStore.set(state.workspaceId, state);

  const database = await openDatabase();
  if (!database) {
    return;
  }

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(WORKSPACE_STORE, "readwrite");
    transaction.objectStore(WORKSPACE_STORE).put(state);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("写入任务同步缓存失败。"));
  });
}

export function subscribeTaskWorkspacePersistence(workspaceId: string, senderId: string, callback: () => void) {
  if (!canUseBroadcastChannel()) {
    return () => undefined;
  }

  const channel = new window.BroadcastChannel(CHANNEL_NAME);
  const handler = (event: MessageEvent<{ senderId: string; workspaceId: string }>) => {
    if (event.data?.workspaceId === workspaceId && event.data.senderId !== senderId) {
      callback();
    }
  };

  channel.addEventListener("message", handler);
  return () => {
    channel.removeEventListener("message", handler);
    channel.close();
  };
}

export function notifyTaskWorkspacePersistence(workspaceId: string, senderId: string) {
  if (!canUseBroadcastChannel()) {
    return;
  }

  const channel = new window.BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({ senderId, workspaceId });
  channel.close();
}
