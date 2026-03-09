import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceStatsDashboard } from "@/components/workspace-stats-dashboard";
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

describe("WorkspaceStatsDashboard", () => {
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

  it("loads workspace stats and audit logs", async () => {
    mockedApiRequest
      .mockResolvedValueOnce({
        workspace_id: "ws-1",
        active_task_count: 8,
        archived_task_count: 3,
        member_count: 4,
        pending_invitation_count: 1,
        milestone_count: 2,
        completed_task_count: 2,
        pending_review_task_count: 1,
        terminated_task_count: 0,
        in_progress_task_count: 5,
        recent_activity_count: 9,
      })
      .mockResolvedValueOnce([
        {
          id: "log-1",
          workspace_id: "ws-1",
          actor_user_id: "user-1",
          entity_type: "task",
          entity_id: "task-1",
          action: "task_created",
          message: "创建任务：Task A",
          metadata_json: null,
          created_at: "2026-03-09T10:00:00Z",
          updated_at: "2026-03-09T10:00:00Z",
        },
      ]);

    render(<WorkspaceStatsDashboard workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText("工作空间统计入口")).toBeInTheDocument();
    });

    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("创建任务：Task A")).toBeInTheDocument();
  });
});
