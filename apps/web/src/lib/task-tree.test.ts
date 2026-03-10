import { describe, expect, it } from "vitest";

import type { TaskTreeNode } from "@/lib/api";
import {
  buildMindmapLayout,
  deriveWorkbenchTreeState,
  getVirtualWindow,
  type MindmapLayoutOptions,
} from "@/lib/task-tree";

function createTaskNode(
  id: string,
  overrides: Partial<TaskTreeNode> = {},
): TaskTreeNode {
  return {
    id,
    workspace_id: "ws-1",
    parent_id: null,
    root_id: "root-1",
    path: id,
    depth: 0,
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

function createTaskTree() {
  const grandchild = createTaskNode("grandchild-1", {
    depth: 2,
    parent_id: "child-1",
    path: "root-1/child-1/grandchild-1",
  });
  const childOne = createTaskNode("child-1", {
    children: [grandchild],
    depth: 1,
    parent_id: "root-1",
    path: "root-1/child-1",
  });
  const childTwo = createTaskNode("child-2", {
    depth: 1,
    parent_id: "root-1",
    path: "root-1/child-2",
    sort_order: 1,
    status: "pending_review",
  });

  return createTaskNode("root-1", {
    children: [childOne, childTwo],
    node_kind: "system_root",
    path: "root-1",
    root_id: "root-1",
    title: "根节点",
  });
}

describe("task-tree helpers", () => {
  it("keeps the root and visible branches after collapse", () => {
    const root = createTaskTree();
    const state = deriveWorkbenchTreeState(root, new Set(["child-1"]));

    expect(state.taskIndex.size).toBe(4);
    expect(state.collapsibleTaskIdSet.has("child-1")).toBe(true);
    expect(state.visibleTaskIds).toEqual(["root-1", "child-1", "child-2"]);
    expect(state.flatTasks.map(({ direction, level, task }) => `${level}:${direction}:${task.id}`)).toEqual([
      "0:center:root-1",
      "1:right:child-1",
      "1:right:child-2",
    ]);
  });

  it("builds a single-root mindmap layout from left to right", () => {
    const root = createTaskTree();
    const options: MindmapLayoutOptions = {
      horizontalGap: 10,
      nodeHeight: 10,
      originX: 0,
      originY: 0,
      rootGap: 4,
      verticalGap: 2,
    };

    const layout = buildMindmapLayout(root, new Set(), options);

    expect(layout.nodes.map((node) => `${node.id}:${node.direction}@${node.x},${node.y}`)).toEqual([
      "root-1:center@0,6",
      "child-1:right@10,0",
      "grandchild-1:right@20,0",
      "child-2:right@10,12",
    ]);
    expect(layout.edges.map((edge) => `${edge.id}:${edge.direction}`)).toEqual([
      "root-1->child-1:right",
      "child-1->grandchild-1:right",
      "root-1->child-2:right",
    ]);
    expect(layout.visibleNodeIds).toEqual(["root-1", "child-1", "grandchild-1", "child-2"]);
  });

  it("computes a stable virtual window for large task tables", () => {
    expect(getVirtualWindow(200, 680, 340, 68, 4)).toEqual({
      endIndex: 19,
      paddingBottom: 12308,
      paddingTop: 408,
      startIndex: 6,
    });

    expect(getVirtualWindow(3, 0, 340, 68, 4)).toEqual({
      endIndex: 3,
      paddingBottom: 0,
      paddingTop: 0,
      startIndex: 0,
    });
  });
});
