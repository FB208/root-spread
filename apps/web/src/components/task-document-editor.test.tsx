import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskDocumentEditor } from "@/components/task-document-editor";
import type { TaskTreeNode } from "@/lib/api";

const { editorStateCreateMock, editorViewConstructorMock } = vi.hoisted(() => ({
  editorStateCreateMock: vi.fn(() => ({})),
  editorViewConstructorMock: vi.fn(),
}));

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class HocuspocusProviderMock {
    awareness = {
      getStates: () => new Map(),
      off: vi.fn(),
      on: vi.fn(),
      setLocalStateField: vi.fn(),
    };

    destroy = vi.fn();

    on = vi.fn();
  },
}));

vi.mock("yjs", () => ({
  Doc: class YDocMock {
    destroy() {
      return undefined;
    }

    getText() {
      return {
        insert: vi.fn(),
        toString: () => "",
      };
    }
  },
  UndoManager: class UndoManagerMock {},
}));

vi.mock("y-codemirror.next", () => ({
  yCollab: vi.fn(() => ({})),
}));

vi.mock("@codemirror/lang-markdown", () => ({
  markdown: vi.fn(() => ({})),
}));

vi.mock("@codemirror/state", () => ({
  EditorState: {
    create: editorStateCreateMock,
    readOnly: {
      of: vi.fn(() => ({})),
    },
  },
}));

vi.mock("@codemirror/view", () => {
  class EditorViewMock {
    static editable = {
      of: vi.fn(() => ({})),
    };

    static lineWrapping = {};

    static theme = vi.fn(() => ({}));

    destroy = vi.fn();

    constructor({ parent }: { parent: HTMLElement }) {
      editorViewConstructorMock();
      const element = document.createElement("div");
      element.setAttribute("data-testid", "codemirror-root");
      parent.appendChild(element);
    }
  }

  return { EditorView: EditorViewMock };
});

function createTask(overrides: Partial<TaskTreeNode> = {}): TaskTreeNode {
  return {
    archived_at: null,
    archived_by_milestone_id: null,
    assignee_user_id: null,
    children: [],
    completed_at: null,
    content_markdown: "初始正文",
    created_at: "2026-03-10T00:00:00Z",
    created_by_user_id: "user-1",
    depth: 1,
    document_sync_mode: "local",
    id: "task-1",
    matched_filter: true,
    meta_revision: 1,
    node_kind: "task",
    parent_id: "root-1",
    path: "root-1/task-1",
    planned_due_at: null,
    root_id: "root-1",
    score: null,
    server_id: null,
    sort_order: 0,
    status: "in_progress",
    sync_error: null,
    sync_state: "queued",
    title: "任务 1",
    updated_at: "2026-03-10T00:00:00Z",
    weight: 0,
    workspace_id: "ws-1",
    ...overrides,
  };
}

describe("TaskDocumentEditor", () => {
  it("allows local document editing before collab handoff completes", () => {
    const onLocalDocumentChange = vi.fn();

    render(
      <TaskDocumentEditor
        accessToken="token"
        onLocalDocumentChange={onLocalDocumentChange}
        readOnly={false}
        task={createTask({ document_sync_mode: "local", server_id: "srv-task-1", sync_state: "sending" })}
        userName="Tester"
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "新的正文" } });

    expect(onLocalDocumentChange).toHaveBeenCalledWith("新的正文");
    expect(screen.getByText("本地草稿")).toBeInTheDocument();
    expect(screen.getByText(/自动切换到协同编辑/)).toBeInTheDocument();
  });

  it("mounts the collab editor once the task is fully synced", () => {
    render(
      <TaskDocumentEditor
        accessToken="token"
        onLocalDocumentChange={vi.fn()}
        readOnly={false}
        task={createTask({ document_sync_mode: "collab", server_id: "srv-task-1", sync_state: "synced" })}
        userName="Tester"
      />,
    );

    expect(screen.getByText("协同编辑")).toBeInTheDocument();
    expect(screen.getByTestId("codemirror-root")).toBeInTheDocument();
    expect(editorStateCreateMock).toHaveBeenCalled();
    expect(editorViewConstructorMock).toHaveBeenCalled();
  });
});
