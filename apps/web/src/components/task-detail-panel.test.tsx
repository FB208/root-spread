import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskDetailPanel } from "@/components/task-detail-panel";

vi.mock("@/components/task-document-editor", () => ({
  TaskDocumentEditor: () => <div data-testid="task-document-editor" />,
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiRequest: vi.fn(),
  };
});

describe("TaskDetailPanel", () => {
  it("shows empty state when no task is selected", () => {
    render(
      <TaskDetailPanel
        accessToken="token"
        members={[]}
        onDeleteTask={vi.fn().mockResolvedValue(undefined)}
        onPatchTask={vi.fn().mockResolvedValue(undefined)}
        onSetTaskStatus={vi.fn().mockResolvedValue(undefined)}
        readOnly={false}
        task={null}
        userName="Tester"
        workspaceId="ws-1"
        workspaceRole="owner"
      />,
    );

    expect(screen.getByText("节点详情")).toBeInTheDocument();
    expect(screen.getByText(/快捷键：`Tab` 新建下级/)).toBeInTheDocument();
  });

  it("disables editing in read-only history mode", () => {
    render(
      <TaskDetailPanel
        accessToken="token"
        members={[]}
        onDeleteTask={vi.fn().mockResolvedValue(undefined)}
        onPatchTask={vi.fn().mockResolvedValue(undefined)}
        onSetTaskStatus={vi.fn().mockResolvedValue(undefined)}
        readOnly
        task={{
          id: "task-1",
          workspace_id: "ws-1",
          parent_id: null,
          root_id: "task-1",
          path: "task-1",
          depth: 0,
          sort_order: 0,
          meta_revision: 1,
          title: "历史任务",
          content_markdown: "内容",
          node_kind: "task",
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
        userName="Tester"
        workspaceId="ws-1"
        workspaceRole="owner"
      />,
    );

    expect(screen.getByText("历史只读")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存节点属性" })).toBeDisabled();
    expect(screen.getByTestId("task-document-editor")).toBeInTheDocument();
  });
});
