"use client";

import {
  Background,
  BackgroundVariant,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  useReactFlow,
} from "@xyflow/react";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { TaskStatus, TaskTreeNode } from "@/lib/api";

type TaskMindmapProps = {
  collapsedTaskIds: Set<string>;
  onQuickStatus: (taskId: string, status: TaskStatus) => void;
  onToggleCollapse: (taskId: string) => void;
  taskIndex: Map<string, TaskTreeNode>;
  tree: TaskTreeNode[];
  readOnly: boolean;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onStartCreateChild: (taskId: string, title: string) => void;
};

type TaskCanvasNodeData = {
  collapsed: boolean;
  hasChildren: boolean;
  readOnly: boolean;
  task: TaskTreeNode;
  selected: boolean;
  onSelectTask: (taskId: string) => void;
  onQuickStatus: (taskId: string, status: TaskStatus) => void;
  onStartCreateChild: (taskId: string, title: string) => void;
  onToggleCollapse: (taskId: string) => void;
};

type TaskCanvasFlowNode = Node<TaskCanvasNodeData, "taskNode">;

const NODE_WIDTH = 290;
const NODE_HEIGHT = 168;
const HORIZONTAL_GAP = 340;
const VERTICAL_GAP = 36;
const ROOT_GAP = 72;

function statusLabel(status: TaskStatus) {
  switch (status) {
    case "completed":
      return "已完成";
    case "pending_review":
      return "待验证";
    case "terminated":
      return "终止";
    default:
      return "进行中";
  }
}

function statusColor(status: TaskStatus) {
  switch (status) {
    case "completed":
      return "#34d399";
    case "pending_review":
      return "#fbbf24";
    case "terminated":
      return "#fb7185";
    default:
      return "#7aa2ff";
  }
}

function textPreview(content: string) {
  const normalized = content.replace(/[#*_`>-]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "点击节点后可继续添加子任务、调整视图筛选或创建里程碑。";
  }

  return normalized.length > 72 ? `${normalized.slice(0, 72)}...` : normalized;
}

function subtreeHeight(node: TaskTreeNode): number {
  if (!node.children.length) {
    return NODE_HEIGHT;
  }

  const childrenHeight = node.children.reduce((total, child, index) => {
    return total + subtreeHeight(child) + (index > 0 ? VERTICAL_GAP : 0);
  }, 0);

  return Math.max(NODE_HEIGHT, childrenHeight);
}

function layoutTree(
  taskIndex: Map<string, TaskTreeNode>,
  tree: TaskTreeNode[],
  collapsedTaskIds: Set<string>,
  selectedTaskId: string | null,
  callbacks: Pick<
    TaskCanvasNodeData,
    "onQuickStatus" | "onSelectTask" | "onStartCreateChild" | "onToggleCollapse" | "readOnly"
  >,
) {
  const nodes: TaskCanvasFlowNode[] = [];
  const edges: Edge[] = [];

  function visit(node: TaskTreeNode, depth: number, startY: number, parentId: string | null) {
    const blockHeight = subtreeHeight(node);
    const nodeY = startY + blockHeight / 2 - NODE_HEIGHT / 2;
    const nodeX = 48 + depth * HORIZONTAL_GAP;
    const color = statusColor(node.status);
    const rawTask = taskIndex.get(node.id) ?? node;
    const hasChildren = rawTask.children.length > 0;

    nodes.push({
      id: node.id,
      type: "taskNode",
      position: { x: nodeX, y: nodeY },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        collapsed: collapsedTaskIds.has(node.id),
        hasChildren,
        readOnly: callbacks.readOnly,
        task: node,
        selected: selectedTaskId === node.id,
        onSelectTask: callbacks.onSelectTask,
        onQuickStatus: callbacks.onQuickStatus,
        onStartCreateChild: callbacks.onStartCreateChild,
        onToggleCollapse: callbacks.onToggleCollapse,
      },
      draggable: false,
      selectable: false,
      style: {
        width: NODE_WIDTH,
        background: "transparent",
        border: "none",
      },
    });

    if (parentId) {
      edges.push({
        id: `${parentId}->${node.id}`,
        source: parentId,
        target: node.id,
        animated: node.status === "pending_review",
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: {
          stroke: color,
          strokeWidth: 1.35,
          opacity: node.matched_filter ? 0.88 : 0.32,
        },
      });
    }

    let childY = startY;
    node.children.forEach((child) => {
      const childHeight = subtreeHeight(child);
      visit(child, depth + 1, childY, node.id);
      childY += childHeight + VERTICAL_GAP;
    });
  }

  let currentY = 48;
  tree.forEach((root) => {
    const rootHeight = subtreeHeight(root);
    visit(root, 0, currentY, null);
    currentY += rootHeight + ROOT_GAP;
  });

  return { nodes, edges };
}

