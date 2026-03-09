import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskDetailPanel } from "@/components/task-detail-panel";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiRequest: vi.fn(),
  };
});

vi.mock("@/lib/auth-storage", () => ({
  getStoredSession: vi.fn(() => null),
}));

describe("TaskDetailPanel", () => {
  it("shows empty state when no task is selected", () => {
    render(
      <TaskDetailPanel
        members={[]}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        readOnly={false}
        task={null}
        workspaceId="ws-1"
        workspaceRole="owner"
      />,
    );

    expect(screen.getByText("节点详情侧栏")).toBeInTheDocument();
    expect(screen.getByText(/点击思维导图中的任意节点后/)).toBeInTheDocument();
  });

  it("disables editing in read-only history mode", () => {
    render(
      <TaskDetailPanel
        members={[]}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        readOnly
        task={{
          id: "task-1",
          workspace_id: "ws-1",
          parent_id: null,
          root_id: "task-1",
          path: "task-1",
          depth: 0,
          sort_order: 0,
          title: "历史任务",
          content_markdown: "内容",
          created_by_user_id: "user-1",
          assignee_user_id: null,
          planned_due_at: null,
          completed_at: null,
          archived_at: null,
          archived_by_milestone_id: null,
          weight: 10,
          score: 8,
          status: "completed",
          created_at: "2026-03-09T00:00:00Z",
          updated_at: "2026-03-09T00:00:00Z",
          matched_filter: true,
          children: [],
        }}
        workspaceId="ws-1"
        workspaceRole="owner"
      />,
    );

    expect(screen.getByText("历史只读")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存节点详情" })).toBeDisabled();
  });
});
