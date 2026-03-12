import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ComponentProps, type ComponentType, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskMindmap } from "@/components/task-mindmap";
import type { TaskTreeNode } from "@/lib/api";

const fitViewMock = vi.fn();
const setCenterMock = vi.fn();
const getZoomMock = vi.fn(() => 0.72);
const requestFullscreenMock = vi.fn(function (this: HTMLElement) {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    value: this,
  });
  document.dispatchEvent(new Event("fullscreenchange"));
  return Promise.resolve();
});
const exitFullscreenMock = vi.fn(() => {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    value: null,
  });
  document.dispatchEvent(new Event("fullscreenchange"));
  return Promise.resolve();
});

vi.mock("@xyflow/react", async () => {
  return {
    Background: () => null,
    BackgroundVariant: { Dots: "dots" },
    BaseEdge: ({ id, path, style }: { id: string; path: string; style?: Record<string, string | number> }) => (
      <svg data-testid={`edge-${id}`}>
        <path d={path} style={style} />
      </svg>
    ),
    Handle: () => null,
    Position: { Left: "left", Right: "right" },
    ReactFlow: function ReactFlowMock({
      children,
      nodeTypes,
      nodes,
      onInit,
    }: {
      children: ReactNode;
      nodeTypes: Record<string, ComponentType<{ data: unknown; id: string }>>;
      nodes: Array<{ data: unknown; id: string; type: string }>;
      onInit?: (instance: {
        fitView: typeof fitViewMock;
        getZoom: typeof getZoomMock;
        setCenter: typeof setCenterMock;
      }) => void;
    }) {
      useEffect(() => {
        onInit?.({ fitView: fitViewMock, getZoom: getZoomMock, setCenter: setCenterMock });
      }, [onInit]);

      return (
        <div data-testid="react-flow-mock">
          {nodes.map((node) => {
            const NodeComponent = nodeTypes[node.type];
            return <NodeComponent key={node.id} data={node.data} id={node.id} />;
          })}
          {children}
        </div>
      );
    },
    getBezierPath: () => ["M 0 0 C 10 10, 20 20, 30 30"],
    useReactFlow: () => ({ fitView: fitViewMock, getZoom: getZoomMock, setCenter: setCenterMock }),
  };
});

function createTaskNode(id: string, overrides: Partial<TaskTreeNode> = {}): TaskTreeNode {
  return {
    id,
    workspace_id: "ws-1",
    parent_id: "root-1",
    root_id: "root-1",
    path: `root-1/${id}`,
    depth: 1,
    sort_order: 0,
    meta_revision: 1,
    title: id,
    content_markdown: "",
    node_kind: "task",
    created_by_user_id: "user-1",
    assignee_user_id: null,
    planned_due_at: null,
    completed_at: null,
    archived_at: null,
    archived_by_milestone_id: null,
    weight: 0,
    score: null,
    status: "in_progress",
    created_at: "2026-03-10T00:00:00Z",
    updated_at: "2026-03-10T00:00:00Z",
    matched_filter: true,
    children: [],
    ...overrides,
  };
}

function createRootTree() {
  const child = createTaskNode("子任务 A", { id: "child-1", title: "子任务 A" });
  return createTaskNode("root-1", {
    id: "root-1",
    parent_id: null,
    path: "root-1",
    depth: 0,
    title: "根节点",
    node_kind: "system_root",
    children: [child],
  });
}

function defaultRenameProps() {
  return {
    editingTaskId: null,
    editingTitle: "",
    onRenameCancel: vi.fn(),
    onRenameChange: vi.fn(),
    onRenameCommit: vi.fn(),
    onRenameStart: vi.fn(),
  };
}

function defaultMindmapActions() {
  return {
    allowReorder: true,
    detailVisible: true,
    onCollapseAll: vi.fn(),
    onExpandAll: vi.fn(),
    onReorderSiblings: vi.fn(),
    onToggleDetailVisibility: vi.fn(),
  };
}

function createProps(overrides: Partial<ComponentProps<typeof TaskMindmap>> = {}): ComponentProps<typeof TaskMindmap> {
  const renameProps = defaultRenameProps();
  const mindmapActions = defaultMindmapActions();

  return {
    allowReorder: mindmapActions.allowReorder,
    collapsedTaskIds: new Set(),
    detailVisible: mindmapActions.detailVisible,
    editingTaskId: renameProps.editingTaskId,
    editingTitle: renameProps.editingTitle,
    fitViewToken: 0,
    focusCanvasToken: 0,
    onCollapseAll: mindmapActions.onCollapseAll,
    onCreateChild: vi.fn(),
    onCreateSibling: vi.fn(),
    onDeleteTask: vi.fn(),
    onExpandAll: mindmapActions.onExpandAll,
    onReorderSiblings: mindmapActions.onReorderSiblings,
    onRenameCancel: renameProps.onRenameCancel,
    onRenameChange: renameProps.onRenameChange,
    onRenameCommit: renameProps.onRenameCommit,
    onRenameStart: renameProps.onRenameStart,
    onSelectTask: vi.fn(),
    onToggleDetailVisibility: mindmapActions.onToggleDetailVisibility,
    onToggleCollapse: vi.fn(),
    readOnly: false,
    root: createRootTree(),
    selectedTaskId: "child-1",
    ...overrides,
  };
}

