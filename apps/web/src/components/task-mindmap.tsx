"use client";

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
  getBezierPath,
  useReactFlow,
} from "@xyflow/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import type { TaskTreeNode } from "@/lib/api";
import { buildMindmapLayout, type BranchDirection } from "@/lib/task-tree";

type TaskMindmapProps = {
  allowReorder: boolean;
  collapsedTaskIds: Set<string>;
  editingTaskId: string | null;
  editingTitle: string;
  fitViewToken: number;
  focusCanvasToken: number;
  onCreateChild: (taskId: string) => void;
  onCreateSibling: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onReorderSiblings: (parentId: string, orderedTaskIds: string[]) => void;
  onRenameCancel: () => void;
  onRenameChange: (title: string) => void;
  onRenameCommit: (taskId: string, title: string) => void;
  onRenameStart: (taskId: string) => void;
  onSelectTask: (taskId: string) => void;
  onToggleCollapse: (taskId: string) => void;
  readOnly: boolean;
  root: TaskTreeNode | null;
  selectedTaskId: string | null;
};

type TaskCanvasNodeData = {
  collapsed: boolean;
  direction: BranchDirection;
  hasChildren: boolean;
  editingTitle: string;
  isEditing: boolean;
  onRenameCancel: () => void;
  onRenameChange: (title: string) => void;
  onRenameCommit: (taskId: string, title: string) => void;
  onRenameStart: (taskId: string) => void;
  onSelectTask: (taskId: string) => void;
  onToggleCollapse: (taskId: string) => void;
  readOnly: boolean;
  selected: boolean;
  task: TaskTreeNode;
};

type TaskCanvasFlowNode = Node<TaskCanvasNodeData, "taskNode">;

const NODE_WIDTH = 188;
const ROOT_NODE_WIDTH = 228;
const NODE_HEIGHT = 72;
const HORIZONTAL_GAP = 248;
const VERTICAL_GAP = 26;
const LAYOUT_OPTIONS = {
  horizontalGap: HORIZONTAL_GAP,
  nodeHeight: NODE_HEIGHT,
  originX: 0,
  originY: 120,
  rootGap: 0,
  verticalGap: VERTICAL_GAP,
} as const;

function toneByStatus(task: TaskTreeNode) {
  if (task.node_kind === "system_root") {
    return {
      accent: "#9cc4ff",
      background: "rgba(22, 40, 86, 0.88)",
      border: "rgba(156, 196, 255, 0.42)",
      glow: "rgba(120, 171, 255, 0.26)",
      text: "#eff6ff",
    };
  }

  switch (task.status) {
    case "completed":
      return {
        accent: "#34d399",
        background: "rgba(8, 26, 21, 0.88)",
        border: "rgba(52, 211, 153, 0.24)",
        glow: "rgba(52, 211, 153, 0.2)",
        text: "#ecfdf5",
      };
    case "pending_review":
      return {
        accent: "#fbbf24",
        background: "rgba(38, 28, 8, 0.88)",
        border: "rgba(251, 191, 36, 0.24)",
        glow: "rgba(251, 191, 36, 0.18)",
        text: "#fffbeb",
      };
    case "terminated":
      return {
        accent: "#fb7185",
        background: "rgba(43, 11, 18, 0.88)",
        border: "rgba(251, 113, 133, 0.24)",
        glow: "rgba(251, 113, 133, 0.2)",
        text: "#fff1f2",
      };
    default:
      return {
        accent: "#60a5fa",
        background: "rgba(10, 20, 40, 0.88)",
        border: "rgba(96, 165, 250, 0.22)",
        glow: "rgba(96, 165, 250, 0.16)",
        text: "#eff6ff",
      };
  }
}

function MindmapEdge({ id, sourceX, sourceY, targetX, targetY, style }: EdgeProps<Edge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: sourceX <= targetX ? Position.Right : Position.Left,
    targetX,
    targetY,
    targetPosition: sourceX <= targetX ? Position.Left : Position.Right,
    curvature: 0.38,
  });

  return <BaseEdge id={id} path={path} style={{ ...style, strokeLinecap: "round", strokeLinejoin: "round" }} />;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

function isPrimaryButton(event: { button?: number }) {
  return event.button === undefined || event.button === 0;
}

