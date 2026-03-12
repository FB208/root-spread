import type { TaskStatus, TaskTreeNode } from "@/lib/api";

export type BranchDirection = "center" | "left" | "right";

export type FlatTaskRow = {
  direction: BranchDirection;
  level: number;
  task: TaskTreeNode;
};

export type WorkbenchTreeState = {
  collapsibleTaskIds: string[];
  collapsibleTaskIdSet: Set<string>;
  flatTasks: FlatTaskRow[];
  taskIndex: Map<string, TaskTreeNode>;
  visibleTaskIds: string[];
  visibleTaskIdSet: Set<string>;
};

export type VirtualWindow = {
  endIndex: number;
  paddingBottom: number;
  paddingTop: number;
  startIndex: number;
};

export type MindmapLayoutOptions = {
  horizontalGap: number;
  nodeHeight: number;
  originX: number;
  originY: number;
  rootGap: number;
  verticalGap: number;
};

export type MindmapLayoutNode = {
  collapsed: boolean;
  direction: BranchDirection;
  hasChildren: boolean;
  id: string;
  task: TaskTreeNode;
  x: number;
  y: number;
};

export type MindmapLayoutEdge = {
  direction: Exclude<BranchDirection, "center">;
  id: string;
  matchedFilter: boolean;
  source: string;
  status: TaskStatus;
  target: string;
};

export type MindmapLayout = {
  edges: MindmapLayoutEdge[];
  nodes: MindmapLayoutNode[];
  visibleNodeIds: string[];
};

export type TaskTreeNodePayload = Omit<TaskTreeNode, "children" | "matched_filter"> & {
  children?: TaskTreeNode[];
  matched_filter?: boolean;
};

function sortChildren(children: TaskTreeNode[]) {
  return [...children].sort((left, right) => {
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order;
    }

    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });
}

export function toTaskTreeNode(payload: TaskTreeNodePayload): TaskTreeNode {
  return {
    ...payload,
    children: sortChildren(payload.children ?? []),
    matched_filter: payload.matched_filter ?? true,
  };
}

export function insertTaskTreeNode(
  root: TaskTreeNode | null,
  parentId: string,
  payload: TaskTreeNodePayload,
): TaskTreeNode | null {
  if (!root) {
    return null;
  }

  const insertedNode = toTaskTreeNode(payload);

  function visit(node: TaskTreeNode): TaskTreeNode {
    if (node.id === parentId) {
      return {
        ...node,
        children: sortChildren([...node.children, insertedNode]),
      };
    }

    return {
      ...node,
      children: node.children.map((child) => visit(child)),
    };
  }

  return visit(root);
}

export function patchTaskTreeNode(
  root: TaskTreeNode | null,
  taskId: string,
  patch: Partial<TaskTreeNodePayload>,
): TaskTreeNode | null {
  if (!root) {
    return null;
  }

  function visit(node: TaskTreeNode): TaskTreeNode {
    if (node.id === taskId) {
      return toTaskTreeNode({
        ...node,
        ...patch,
        children: patch.children ?? node.children,
        matched_filter: patch.matched_filter ?? node.matched_filter,
      });
    }

    return {
      ...node,
      children: node.children.map((child) => visit(child)),
    };
  }

  return visit(root);
}

export function findTaskTreeNode(root: TaskTreeNode | null, taskId: string): TaskTreeNode | null {
  if (!root) {
    return null;
  }

  if (root.id === taskId) {
    return root;
  }

  for (const child of root.children) {
    const matchedNode = findTaskTreeNode(child, taskId);
    if (matchedNode) {
      return matchedNode;
    }
  }

  return null;
}

export function removeTaskTreeNode(
  root: TaskTreeNode | null,
  taskId: string,
): { nextRoot: TaskTreeNode | null; removedParentId: string | null } {
  if (!root || root.id === taskId) {
    return { nextRoot: root, removedParentId: null };
  }

  let removedParentId: string | null = null;

  function visit(node: TaskTreeNode): TaskTreeNode {
    const remainingChildren = node.children.filter((child) => {
      if (child.id === taskId) {
        removedParentId = node.id;
        return false;
      }

      return true;
    });

    return {
      ...node,
      children: remainingChildren.map((child) => visit(child)),
    };
  }

  return {
    nextRoot: visit(root),
    removedParentId,
  };
}

export function reorderTaskTreeChildren(
  root: TaskTreeNode | null,
  parentId: string,
  orderedChildIds: string[],
): TaskTreeNode | null {
  if (!root) {
    return null;
  }

  function visit(node: TaskTreeNode): TaskTreeNode {
    if (node.id === parentId) {
      const childMap = new Map(node.children.map((child) => [child.id, child]));
      const reorderedChildren = orderedChildIds
        .map((childId, index) => {
          const child = childMap.get(childId);
          if (!child) {
            return null;
          }

          return {
            ...child,
            sort_order: index,
          };
        })
        .filter((child): child is TaskTreeNode => child !== null);

      return {
        ...node,
        children: reorderedChildren,
      };
    }

    return {
      ...node,
      children: node.children.map((child) => visit(child)),
    };
  }

  return visit(root);
}

function getRootBranchDirection(index: number): Exclude<BranchDirection, "center"> {
  void index;
  return "right";
}

