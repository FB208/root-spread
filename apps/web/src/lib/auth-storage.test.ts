import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearSession, getCachedSession, getStoredSession, saveSession } from "@/lib/auth-storage";
import type { AuthSession } from "@/lib/api";

function createSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    access_token: "token-1",
    refresh_token: "refresh-1",
    token_type: "bearer",
    expires_in: 3600,
    user: {
      id: "user-1",
      email: "user@example.com",
      display_name: "Tester",
      avatar_url: null,
      email_verified_at: "2026-03-10T00:00:00Z",
      status: "active",
      created_at: "2026-03-10T00:00:00Z",
      updated_at: "2026-03-10T00:00:00Z",
    },
    ...overrides,
  };
}

describe("auth-storage", () => {
  beforeEach(() => {
    clearSession();
    vi.restoreAllMocks();
  });

  it("persists session with computed expires_at", () => {
    saveSession(createSession());

    const stored = getStoredSession();

    expect(stored?.access_token).toBe("token-1");
    expect(stored?.expires_at).toBeTruthy();
  });

  it("refreshes cached session when access token is about to expire", async () => {
    saveSession(
      createSession({
        access_token: "token-expired",
        expires_at: new Date(Date.now() + 5_000).toISOString(),
      }),
    );

    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          createSession({
            access_token: "token-2",
            refresh_token: "refresh-2",
          }),
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const refreshed = await getCachedSession();

    expect(refreshed?.access_token).toBe("token-2");
    expect(getStoredSession()?.refresh_token).toBe("refresh-2");
  });
});
