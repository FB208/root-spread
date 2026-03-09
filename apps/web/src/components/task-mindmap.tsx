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

const NODE_WIDTH = 258;
const NODE_HEIGHT = 148;
const HORIZONTAL_GAP = 302;
const VERTICAL_GAP = 28;
const ROOT_GAP = 52;

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
      className={`group rounded-[20px] border px-4 py-3 text-left shadow-[0_18px_44px_rgba(0,0,0,0.28)] transition duration-200 ${
        selected
          ? "border-white/16 bg-[linear-gradient(180deg,rgba(18,24,40,0.98),rgba(12,16,29,0.96))]"
          : task.matched_filter
            ? "border-white/[0.08] bg-[linear-gradient(180deg,rgba(15,19,31,0.96),rgba(11,14,24,0.9))]"
            : "border-dashed border-white/[0.06] bg-[linear-gradient(180deg,rgba(13,17,28,0.84),rgba(9,12,21,0.82))]"
      }`}
      onClick={() => onSelectTask(task.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectTask(task.id);
        }
      }}
      role="button"
      style={{ boxShadow: selected ? `0 0 0 1px ${accent}44, 0 18px 48px rgba(0,0,0,0.34), 0 0 28px ${accent}18` : undefined }}
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: accent, boxShadow: `0 0 12px ${accent}` }}
          />
          <span className="text-[10px] uppercase tracking-[0.2em] text-white/34">
            {task.depth === 0 ? "root task" : `depth ${task.depth}`}
          </span>
          {hasChildren ? (
            <button
              className="inline-flex h-5.5 w-5.5 items-center justify-center rounded-lg border border-white/[0.08] text-white/58 transition hover:border-white/[0.16] hover:text-white"
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
        <div className="relative flex items-center gap-1.5">
          <span className="rounded-full border border-white/[0.08] px-2 py-1 text-[10px] text-white/68">
            {statusLabel(task.status)}
          </span>
          <button
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] text-white/62 transition hover:border-white/[0.16] hover:text-white"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((current) => !current);
            }}
            type="button"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-9 z-20 min-w-44 rounded-[14px] border border-white/[0.08] bg-[#0d111a] p-1.5 shadow-[0_18px_60px_rgba(0,0,0,0.42)]">
              <button
                className="flex w-full items-center rounded-[10px] px-3 py-2 text-left text-sm text-white/76 transition hover:bg-white/[0.05] hover:text-white"
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
                className="flex w-full items-center rounded-[10px] px-3 py-2 text-left text-sm text-white/76 transition hover:bg-white/[0.05] hover:text-white"
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
                  className="flex w-full items-center rounded-[10px] px-3 py-2 text-left text-sm text-white/76 transition hover:bg-white/[0.05] hover:text-white"
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
                      className="flex w-full items-center rounded-[10px] px-3 py-2 text-left text-sm text-white/76 transition hover:bg-white/[0.05] hover:text-white"
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

      <div className="mt-3 space-y-2">
        <h3 className="text-[15px] font-semibold leading-6 text-white/92">{task.title}</h3>
        <p className="line-clamp-2 text-[13px] leading-5 text-[#9ba9cf]">{textPreview(task.content_markdown)}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 text-[11px] text-white/54">
        <span className="rounded-full border border-white/[0.08] px-2 py-1">权重 {task.weight}</span>
        <span className="rounded-full border border-white/[0.08] px-2 py-1">评分 {task.score ?? "-"}</span>
        <span className="rounded-full border border-white/[0.08] px-2 py-1">
          子任务 {hasChildren ? (collapsed ? "已折叠" : task.children.length) : 0}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
        <div className="flex items-center gap-2 text-[11px] text-white/44">
          <Target className="h-3 w-3" />
          <span>
            {task.planned_due_at
              ? `截止 ${new Date(task.planned_due_at).toLocaleDateString("zh-CN")}`
              : "未设置截止时间"}
          </span>
        </div>
        <button
          className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[11px] text-white/72 transition hover:border-white/[0.16] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
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
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.08] pt-3">
          {(["in_progress", "pending_review", "completed"] as TaskStatus[]).map((status) => (
            <button
              key={status}
              className={`rounded-lg border px-2.5 py-1 text-[11px] transition ${
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
    <div className="relative h-[62vh] min-h-[460px] overflow-hidden rounded-[16px] border border-white/[0.06] bg-[linear-gradient(180deg,rgba(9,12,21,0.96),rgba(8,10,18,0.94))] xl:h-[calc(100vh-17rem)] xl:min-h-[620px]">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-3 border-b border-white/[0.06] bg-[linear-gradient(180deg,rgba(8,10,17,0.96),rgba(8,10,17,0.78),transparent)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Mind Map Canvas</p>
          <p className="mt-1 text-sm text-white/70">拖动画布浏览节点，滚轮缩放，点击节点聚焦并快捷创建子任务</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.18em] text-white/34">
          <span className="rounded-full border border-white/[0.08] px-2 py-1">react flow</span>
          <span className="rounded-full border border-white/[0.08] px-2 py-1">workspace map</span>
        </div>
      </div>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(139,144,255,0.12),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(91,192,255,0.08),transparent_24%)]" />

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