export function deriveWorkbenchTreeState(
  root: TaskTreeNode | null,
  collapsedTaskIds: ReadonlySet<string>,
): WorkbenchTreeState {
  const taskIndex = new Map<string, TaskTreeNode>();
  const flatTasks: FlatTaskRow[] = [];
  const visibleTaskIds: string[] = [];
  const visibleTaskIdSet = new Set<string>();
  const collapsibleTaskIds: string[] = [];
  const collapsibleTaskIdSet = new Set<string>();

  function walk(node: TaskTreeNode, level: number, direction: BranchDirection, visible: boolean) {
    taskIndex.set(node.id, node);

    if (node.children.length) {
      collapsibleTaskIds.push(node.id);
      collapsibleTaskIdSet.add(node.id);
    }

    if (visible) {
      flatTasks.push({ direction, level, task: node });
      visibleTaskIds.push(node.id);
      visibleTaskIdSet.add(node.id);
    }

    if (!node.children.length) {
      return;
    }

    node.children.forEach((child, index) => {
      const childDirection =
        direction === "center" ? getRootBranchDirection(index) : direction;
      walk(child, level + 1, childDirection, visible && !collapsedTaskIds.has(node.id));
    });
  }

  if (root) {
    walk(root, 0, "center", true);
  }

  return {
    collapsibleTaskIds,
    collapsibleTaskIdSet,
    flatTasks,
    taskIndex,
    visibleTaskIds,
    visibleTaskIdSet,
  };
}

export function buildMindmapLayout(
  root: TaskTreeNode | null,
  collapsedTaskIds: ReadonlySet<string>,
  options: MindmapLayoutOptions,
): MindmapLayout {
  if (!root) {
    return { edges: [], nodes: [], visibleNodeIds: [] };
  }

  const nodes: MindmapLayoutNode[] = [];
  const edges: MindmapLayoutEdge[] = [];
  const visibleNodeIds: string[] = [];
  const subtreeHeights = new Map<string, number>();

  function measureSubtree(node: TaskTreeNode): number {
    const cachedHeight = subtreeHeights.get(node.id);
    if (cachedHeight !== undefined) {
      return cachedHeight;
    }

    const isCollapsed = collapsedTaskIds.has(node.id);
    const height =
      isCollapsed || !node.children.length
        ? options.nodeHeight
        : Math.max(
            options.nodeHeight,
            node.children.reduce((total, child, index) => {
              return total + measureSubtree(child) + (index > 0 ? options.verticalGap : 0);
            }, 0),
          );

    subtreeHeights.set(node.id, height);
    return height;
  }

  function visit(
    node: TaskTreeNode,
    depth: number,
    startY: number,
    parentId: string | null,
    direction: BranchDirection,
  ) {
    const isCollapsed = collapsedTaskIds.has(node.id);
    const blockHeight = measureSubtree(node);
    const nodeY = startY + blockHeight / 2 - options.nodeHeight / 2;
    const offsetX = depth * options.horizontalGap + (depth > 0 ? options.rootGap : 0);

    nodes.push({
      collapsed: isCollapsed,
      direction,
      hasChildren: node.children.length > 0,
      id: node.id,
      task: node,
      x: options.originX + offsetX,
      y: nodeY,
    });
    visibleNodeIds.push(node.id);

    if (parentId && direction !== "center") {
      edges.push({
        direction,
        id: `${parentId}->${node.id}`,
        matchedFilter: node.matched_filter,
        source: parentId,
        status: node.status,
        target: node.id,
      });
    }

    if (isCollapsed || !node.children.length) {
      return;
    }

    const totalChildrenHeight = node.children.reduce((total, child, index) => {
      return total + measureSubtree(child) + (index > 0 ? options.verticalGap : 0);
    }, 0);
    let childY = nodeY + options.nodeHeight / 2 - totalChildrenHeight / 2;

    node.children.forEach((child, index) => {
      const childHeight = measureSubtree(child);
      const childDirection =
        direction === "center" ? getRootBranchDirection(index) : direction;
      visit(child, depth + 1, childY, node.id, childDirection);
      childY += childHeight + options.verticalGap;
    });
  }

  visit(root, 0, options.originY, null, "center");

  return { edges, nodes, visibleNodeIds };
}

export function getVirtualWindow(
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
  itemHeight: number,
  overscan: number,
): VirtualWindow {
  if (itemCount <= 0 || itemHeight <= 0) {
    return {
      endIndex: 0,
      paddingBottom: 0,
      paddingTop: 0,
      startIndex: 0,
    };
  }

  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewportHeight = Math.max(itemHeight, viewportHeight);
  const safeOverscan = Math.max(0, overscan);
  const visibleCount = Math.max(1, Math.ceil(safeViewportHeight / itemHeight));
  const startIndex = Math.max(0, Math.floor(safeScrollTop / itemHeight) - safeOverscan);
  const endIndex = Math.min(itemCount, startIndex + visibleCount + safeOverscan * 2);

  return {
    endIndex,
    paddingBottom: Math.max(0, (itemCount - endIndex) * itemHeight),
    paddingTop: startIndex * itemHeight,
    startIndex,
  };
}
