import { API_BASE_URL, ApiError, type AuthSession } from "@/lib/api";

const STORAGE_KEY = "rootspread.auth.session";
const EXPIRY_BUFFER_MS = 60_000;

let pendingRefresh: Promise<AuthSession | null> | null = null;

function isBrowser() {
  return typeof window !== "undefined";
}

function normalizeSession(session: AuthSession, now = Date.now()): AuthSession {
  if (session.expires_at) {
    return session;
  }

  return {
    ...session,
    expires_at: new Date(now + session.expires_in * 1000).toISOString(),
  };
}

function isSessionExpiringSoon(session: AuthSession, now = Date.now()) {
  if (!session.expires_at) {
    return false;
  }

  return new Date(session.expires_at).getTime() <= now + EXPIRY_BUFFER_MS;
}

export function getStoredSession(): AuthSession | null {
  if (!isBrowser()) {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return normalizeSession(JSON.parse(raw) as AuthSession);
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveSession(session: AuthSession) {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSession(session)));
}

export function clearSession() {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}

export async function refreshStoredSession(): Promise<AuthSession | null> {
  const session = getStoredSession();
  if (!session?.refresh_token) {
    return null;
  }

  if (pendingRefresh) {
    return pendingRefresh;
  }

  pendingRefresh = (async () => {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });

    const isJson = response.headers.get("content-type")?.includes("application/json");
    const payload = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      if (response.status === 401) {
        clearSession();
        return null;
      }

      const message =
        typeof payload === "object" && payload !== null && "detail" in payload
          ? String(payload.detail)
          : "刷新登录状态失败。";
      throw new ApiError(message, response.status);
    }

    const nextSession = normalizeSession(payload as AuthSession);
    saveSession(nextSession);
    return nextSession;
  })().finally(() => {
    pendingRefresh = null;
  });

  return pendingRefresh;
}

export async function getCachedSession(): Promise<AuthSession | null> {
  const session = getStoredSession();
  if (!session) {
    return null;
  }

  if (!isSessionExpiringSoon(session)) {
    return session;
  }

  return refreshStoredSession();
}