function layoutSignature(tree: TaskTreeNode[]) {
  const parts: string[] = [];

  function collect(nodes: TaskTreeNode[]) {
    nodes.forEach((node) => {
      parts.push(`${node.id}:${node.status}:${node.children.length}:${node.matched_filter ? 1 : 0}`);
      collect(node.children);
    });
  }

  collect(tree);
  return parts.join("|");
}

function TaskCanvasNode({ data }: NodeProps<TaskCanvasFlowNode>) {
  const {
    collapsed,
    hasChildren,
    readOnly,
    task,
    selected,
    onSelectTask,
    onQuickStatus,
    onStartCreateChild,
    onToggleCollapse,
  } = data;
  const accent = statusColor(task.status);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={`group rounded-[26px] border px-5 py-4 text-left shadow-[0_24px_80px_rgba(0,0,0,0.38)] transition duration-200 ${
        selected
          ? "border-white/20 bg-[linear-gradient(180deg,rgba(16,24,48,0.98),rgba(10,16,34,0.94))]"
          : task.matched_filter
            ? "border-white/[0.1] bg-[linear-gradient(180deg,rgba(10,16,34,0.92),rgba(7,11,24,0.88))]"
            : "border-dashed border-white/[0.08] bg-[linear-gradient(180deg,rgba(9,14,28,0.72),rgba(7,11,24,0.68))]"
      }`}
      onClick={() => onSelectTask(task.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectTask(task.id);
        }
      }}
      role="button"
      style={{ boxShadow: selected ? `0 0 0 1px ${accent}55, 0 24px 80px rgba(0,0,0,0.42), 0 0 42px ${accent}22` : undefined }}
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: accent, boxShadow: `0 0 16px ${accent}` }}
          />
          <span className="text-[11px] uppercase tracking-[0.24em] text-white/38">
            {task.depth === 0 ? "root task" : `depth ${task.depth}`}
          </span>
          {hasChildren ? (
            <button
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/[0.1] text-white/65 transition hover:border-white/[0.2] hover:text-white"
              onClick={(event) => {
                event.stopPropagation();
                onToggleCollapse(task.id);
              }}
              type="button"
            >
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          ) : null}
        </div>
        <div className="relative flex items-center gap-2">
          <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/72">
            {statusLabel(task.status)}
          </span>
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] text-white/68 transition hover:border-white/[0.18] hover:text-white"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((current) => !current);
            }}
            type="button"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-10 z-20 min-w-44 rounded-2xl border border-white/[0.08] bg-[#081120] p-2 shadow-[0_18px_60px_rgba(0,0,0,0.42)]">
              <button
                className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-white/76 transition hover:bg-white/[0.05] hover:text-white"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectTask(task.id);
                  setMenuOpen(false);
                }}
                type="button"
              >
                聚焦当前节点
              </button>
              <button
                className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-white/76 transition hover:bg-white/[0.05] hover:text-white"
                onClick={(event) => {
                  event.stopPropagation();
                  onStartCreateChild(task.id, task.title);
                  setMenuOpen(false);
                }}
                type="button"
              >
                创建子任务
              </button>
              {hasChildren ? (
                <button
                  className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-white/76 transition hover:bg-white/[0.05] hover:text-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleCollapse(task.id);
                    setMenuOpen(false);
                  }}
                  type="button"
                >
                  {collapsed ? "展开当前子树" : "折叠当前子树"}
                </button>
              ) : null}
              {!readOnly ? (
                <>
                  <div className="my-2 border-t border-white/[0.08]" />
                  {(["in_progress", "pending_review", "completed", "terminated"] as TaskStatus[]).map((status) => (
                    <button
                      key={status}
                      className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-white/76 transition hover:bg-white/[0.05] hover:text-white"
                      onClick={(event) => {
                        event.stopPropagation();
                        onQuickStatus(task.id, status);
                        setMenuOpen(false);
                      }}
                      type="button"
                    >
                      快捷设为{statusLabel(status)}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <h3 className="text-base font-semibold leading-7 text-white/92">{task.title}</h3>
        <p className="line-clamp-2 text-sm leading-6 text-[#9ba9cf]">{textPreview(task.content_markdown)}</p>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 text-xs text-white/58">
        <span className="rounded-full border border-white/8 px-2.5 py-1">权重 {task.weight}</span>
        <span className="rounded-full border border-white/8 px-2.5 py-1">评分 {task.score ?? "-"}</span>
        <span className="rounded-full border border-white/8 px-2.5 py-1">
          子任务 {hasChildren ? (collapsed ? "已折叠" : task.children.length) : 0}
        </span>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.08] pt-4">
        <div className="flex items-center gap-2 text-xs text-white/46">
          <Target className="h-3.5 w-3.5" />
          <span>
            {task.planned_due_at
              ? `截止 ${new Date(task.planned_due_at).toLocaleDateString("zh-CN")}`
              : "未设置截止时间"}
          </span>
        </div>
        <button
          className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/76 transition hover:border-white/22 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          disabled={readOnly}
          onClick={(event) => {
            event.stopPropagation();
            onStartCreateChild(task.id, task.title);
          }}
          type="button"
        >
          <Plus className="h-3.5 w-3.5" />
          {readOnly ? "历史视图" : "子任务"}
        </button>
      </div>

      {!readOnly ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.08] pt-4">
          {(["in_progress", "pending_review", "completed"] as TaskStatus[]).map((status) => (
            <button
              key={status}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                task.status === status
                  ? "border-white/20 bg-white/10 text-white"
                  : "border-white/8 text-white/62 hover:border-white/18 hover:text-white"
              }`}
              onClick={(event) => {
                event.stopPropagation();
                onQuickStatus(task.id, status);
              }}
              type="button"
            >
              {statusLabel(status)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  taskNode: TaskCanvasNode,
};

function AutoFitView({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void fitView({ duration: 260, padding: 0.16, minZoom: 0.35, maxZoom: 1.2 });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [fitView, signature]);

  return null;
}

export function TaskMindmap({
  collapsedTaskIds,
  onQuickStatus,
  onToggleCollapse,
  taskIndex,
  tree,
  readOnly,
  selectedTaskId,
  onSelectTask,
  onStartCreateChild,
}: TaskMindmapProps) {
  const signature = useMemo(() => layoutSignature(tree), [tree]);
  const { nodes, edges } = useMemo(
    () =>
      layoutTree(taskIndex, tree, collapsedTaskIds, selectedTaskId, {
        onQuickStatus,
        onSelectTask,
        onStartCreateChild,
        onToggleCollapse,
        readOnly,
      }),
    [
      taskIndex,
      tree,
      collapsedTaskIds,
      selectedTaskId,
      onQuickStatus,
      onSelectTask,
      onStartCreateChild,
      onToggleCollapse,
      readOnly,
    ],
  );

  return (
    <div className="relative h-[620px] overflow-hidden rounded-[26px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(8,12,26,0.9),rgba(6,10,22,0.86))] sm:h-[700px] xl:h-[760px]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-3 border-b border-white/[0.06] bg-[linear-gradient(180deg,rgba(5,8,20,0.92),rgba(5,8,20,0.62),transparent)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-white/38">mind map canvas</p>
          <p className="mt-1 text-sm text-white/72">拖动画布浏览节点，滚轮缩放，点击节点聚焦并快捷创建子任务</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.22em] text-white/38">
          <span className="rounded-full border border-white/10 px-2 py-1">react flow</span>
          <span className="rounded-full border border-white/10 px-2 py-1">workspace map</span>
        </div>
      </div>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(122,162,255,0.12),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(139,92,246,0.12),transparent_26%)]" />

      <ReactFlow
        edges={edges}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.16 }}
        maxZoom={1.35}
        minZoom={0.3}
        nodeTypes={nodeTypes}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        panOnDrag
        panOnScroll
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
      >
        <Background color="rgba(147, 161, 203, 0.14)" gap={24} size={1} variant={BackgroundVariant.Dots} />
        <AutoFitView signature={signature} />
      </ReactFlow>
    </div>
  );
}
