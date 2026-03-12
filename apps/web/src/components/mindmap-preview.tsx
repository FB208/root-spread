"use client";

import {
  Background,
  BackgroundVariant,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { ReactivePanel } from "@/components/reactive-panel";

type PreviewNodeProps = {
  accent: string;
  delay?: string;
  title: string;
  meta: string;
  value: string;
};

function PreviewNode({ accent, delay, title, meta, value }: PreviewNodeProps) {
  return (
    <div
      className="preview-node min-w-[204px] rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,13,30,0.96),rgba(12,18,38,0.92))] px-3.5 py-2.5 text-left shadow-[0_16px_40px_rgba(0,0,0,0.3)]"
      style={delay ? { animationDelay: delay } : undefined}
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span
          className="preview-node-dot h-2 w-2 rounded-full"
          style={{ backgroundColor: accent, boxShadow: `0 0 16px ${accent}` }}
        />
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.24em] text-white/45">
          {meta}
        </span>
      </div>
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Node</p>
        <h3 className="text-sm font-semibold text-white/90">{title}</h3>
        <p className="text-[11px] text-[#9ba9cf]">{value}</p>
      </div>
    </div>
  );
}

const nodes: Node[] = [
  {
    id: "root",
    position: { x: 250, y: 138 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      label: (
        <PreviewNode
          accent="#7aa2ff"
          delay="0ms"
          title="RootSpread Workspace"
          meta="root"
          value="任务树、表格、里程碑共享同一套节点模型"
        />
      ),
    },
    style: { background: "transparent", border: "none", width: 232 },
  },
  {
    id: "auth",
    position: { x: 610, y: 26 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      label: (
        <PreviewNode
          accent="#4ade80"
          delay="240ms"
          title="账号与权限"
          meta="auth"
          value="邮箱注册、Resend 验证、团队邀请与角色管理"
        />
      ),
    },
    style: { background: "transparent", border: "none", width: 232 },
  },
  {
    id: "tasks",
    position: { x: 610, y: 150 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      label: (
        <PreviewNode
          accent="#8b5cf6"
          delay="420ms"
          title="任务节点"
          meta="core"
          value="状态联动、负责人、评分、截止时间、同级排序"
        />
      ),
    },
    style: { background: "transparent", border: "none", width: 232 },
  },
  {
    id: "milestones",
    position: { x: 610, y: 274 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      label: (
        <PreviewNode
          accent="#fb7185"
          delay="640ms"
          title="里程碑视图"
          meta="history"
          value="主工作台可切换里程碑，并查看归档快照"
        />
      ),
    },
    style: { background: "transparent", border: "none", width: 232 },
  },
];

const edges: Edge[] = [
  {
    id: "root-auth",
    source: "root",
    target: "auth",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#7aa2ff" },
    style: { stroke: "#7aa2ff", strokeWidth: 1.25 },
  },
  {
    id: "root-tasks",
    source: "root",
    target: "tasks",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#8b5cf6" },
    style: { stroke: "#8b5cf6", strokeWidth: 1.25 },
  },
  {
    id: "root-milestones",
    source: "root",
    target: "milestones",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#fb7185" },
    style: { stroke: "#fb7185", strokeWidth: 1.25 },
  },
];

export function MindmapPreview() {
  return (
    <ReactivePanel
      className="panel preview-panel relative h-[410px] overflow-hidden rounded-[22px] p-0 breathe-card"
      rotationLimit={5}
      style={{ animationDelay: "180ms" }}
    >
      <div aria-hidden className="preview-ambient preview-ambient-one" />
      <div aria-hidden className="preview-ambient preview-ambient-two" />
      <div aria-hidden className="preview-grid-halo" />
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-white/[0.08] bg-[linear-gradient(180deg,rgba(5,8,20,0.96),rgba(5,8,20,0.88),rgba(5,8,20,0.62))] px-4 py-3 backdrop-blur-md">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">
            live canvas preview
          </p>
          <p className="mt-1 text-[13px] font-medium text-white/75">
            项目、任务、里程碑在同一张地图上协同
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-white/35">
          <span className="compact-chip">mind map</span>
          <span className="compact-chip">table</span>
        </div>
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(122,162,255,0.12),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(139,92,246,0.12),transparent_30%)]" />
      <div className="preview-flow-shell absolute inset-x-0 top-[10px] bottom-[-18px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            color="rgba(147, 161, 203, 0.12)"
            gap={22}
            size={1}
            variant={BackgroundVariant.Dots}
          />
        </ReactFlow>
      </div>
    </ReactivePanel>
  );
}
