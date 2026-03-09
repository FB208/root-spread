import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceMembersPanel } from "@/components/workspace-members-panel";
import { apiRequest } from "@/lib/api";
import { getStoredSession } from "@/lib/auth-storage";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiRequest: vi.fn(),
  };
});

vi.mock("@/lib/auth-storage", () => ({
  getStoredSession: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);
const mockedGetStoredSession = vi.mocked(getStoredSession);

describe("WorkspaceMembersPanel", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
    mockedGetStoredSession.mockReturnValue({
      access_token: "token",
      refresh_token: "refresh",
      token_type: "bearer",
      expires_in: 3600,
      user: {
        id: "user-1",
        email: "owner@example.com",
        display_name: "Owner",
        avatar_url: null,
        email_verified_at: "2026-01-01T00:00:00Z",
        status: "active",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    });
  });

  it("renders invitation states and can revoke invitation", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    mockedApiRequest.mockResolvedValueOnce({ message: "邀请已撤销。" });

    render(
      <WorkspaceMembersPanel
        invitations={[
          {
            id: "invite-1",
            workspace_id: "ws-1",
            email: "pending@example.com",
            role: "member",
            invited_by_user_id: "user-1",
            expires_at: "2026-03-10T10:00:00Z",
            accepted_at: null,
            revoked_at: null,
            created_at: "2026-03-09T10:00:00Z",
            updated_at: "2026-03-09T10:00:00Z",
          },
          {
            id: "invite-2",
            workspace_id: "ws-1",
            email: "accepted@example.com",
            role: "admin",
            invited_by_user_id: "user-1",
            expires_at: "2026-03-10T10:00:00Z",
            accepted_at: "2026-03-09T12:00:00Z",
            revoked_at: null,
            created_at: "2026-03-09T09:00:00Z",
            updated_at: "2026-03-09T12:00:00Z",
          },
        ]}
        members={[]}
        onRefresh={onRefresh}
        workspaceId="ws-1"
        workspaceRole="owner"
      />,
    );

    expect(screen.getByText("pending@example.com")).toBeInTheDocument();
    expect(screen.getByText("待接受")).toBeInTheDocument();
    expect(screen.getByText("已接受")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "撤销邀请" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith("/workspaces/ws-1/invitations/invite-1", {
        method: "DELETE",
        token: "token",
      });
    });
    expect(onRefresh).toHaveBeenCalled();
  });
});