describe("TaskMindmap", () => {
  beforeEach(() => {
    fitViewMock.mockClear();
    getZoomMock.mockClear();
    setCenterMock.mockClear();
    requestFullscreenMock.mockClear();
    exitFullscreenMock.mockClear();

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreenMock,
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreenMock,
    });
  });

  it("uses selected node for keyboard shortcuts on the canvas", () => {
    const onCreateChild = vi.fn();
    const onCreateSibling = vi.fn();
    const onDeleteTask = vi.fn();
    const onSelectTask = vi.fn();
    const renameProps = defaultRenameProps();

    render(
      <TaskMindmap
        {...createProps({
          onCreateChild,
          onCreateSibling,
          onDeleteTask,
          onRenameStart: renameProps.onRenameStart,
          onSelectTask,
        })}
      />,
    );

    const canvas = screen.getByTestId("task-mindmap-canvas");
    fireEvent.keyDown(canvas, { key: "Tab" });
    fireEvent.keyDown(canvas, { key: "Enter" });
    fireEvent.keyDown(canvas, { key: "Delete" });
    fireEvent.keyDown(canvas, { key: "ArrowLeft" });
    fireEvent.keyDown(canvas, { key: "F2" });

    expect(onCreateChild).toHaveBeenCalledWith("child-1");
    expect(onCreateSibling).toHaveBeenCalledWith("child-1");
    expect(onDeleteTask).toHaveBeenCalledWith("child-1");
    expect(onSelectTask).toHaveBeenCalledWith("root-1");
    expect(renameProps.onRenameStart).toHaveBeenCalledWith("child-1");
  });

  it("marks the currently selected node with a strong selected state and supports mouse switching", () => {
    const onSelectTask = vi.fn();

    render(<TaskMindmap {...createProps({ onSelectTask })} />);

    const selectedNode = screen.getByRole("button", { name: "子任务 A" });
    const rootNode = screen.getByRole("button", { name: "根节点" });

    expect(selectedNode).toHaveAttribute("data-selected", "true");
    expect(rootNode).toHaveAttribute("data-selected", "false");

    fireEvent.mouseDown(rootNode);
    fireEvent.click(rootNode);

    expect(onSelectTask).toHaveBeenCalledWith("root-1");
  });

  it("supports inline renaming via double click and commit", () => {
    const onRenameCancel = vi.fn();
    const onRenameChange = vi.fn();
    const onRenameCommit = vi.fn();
    const onRenameStart = vi.fn();

    render(
      <TaskMindmap
        {...createProps({
          editingTaskId: "child-1",
          editingTitle: "新的标题",
          onRenameCancel,
          onRenameChange,
          onRenameCommit,
          onRenameStart,
        })}
      />,
    );

    const editingInput = screen.getByDisplayValue("新的标题");
    fireEvent.change(editingInput, { target: { value: "新的标题 2" } });
    fireEvent.keyDown(editingInput, { key: "Enter" });
    fireEvent.doubleClick(screen.getByRole("button", { name: "根节点" }));

    expect(onRenameChange).toHaveBeenCalledWith("新的标题 2");
    expect(onRenameCommit).toHaveBeenCalledWith("child-1", "新的标题");
    expect(onRenameStart).toHaveBeenCalledWith("root-1");
    expect(onRenameCancel).not.toHaveBeenCalled();
  });

  it("keeps the title input focused when entering edit mode", async () => {
    const onRenameCommit = vi.fn();

    render(
      <TaskMindmap
        {...createProps({
          editingTaskId: "child-1",
          editingTitle: "新节点",
          focusCanvasToken: 1,
          onRenameCommit,
        })}
      />,
    );

    const editingInput = screen.getByDisplayValue("新节点");

    await waitFor(() => {
      expect(editingInput).toHaveFocus();
    });

    expect(onRenameCommit).not.toHaveBeenCalled();
  });

  it("recenters the viewport around the selected node", async () => {
    const { rerender } = render(<TaskMindmap {...createProps({ selectedTaskId: "child-1" })} />);

    await waitFor(() => {
      expect(setCenterMock).toHaveBeenCalled();
    });

    rerender(<TaskMindmap {...createProps({ selectedTaskId: "root-1" })} />);

    await waitFor(() => {
      expect(setCenterMock).toHaveBeenCalledTimes(2);
    });
  });

  it("shows the floating toolbar and triggers toolbar actions", async () => {
    const onExpandAll = vi.fn();
    const onCollapseAll = vi.fn();
    const onToggleDetailVisibility = vi.fn();

    render(
      <TaskMindmap
        {...createProps({
          onCollapseAll,
          onExpandAll,
          onToggleDetailVisibility,
        })}
      />,
    );

    expect(screen.getByTestId("task-mindmap-toolbar")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "适配视图" }));
    fireEvent.click(screen.getByRole("button", { name: "展开全部" }));
    fireEvent.click(screen.getByRole("button", { name: "折叠全部" }));
    fireEvent.click(screen.getByRole("button", { name: "聚焦当前节点" }));
    fireEvent.click(screen.getByRole("button", { name: "收起详情" }));
    fireEvent.click(screen.getByRole("button", { name: "全屏" }));

    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalled();
      expect(setCenterMock).toHaveBeenCalled();
      expect(requestFullscreenMock).toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "退出全屏" })).toBeInTheDocument();
    });

    expect(onExpandAll).toHaveBeenCalled();
    expect(onCollapseAll).toHaveBeenCalled();
    expect(onToggleDetailVisibility).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "退出全屏" }));

    await waitFor(() => {
      expect(exitFullscreenMock).toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "全屏" })).toBeInTheDocument();
    });
  });
});
