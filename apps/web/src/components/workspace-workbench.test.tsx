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
  TaskMindmap: ({
    detailVisible,
    editingTaskId,
    selectedTaskId,
    fitViewToken,
    onCreateChild,
    onCollapseAll,
    onExpandAll,
    onToggleDetailVisibility,
  }: {
    detailVisible: boolean;
    editingTaskId: string | null;
    fitViewToken: number;
    onCreateChild: (taskId: string) => void;
    onCollapseAll: () => void;
    onExpandAll: () => void;
    selectedTaskId: string | null;
    onToggleDetailVisibility: () => void;
  }) => (
    <div data-testid="task-mindmap">
      <span>{detailVisible ? "详情已显示" : "详情已隐藏"}</span>
      <span data-testid="selected-task-id">{selectedTaskId ?? ""}</span>
      <span data-testid="editing-task-id">{editingTaskId ?? ""}</span>
      <span data-testid="fit-view-token">{fitViewToken}</span>
      <button onClick={() => onCreateChild("root-1")} type="button">
        创建子节点
      </button>
      <button onClick={onExpandAll} type="button">
        展开全部
      </button>
      <button onClick={onCollapseAll} type="button">
        折叠全部
      </button>
      <button onClick={onToggleDetailVisibility} type="button">
        {detailVisible ? "收起详情" : "显示详情"}
      </button>
    </div>
  ),
}));

vi.mock("@/lib/task-sync", () => ({
  useTaskSync: vi.fn(),
}));

const mockedUseTaskSync = vi.mocked(useTaskSync);
let currentRootTask = createRoot(Array.from({ length: 50 }, (_, index) => createTask(index)));
const createTaskMock = vi.fn().mockResolvedValue(null);

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
    currentRootTask = createRoot(Array.from({ length: 50 }, (_, index) => createTask(index)));
    createTaskMock.mockReset();
    createTaskMock.mockResolvedValue(null);
    mockedUseTaskSync.mockImplementation(() => ({
      bulkDeleteTasks: vi.fn().mockResolvedValue(undefined),
      bulkSetStatus: vi.fn().mockResolvedValue(undefined),
      connected: true,
      createTask: createTaskMock,
      discardTaskChanges: vi.fn().mockResolvedValue(undefined),
      deleteTask: vi.fn().mockResolvedValue(undefined),
      error: null,
      isSyncLeader: true,
      loading: false,
      patchTask: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      reorderTasks: vi.fn().mockResolvedValue(undefined),
      retryTaskSync: vi.fn().mockResolvedValue(undefined),
      rootTask: currentRootTask,
      setTaskStatus: vi.fn().mockResolvedValue(undefined),
      syncSeq: 1,
    }));
  });

  it("virtualizes large task tables and updates rendered rows on scroll", async () => {
    render(<WorkspaceWorkbench workspaceId="ws-1" />);

    await userEvent.click(screen.getByRole("button", { name: "表格" }));

    const viewport = screen.getByTestId("task-table-viewport");

    expect(screen.getByText("窗口化渲染已启用")).toBeInTheDocument();
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

  it("keeps expand collapse controls in the mindmap toolbar and toggles tree detail panel", async () => {
    render(<WorkspaceWorkbench workspaceId="ws-1" />);

    expect(screen.queryByRole("button", { name: "全展开" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "折叠子树" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开全部" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "折叠全部" })).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-panel")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "收起详情" }));

    expect(screen.queryByTestId("task-detail-panel")).not.toBeInTheDocument();
    expect(screen.getByText("详情已隐藏")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "显示详情" }));

    expect(screen.getByTestId("task-detail-panel")).toBeInTheDocument();
    expect(screen.getByText("详情已显示")).toBeInTheDocument();
  });

  it("does not auto fit again when the live tree updates after creating nodes", async () => {
    const { rerender } = render(<WorkspaceWorkbench workspaceId="ws-1" />);

    expect(screen.getByTestId("fit-view-token")).toHaveTextContent("1");

    currentRootTask = createRoot([
      createTask(0),
      {
        ...createTask(99),
        id: "tmp:new-task",
        path: "root-1/tmp:new-task",
        title: "新节点",
      },
      ...Array.from({ length: 49 }, (_, index) => createTask(index + 1)),
    ]);

    rerender(<WorkspaceWorkbench workspaceId="ws-1" />);

    expect(screen.getByTestId("fit-view-token")).toHaveTextContent("1");
  });

  it("keeps the temporary node selected and editing before the optimistic tree catches up", async () => {
    createTaskMock.mockResolvedValue("tmp:new-task");

    render(<WorkspaceWorkbench workspaceId="ws-1" />);

    await userEvent.click(screen.getByRole("button", { name: "创建子节点" }));

    expect(createTaskMock).toHaveBeenCalledWith("root-1", "新节点");
    expect(screen.getByTestId("selected-task-id")).toHaveTextContent("tmp:new-task");
    expect(screen.getByTestId("editing-task-id")).toHaveTextContent("tmp:new-task");
  });
});