const TaskCanvasNode = memo(
  function TaskCanvasNode({ data }: NodeProps<TaskCanvasFlowNode>) {
    const {
      collapsed,
      direction,
      editingTitle,
      hasChildren,
      isEditing,
      onRenameCancel,
      onRenameChange,
      onRenameCommit,
      onRenameStart,
      onSelectTask,
      onToggleCollapse,
      readOnly,
      selected,
      task,
    } = data;
    const inputRef = useRef<HTMLInputElement | null>(null);
    const skipBlurCommitRef = useRef(false);
    const tone = toneByStatus(task);
    const isSystemRoot = task.node_kind === "system_root";
    const collapseAnchor = direction === "left" ? "-left-3" : "-right-3";

    useEffect(() => {
      if (!isEditing) {
        return;
      }

      skipBlurCommitRef.current = false;

      const frame = window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });

      return () => window.cancelAnimationFrame(frame);
    }, [isEditing]);

    return (
      <div
        className={`mindmap-node-drag-handle group relative rounded-full border px-5 py-3 text-center transition duration-150 ${
          isSystemRoot ? "font-semibold tracking-[0.02em]" : "font-medium"
        } ${selected ? "scale-[1.06]" : "hover:scale-[1.01]"}`}
        data-selected={selected ? "true" : "false"}
        data-task-id={task.id}
        onContextMenu={(event) => event.preventDefault()}
        onMouseDown={(event) => {
          if (isPrimaryButton(event)) {
            onSelectTask(task.id);
          }
        }}
        onClick={(event) => {
          if (isPrimaryButton(event)) {
            onSelectTask(task.id);
          }
        }}
        onDoubleClick={() => {
          if (!readOnly) {
            onRenameStart(task.id);
          }
        }}
        role="button"
        style={{
          background: selected
            ? `linear-gradient(180deg, ${tone.accent}2b, ${tone.background})`
            : `linear-gradient(180deg, rgba(7,10,18,0.96), ${tone.background})`,
          borderColor: selected ? tone.accent : tone.border,
          boxShadow: selected
            ? `0 0 0 2px rgba(255,255,255,0.2), 0 0 0 5px ${tone.accent}88, 0 26px 72px ${tone.glow}`
            : `0 10px 22px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.04)`,
          color: tone.text,
          opacity: selected ? 1 : 0.9,
        }}
      >
        <Handle className="!h-0 !w-0 !border-0 !bg-transparent" id="left-source" position={Position.Left} type="source" />
        <Handle className="!h-0 !w-0 !border-0 !bg-transparent" id="right-source" position={Position.Right} type="source" />
        <Handle className="!h-0 !w-0 !border-0 !bg-transparent" id="left-target" position={Position.Left} type="target" />
        <Handle className="!h-0 !w-0 !border-0 !bg-transparent" id="right-target" position={Position.Right} type="target" />

        {selected ? (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-white/70 bg-white"
          />
        ) : null}

        {hasChildren ? (
          <button
            className={`absolute ${collapseAnchor} top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-white/[0.14] bg-[#060914] text-white/72 transition hover:border-white/[0.28] hover:text-white`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse(task.id);
            }}
            onMouseDown={(event) => event.preventDefault()}
            tabIndex={-1}
            type="button"
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : null}

        {isEditing ? (
          <input
            ref={inputRef}
            className="w-full rounded-full border border-white/20 bg-black/25 px-3 py-1 text-center text-[15px] leading-6 text-white outline-none ring-0"
            onBlur={() => {
              if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false;
                return;
              }

              onRenameCommit(task.id, editingTitle);
            }}
            onChange={(event) => onRenameChange(event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();

              if (event.key === "Enter") {
                event.preventDefault();
                skipBlurCommitRef.current = true;
                onRenameCommit(task.id, editingTitle);
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                skipBlurCommitRef.current = true;
                onRenameCancel();
                return;
              }

              if (event.key === "Tab") {
                event.preventDefault();
                skipBlurCommitRef.current = true;
                onRenameCommit(task.id, editingTitle);
              }
            }}
            value={editingTitle}
          />
        ) : (
          <span className="block truncate text-[15px] leading-6">{task.title}</span>
        )}
      </div>
    );
  },
  (previous, next) =>
    previous.data.collapsed === next.data.collapsed &&
    previous.data.direction === next.data.direction &&
    previous.data.editingTitle === next.data.editingTitle &&
    previous.data.hasChildren === next.data.hasChildren &&
    previous.data.isEditing === next.data.isEditing &&
    previous.data.readOnly === next.data.readOnly &&
    previous.data.selected === next.data.selected &&
    previous.data.task === next.data.task,
);

