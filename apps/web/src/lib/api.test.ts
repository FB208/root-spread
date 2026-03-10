import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearSession, saveSession } from "@/lib/auth-storage";
import { apiRequest, type AuthSession } from "@/lib/api";

function createSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    access_token: "old-token",
    refresh_token: "refresh-token",
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

describe("apiRequest auth refresh", () => {
  beforeEach(() => {
    clearSession();
    vi.restoreAllMocks();
  });

  it("retries protected request after refreshing expired access token", async () => {
    saveSession(createSession());
    const fetchMock = vi.spyOn(global, "fetch");

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "token expired" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            createSession({
              access_token: "new-token",
              refresh_token: "new-refresh-token",
            }),
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const response = await apiRequest<{ ok: boolean }>("/workspaces", {
      token: "old-token",
    });

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/workspaces"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer new-token",
        }),
      }),
    );
  });
});
