import { describe, expect, it } from "vitest";

import type { TaskChangeset, TaskRecord, TaskSnapshotResponse } from "@/lib/api";
import {
  applyChangesetToTaskBase,
  applySnapshotToTaskBase,
  createEmptyPersistedTaskWorkspaceState,
  createOperationBase,
  projectTaskWorkspaceState,
  type CreateTaskOperation,
} from "@/lib/task-sync-local";

function createTaskRecord(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    archived_at: null,
    archived_by_milestone_id: null,
    assignee_user_id: null,
    completed_at: null,
    content_markdown: "",
    created_at: "2026-03-10T00:00:00Z",
    created_by_user_id: "user-1",
    depth: 0,
    id,
    meta_revision: 1,
    node_kind: "task",
    parent_id: null,
    path: id,
    planned_due_at: null,
    root_id: id,
    score: null,
    server_id: undefined,
    sort_order: 0,
    status: "in_progress",
    sync_error: undefined,
    sync_state: undefined,
    title: id,
    updated_at: "2026-03-10T00:00:00Z",
    weight: 0,
    workspace_id: "ws-1",
    ...overrides,
  };
}

describe("task-sync-local", () => {
  it("projects pending create operations into the visible tree immediately", () => {
    const snapshot: TaskSnapshotResponse = {
      root_id: "root-1",
      sync_seq: 3,
      tasks: [
        createTaskRecord("root-1", {
          node_kind: "system_root",
          title: "根节点",
        }),
      ],
      workspace_id: "ws-1",
    };

    const workspaceState = createEmptyPersistedTaskWorkspaceState("ws-1");
    workspaceState.base = applySnapshotToTaskBase(workspaceState.base, snapshot);
    workspaceState.outbox.push({
      ...createOperationBase("op-create"),
      assignee_user_id: null,
      client_id: "tmp:child-1",
      content_markdown: "",
      parent_id: "root-1",
      planned_due_at: null,
      title: "新节点",
      type: "create_task",
      weight: 0,
    } satisfies CreateTaskOperation);

    const projected = projectTaskWorkspaceState(workspaceState, []);

    expect(projected.rootTask?.children.map((child) => child.id)).toEqual(["tmp:child-1"]);
    expect(projected.rootTask?.children[0]?.server_id ?? null).toBeNull();
    expect(projected.rootTask?.children[0]?.document_sync_mode).toBe("local");
    expect(projected.rootTask?.children[0]?.sync_state).toBe("queued");
  });

  it("keeps the local id stable after server create acknowledgement", () => {
    const snapshot: TaskSnapshotResponse = {
      root_id: "root-1",
      sync_seq: 3,
      tasks: [
        createTaskRecord("root-1", {
          node_kind: "system_root",
          title: "根节点",
        }),
      ],
      workspace_id: "ws-1",
    };
    const changeset: TaskChangeset = {
      deletes: [],
      id_mappings: [{ client_id: "tmp:child-1", task_id: "srv-child-1" }],
      op_id: "op-create",
      op_type: "create_task",
      sync_seq: 4,
      upserts: [
        createTaskRecord("root-1", {
          node_kind: "system_root",
          title: "根节点",
        }),
        createTaskRecord("srv-child-1", {
          depth: 1,
          parent_id: "root-1",
          path: "root-1/srv-child-1",
          root_id: "root-1",
          title: "新节点",
        }),
      ],
      workspace_id: "ws-1",
    };

    const base = applySnapshotToTaskBase(createEmptyPersistedTaskWorkspaceState("ws-1").base, snapshot);
    const nextBase = applyChangesetToTaskBase(base, changeset);
    const projected = projectTaskWorkspaceState(
      {
        base: nextBase,
        outbox: [],
        updatedAt: "2026-03-10T00:00:00Z",
        workspaceId: "ws-1",
      },
      [],
    );

    expect(nextBase.tasksById["tmp:child-1"]?.server_id).toBe("srv-child-1");
    expect(nextBase.tasksById["tmp:child-1"]?.parent_id).toBe("root-1");
    expect(nextBase.serverToLocalId["srv-child-1"]).toBe("tmp:child-1");
    expect(projected.rootTask?.children[0]?.document_sync_mode).toBe("collab");
  });

  it("restores deleted nodes when the delete operation fails", () => {
    const snapshot: TaskSnapshotResponse = {
      root_id: "root-1",
      sync_seq: 3,
      tasks: [
        createTaskRecord("root-1", {
          node_kind: "system_root",
          title: "根节点",
        }),
        createTaskRecord("child-1", {
          depth: 1,
          parent_id: "root-1",
          path: "root-1/child-1",
          root_id: "root-1",
          title: "待删除节点",
        }),
      ],
      workspace_id: "ws-1",
    };

    const workspaceState = createEmptyPersistedTaskWorkspaceState("ws-1");
    workspaceState.base = applySnapshotToTaskBase(workspaceState.base, snapshot);
    workspaceState.outbox.push({
      ...createOperationBase("op-delete"),
      error: "同步失败",
      state: "failed",
      task_id: "child-1",
      type: "delete_task",
    });

    const projected = projectTaskWorkspaceState(workspaceState, []);

    expect(projected.rootTask?.children.map((child) => child.id)).toEqual(["child-1"]);
    expect(projected.rootTask?.children[0]?.sync_state).toBe("failed");
    expect(projected.rootTask?.children[0]?.sync_error).toBe("同步失败");
  });
});
