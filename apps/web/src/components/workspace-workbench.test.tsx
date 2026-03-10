import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceWorkbench } from "@/components/workspace-workbench";
import { useTaskSync } from "@/lib/task-sync";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/workspaces/ws-1"),
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
  useSearchParams: vi.fn(() => ({ get: vi.fn(() => null), toString: vi.fn(() => "") })),
}));

vi.mock("@/components/workspace-context", () => ({
  useWorkspaceContext: vi.fn(() => ({
    accessToken: "token",
    members: [],
    milestones: [],
    session: {
      user: {
        display_name: "Tester",
      },
    },
    workspace: {
      id: "ws-1",
      name: "Workspace One",
      slug: "workspace-one",
      role: "owner",
      created_at: "2026-03-10T00:00:00Z",
      updated_at: "2026-03-10T00:00:00Z",
    },
  })),
}));

vi.mock("@/components/task-detail-panel", () => ({
  TaskDetailPanel: () => <aside data-testid="task-detail-panel" />,
}));

vi.mock("@/components/task-mindmap", () => ({
  TaskMindmap: () => <div data-testid="task-mindmap" />,
}));

vi.mock("@/lib/task-sync", () => ({
  useTaskSync: vi.fn(),
}));

const mockedUseTaskSync = vi.mocked(useTaskSync);

function createTask(index: number) {
  return {
    id: `task-${index}`,
    workspace_id: "ws-1",
    parent_id: "root-1",
    root_id: "root-1",
    path: `root-1/task-${index}`,
    depth: 1,
    sort_order: index,
    meta_revision: 1,
    title: `任务 ${index}`,
    content_markdown: "",
    node_kind: "task" as const,
    created_by_user_id: "user-1",
    assignee_user_id: null,
    planned_due_at: null,
    completed_at: null,
    archived_at: null,
    archived_by_milestone_id: null,
    weight: index,
    score: null,
    status: "in_progress" as const,
    created_at: "2026-03-10T00:00:00Z",
    updated_at: "2026-03-10T00:00:00Z",
    matched_filter: true,
    children: [],
  };
}

function createRoot(children: ReturnType<typeof createTask>[]) {
  return {
    id: "root-1",
    workspace_id: "ws-1",
    parent_id: null,
    root_id: "root-1",
    path: "root-1",
    depth: 0,
    sort_order: 0,
    meta_revision: 1,
    title: "根节点",
    content_markdown: "",
    node_kind: "system_root" as const,
    created_by_user_id: "user-1",
    assignee_user_id: null,
    planned_due_at: null,
    completed_at: null,
    archived_at: null,
    archived_by_milestone_id: null,
    weight: 0,
    score: null,
    status: "in_progress" as const,
    created_at: "2026-03-10T00:00:00Z",
    updated_at: "2026-03-10T00:00:00Z",
    matched_filter: true,
    children,
  };
}

describe("WorkspaceWorkbench", () => {
  beforeEach(() => {
    mockedUseTaskSync.mockReset();
    mockedUseTaskSync.mockReturnValue({
      bulkDeleteTasks: vi.fn().mockResolvedValue(undefined),
      bulkSetStatus: vi.fn().mockResolvedValue(undefined),
      connected: true,
      createTask: vi.fn().mockResolvedValue(null),
      deleteTask: vi.fn().mockResolvedValue(undefined),
      error: null,
      loading: false,
      patchTask: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      reorderTasks: vi.fn().mockResolvedValue(undefined),
      rootTask: createRoot(Array.from({ length: 50 }, (_, index) => createTask(index))),
      setTaskStatus: vi.fn().mockResolvedValue(undefined),
      syncSeq: 1,
    });
  });

  it("virtualizes large task tables and updates rendered rows on scroll", async () => {
    render(<WorkspaceWorkbench workspaceId="ws-1" />);

    await userEvent.click(screen.getByRole("button", { name: "表格" }));

    const viewport = screen.getByTestId("task-table-viewport");

    expect(screen.getByText("窗口化渲染已启用，滚动时只绘制可视区附近行")).toBeInTheDocument();
    expect(within(viewport).getByText("任务 0")).toBeInTheDocument();
    expect(within(viewport).queryByText("任务 30")).not.toBeInTheDocument();

    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      value: 2040,
      writable: true,
    });
    fireEvent.scroll(viewport);

    expect(within(viewport).getByText("任务 30")).toBeInTheDocument();
    expect(within(viewport).queryByText("任务 0")).not.toBeInTheDocument();
  });
});