const nodeTypes: NodeTypes = {
  taskNode: TaskCanvasNode,
};

const edgeTypes: EdgeTypes = {
  mindmapEdge: MindmapEdge,
};

function AutoFitView({ fitViewToken }: { fitViewToken: number }) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (!fitViewToken) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      void fitView({ duration: 220, padding: 0.2, minZoom: 0.28, maxZoom: 1.1 });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [fitView, fitViewToken]);

  return null;
}

function AutoCenterSelectedNode({
  selectedNode,
}: {
  selectedNode: { id: string; width: number; x: number; y: number } | null;
}) {
  const { getZoom, setCenter } = useReactFlow();
  const lastSignatureRef = useRef<string>("");

  useEffect(() => {
    if (!selectedNode) {
      return;
    }

    const signature = `${selectedNode.id}:${selectedNode.x}:${selectedNode.y}:${selectedNode.width}`;
    if (lastSignatureRef.current === signature) {
      return;
    }

    lastSignatureRef.current = signature;

    const frame = window.requestAnimationFrame(() => {
      void setCenter(selectedNode.x + selectedNode.width / 2 - 96, selectedNode.y + NODE_HEIGHT / 2, {
        duration: 220,
        zoom: getZoom(),
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [getZoom, selectedNode, setCenter]);

  return null;
}

export function TaskMindmap({
  allowReorder,
  collapsedTaskIds,
  editingTaskId,
  editingTitle,
  fitViewToken,
  focusCanvasToken,
  onCreateChild,
  onCreateSibling,
  onDeleteTask,
  onReorderSiblings,
  onRenameCancel,
  onRenameChange,
  onRenameCommit,
  onRenameStart,
  onSelectTask,
  onToggleCollapse,
  readOnly,
  root,
  selectedTaskId,
}: TaskMindmapProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const handlersRef = useRef({
    onRenameCancel,
    onRenameChange,
    onRenameCommit,
    onRenameStart,
    onSelectTask,
    onToggleCollapse,
  });
  const layout = useMemo(() => buildMindmapLayout(root, collapsedTaskIds, LAYOUT_OPTIONS), [collapsedTaskIds, root]);
  const taskMap = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node.task])), [layout.nodes]);
  const layoutNodeMap = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);
  const directionMap = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node.direction])), [layout.nodes]);
  const visibleNodeIdSet = useMemo(() => new Set(layout.visibleNodeIds), [layout.visibleNodeIds]);
  const toneMap = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, toneByStatus(node.task)])),
    [layout.nodes],
  );

  useEffect(() => {
    handlersRef.current = {
      onRenameCancel,
      onRenameChange,
      onRenameCommit,
      onRenameStart,
      onSelectTask,
      onToggleCollapse,
    };
  }, [onRenameCancel, onRenameChange, onRenameCommit, onRenameStart, onSelectTask, onToggleCollapse]);

  const focusCanvas = useCallback(() => {
    canvasRef.current?.focus({ preventScroll: true });
  }, []);

  const handleNodeRenameCancel = useCallback(() => {
    handlersRef.current.onRenameCancel();
  }, []);

  const handleNodeRenameChange = useCallback((title: string) => {
    handlersRef.current.onRenameChange(title);
  }, []);

  const handleNodeRenameCommit = useCallback((taskId: string, title: string) => {
    handlersRef.current.onRenameCommit(taskId, title);
  }, []);

  const handleNodeRenameStart = useCallback((taskId: string) => {
    handlersRef.current.onRenameStart(taskId);
  }, []);

  const handleNodeSelect = useCallback((taskId: string) => {
    handlersRef.current.onSelectTask(taskId);
  }, []);

  const handleNodeToggleCollapse = useCallback((taskId: string) => {
    handlersRef.current.onToggleCollapse(taskId);
  }, []);

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: { id: string; position: { y: number } }) => {
      if (!allowReorder) {
        return;
      }

      const draggedTask = taskMap.get(node.id);
      if (!draggedTask || draggedTask.node_kind === "system_root" || !draggedTask.parent_id) {
        return;
      }

      const parentTask = taskMap.get(draggedTask.parent_id);
      if (!parentTask) {
        return;
      }

      const draggedDirection = directionMap.get(draggedTask.id) ?? "center";
      const sameBranchIds = parentTask.children.filter((child) => directionMap.get(child.id) === draggedDirection).map((child) => child.id);

      if (sameBranchIds.length < 2) {
        return;
      }

      const branchOrder = sameBranchIds
        .map((childId) => ({
          id: childId,
          y: childId === draggedTask.id ? node.position.y : (layoutNodeMap.get(childId)?.y ?? 0),
        }))
        .sort((left, right) => left.y - right.y)
        .map((item) => item.id);

      if (branchOrder.every((childId, index) => childId === sameBranchIds[index])) {
        return;
      }

      let branchCursor = 0;
      const orderedTaskIds = parentTask.children.map((child) => {
        if (directionMap.get(child.id) === draggedDirection) {
          const nextChildId = branchOrder[branchCursor];
          branchCursor += 1;
          return nextChildId;
        }

        return child.id;
      });

      onReorderSiblings(parentTask.id, orderedTaskIds);
    },
    [allowReorder, directionMap, layoutNodeMap, onReorderSiblings, taskMap],
  );

  const handleNodeClick = useCallback(
    (event: ReactMouseEvent<Element>, node: { id: string }) => {
      if ("button" in event && !isPrimaryButton(event)) {
        return;
      }

      handleNodeSelect(node.id);
    },
    [handleNodeSelect],
  );

  const handleNodeDoubleClick = useCallback(
    (_event: ReactMouseEvent<Element>, node: { id: string }) => {
      if (!readOnly) {
        handleNodeRenameStart(node.id);
      }
    },
    [handleNodeRenameStart, readOnly],
  );

  useEffect(() => {
    if (!focusCanvasToken) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      focusCanvas();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusCanvas, focusCanvasToken]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (isTypingTarget(event.target) || !selectedTaskId) {
        return;
      }

      const selectedTask = taskMap.get(selectedTaskId);
      if (!selectedTask) {
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        if (!readOnly) {
          onCreateChild(selectedTask.id);
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        if (!readOnly) {
          onCreateSibling(selectedTask.id);
        }
        return;
      }

      if (event.key === "F2") {
        event.preventDefault();
        if (!readOnly) {
          onRenameStart(selectedTask.id);
        }
        return;
      }

      if ((event.key === "Backspace" || event.key === "Delete") && !readOnly && selectedTask.node_kind !== "system_root") {
        event.preventDefault();
        onDeleteTask(selectedTask.id);
        return;
      }

      const visibleChildren = selectedTask.children.filter((child) => visibleNodeIdSet.has(child.id));

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const parent = selectedTask.parent_id ? taskMap.get(selectedTask.parent_id) : null;
        const siblings = parent
          ? parent.children.filter((child) => visibleNodeIdSet.has(child.id))
          : [selectedTask];
        const index = siblings.findIndex((sibling) => sibling.id === selectedTask.id);
        const offset = event.key === "ArrowUp" ? -1 : 1;
        const nextSibling = siblings[index + offset];
        if (nextSibling) {
          onSelectTask(nextSibling.id);
        }
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (selectedTask.parent_id) {
          onSelectTask(selectedTask.parent_id);
        }
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        const firstChild = visibleChildren[0];
        if (firstChild) {
          onSelectTask(firstChild.id);
        }
      }
    },
    [
      onCreateChild,
      onCreateSibling,
      onDeleteTask,
      onRenameStart,
      onSelectTask,
      readOnly,
      selectedTaskId,
      taskMap,
      visibleNodeIdSet,
    ],
  );

  const nodes = useMemo<TaskCanvasFlowNode[]>(
    () =>
      layout.nodes.map((node) => ({
        id: node.id,
        type: "taskNode",
        position: { x: node.x, y: node.y },
        data: {
          collapsed: node.collapsed,
          direction: node.direction,
          editingTitle,
          hasChildren: node.hasChildren,
          isEditing: editingTaskId === node.id,
          onRenameCancel: handleNodeRenameCancel,
          onRenameChange: handleNodeRenameChange,
          onRenameCommit: handleNodeRenameCommit,
          onRenameStart: handleNodeRenameStart,
          onSelectTask: handleNodeSelect,
          onToggleCollapse: handleNodeToggleCollapse,
          readOnly,
          selected: selectedTaskId === node.id,
          task: node.task,
        },
        dragHandle: ".mindmap-node-drag-handle",
        draggable: allowReorder && editingTaskId !== node.id && node.task.node_kind !== "system_root",
        selectable: false,
        style: {
          width: node.task.node_kind === "system_root" ? ROOT_NODE_WIDTH : NODE_WIDTH,
          background: "transparent",
          border: "none",
        },
        zIndex: selectedTaskId === node.id ? 20 : 1,
      })),
    [
      editingTaskId,
      editingTitle,
      handleNodeRenameCancel,
      handleNodeRenameChange,
      handleNodeRenameCommit,
      handleNodeRenameStart,
      handleNodeSelect,
      handleNodeToggleCollapse,
      layout.nodes,
      allowReorder,
      readOnly,
      selectedTaskId,
    ],
  );

  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map((edge) => {
        const tone = toneMap.get(edge.target) ?? toneMap.get(edge.source);
        return {
          id: edge.id,
          type: "mindmapEdge",
          source: edge.source,
          sourceHandle: edge.direction === "left" ? "left-source" : "right-source",
          target: edge.target,
          targetHandle: edge.direction === "left" ? "right-target" : "left-target",
          animated: edge.status === "pending_review",
          style: {
            stroke: tone?.accent ?? "#9cc4ff",
            strokeWidth: edge.matchedFilter ? 2.2 : 1.55,
            opacity: edge.matchedFilter ? 0.88 : 0.38,
          },
        };
      }),
    [layout.edges, toneMap],
  );
  const selectedLayoutNode = useMemo(() => {
    if (!selectedTaskId) {
      return null;
    }

    const node = layout.nodes.find((item) => item.id === selectedTaskId);
    if (!node) {
      return null;
    }

    return {
      id: node.id,
      width: node.task.node_kind === "system_root" ? ROOT_NODE_WIDTH : NODE_WIDTH,
      x: node.x,
      y: node.y,
    };
  }, [layout.nodes, selectedTaskId]);

  return (
    <div
      ref={canvasRef}
      className="relative h-[68vh] min-h-[560px] overflow-hidden rounded-[22px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(8,11,19,0.98),rgba(5,7,14,0.96))] outline-none xl:h-[calc(100vh-14rem)]"
      data-testid="task-mindmap-canvas"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
      onMouseDownCapture={(event) => {
        if (isTypingTarget(event.target)) {
          return;
        }

        focusCanvas();
      }}
      tabIndex={0}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-3 border-b border-white/[0.06] bg-[linear-gradient(180deg,rgba(7,10,17,0.96),rgba(7,10,17,0.84),transparent)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/32">Mind Map</p>
          <p className="mt-1 text-sm text-white/70">点击节点后可连续使用 Tab / Enter / Delete，不会被详情面板抢走焦点</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.18em] text-white/34">
          <span className="rounded-full border border-emerald-400/20 px-2 py-1 text-emerald-200/80">完成</span>
          <span className="rounded-full border border-amber-400/20 px-2 py-1 text-amber-100/80">待验证</span>
          <span className="rounded-full border border-sky-400/20 px-2 py-1 text-sky-100/80">进行中</span>
          <span className="rounded-full border border-rose-400/20 px-2 py-1 text-rose-100/80">终止</span>
        </div>
      </div>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(45,92,196,0.12),transparent_30%),radial-gradient(circle_at_top_left,rgba(101,163,255,0.08),transparent_25%),radial-gradient(circle_at_bottom_right,rgba(52,211,153,0.06),transparent_22%)]" />

      <ReactFlow
        edges={edges}
        elementsSelectable={false}
        edgeTypes={edgeTypes}
        maxZoom={1.25}
        minZoom={0.28}
        nodeTypes={nodeTypes}
        nodes={nodes}
        nodeDragThreshold={8}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStop={handleNodeDragStop}
        nodesConnectable={false}
        nodesDraggable={allowReorder}
        onlyRenderVisibleElements
        panOnDrag={[2]}
        panOnScroll
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
      >
        <Background color="rgba(142, 163, 210, 0.12)" gap={22} size={1} variant={BackgroundVariant.Dots} />
        <AutoFitView fitViewToken={fitViewToken} />
        <AutoCenterSelectedNode selectedNode={selectedLayoutNode} />
      </ReactFlow>
    </div>
  );
}
