"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  type MessageResponse,
  type Milestone,
  type MilestoneTreeResponse,
  type TaskStatus,
  type TaskTreeNode,
  type WorkspaceInvitation,
  type WorkspaceItem,
  type WorkspaceMember,
  apiRequest,
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth-storage";
import { TaskDetailPanel } from "@/components/task-detail-panel";
import { TaskMindmap } from "@/components/task-mindmap";
import { WorkspaceMembersPanel } from "@/components/workspace-members-panel";

type WorkspaceWorkbenchProps = {
  workspaceId: string;
};

type ViewMode = "tree" | "table";

const statusOptions: Array<{ label: string; value: TaskStatus }> = [
  { label: "进行中", value: "in_progress" },
  { label: "待验证", value: "pending_review" },
  { label: "已完成", value: "completed" },
  { label: "终止", value: "terminated" },
];

function statusLabel(status: TaskStatus) {
  return statusOptions.find((item) => item.value === status)?.label ?? status;
}

function statusTone(status: TaskStatus) {
  switch (status) {
    case "completed":
      return "border-emerald-400/25 bg-emerald-400/10 text-emerald-100";
    case "pending_review":
      return "border-amber-400/25 bg-amber-400/10 text-amber-100";
    case "terminated":
      return "border-rose-400/25 bg-rose-400/10 text-rose-100";
    default:
      return "border-sky-400/25 bg-sky-400/10 text-sky-100";
  }
}

function buildStatusQuery(selectedStatuses: TaskStatus[]) {
  if (!selectedStatuses.length) {
    return "";
  }

  const params = new URLSearchParams();
  selectedStatuses.forEach((status) => params.append("status", status));
  return `?${params.toString()}`;
}

function flattenTree(nodes: TaskTreeNode[]): Array<TaskTreeNode & { level: number }> {
  const result: Array<TaskTreeNode & { level: number }> = [];

  function walk(currentNodes: TaskTreeNode[], level: number) {
    currentNodes.forEach((node) => {
      result.push({ ...node, level });
      walk(node.children, level + 1);
    });
  }

  walk(nodes, 0);
  return result;
}

function createTaskIndex(nodes: TaskTreeNode[]) {
  const index = new Map<string, TaskTreeNode>();

  function walk(currentNodes: TaskTreeNode[]) {
    currentNodes.forEach((node) => {
      index.set(node.id, node);
      walk(node.children);
    });
  }

  walk(nodes);
  return index;
}

function getSiblingTaskIds(
  tree: TaskTreeNode[],
  taskIndex: Map<string, TaskTreeNode>,
  parentId: string | null,
) {
  if (parentId) {
    return taskIndex.get(parentId)?.children.map((child) => child.id) ?? [];
  }

  return tree.map((node) => node.id);
}

function collapseTree(nodes: TaskTreeNode[], collapsedIds: Set<string>): TaskTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    children: collapsedIds.has(node.id) ? [] : collapseTree(node.children, collapsedIds),
  }));
}

function collectCollapsibleIds(nodes: TaskTreeNode[]) {
  const ids: string[] = [];

  function walk(currentNodes: TaskTreeNode[]) {
    currentNodes.forEach((node) => {
      if (node.children.length) {
        ids.push(node.id);
      }
      walk(node.children);
    });
  }

  walk(nodes);
  return ids;
}

function findTaskById(nodes: TaskTreeNode[], taskId: string | null): TaskTreeNode | null {
  if (!taskId) {
    return null;
  }

  for (const node of nodes) {
    if (node.id === taskId) {
      return node;
    }

    const child = findTaskById(node.children, taskId);
    if (child) {
      return child;
    }
  }

  return null;
}

export function WorkspaceWorkbench({ workspaceId }: WorkspaceWorkbenchProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string>("live");
  const [selectedStatuses, setSelectedStatuses] = useState<TaskStatus[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceItem | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tree, setTree] = useState<TaskTreeNode[]>([]);
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<string[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropTargetTaskId, setDropTargetTaskId] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [composeParentId, setComposeParentId] = useState<string | null>(null);
  const [composeParentTitle, setComposeParentTitle] = useState<string | null>(null);
  const [milestoneName, setMilestoneName] = useState("");
  const [milestoneDescription, setMilestoneDescription] = useState("");
  const [milestoneTargetAt, setMilestoneTargetAt] = useState("");
  const [submittingTask, setSubmittingTask] = useState(false);
  const [submittingMilestone, setSubmittingMilestone] = useState(false);

  const taskIndex = useMemo(() => createTaskIndex(tree), [tree]);
  const collapsedTaskIdSet = useMemo(() => new Set(collapsedTaskIds), [collapsedTaskIds]);
  const displayTree = useMemo(() => collapseTree(tree, collapsedTaskIdSet), [tree, collapsedTaskIdSet]);
  const flatTasks = useMemo(() => flattenTree(displayTree), [displayTree]);
  const statusQuery = useMemo(() => buildStatusQuery(selectedStatuses), [selectedStatuses]);
  const selectedTask = useMemo(() => findTaskById(tree, selectedTaskId), [selectedTaskId, tree]);
  const isHistoryView = selectedMilestoneId !== "live";

  const loadWorkbench = useCallback(async () => {
    const session = getStoredSession();
    if (!session?.access_token) {
      setError("请先登录，再打开工作空间。");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const treePromise =
        selectedMilestoneId === "live"
          ? apiRequest<TaskTreeNode[]>(`/workspaces/${workspaceId}/tasks/tree${statusQuery}`, {
              token: session.access_token,
            })
          : apiRequest<MilestoneTreeResponse>(
              `/workspaces/${workspaceId}/milestones/${selectedMilestoneId}/tree${statusQuery}`,
              { token: session.access_token },
            ).then((response) => response.tree);

      const [workspaces, membersResponse, invitationsResponse, milestonesResponse, treeResponse] = await Promise.all([
        apiRequest<WorkspaceItem[]>("/workspaces", { token: session.access_token }),
        apiRequest<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`, {
          token: session.access_token,
        }),
        apiRequest<WorkspaceInvitation[]>(`/workspaces/${workspaceId}/invitations`, {
          token: session.access_token,
        }).catch(() => []),
        apiRequest<Milestone[]>(`/workspaces/${workspaceId}/milestones`, {
          token: session.access_token,
        }),
        treePromise,
      ]);

      setWorkspace(workspaces.find((item) => item.id === workspaceId) ?? null);
      setMembers(membersResponse);
      setInvitations(invitationsResponse);
      setMilestones(milestonesResponse);
      setTree(treeResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载工作台失败。");
    } finally {
      setLoading(false);
    }
  }, [selectedMilestoneId, statusQuery, workspaceId]);

  useEffect(() => {
    void loadWorkbench();
  }, [loadWorkbench]);

  useEffect(() => {
    setCollapsedTaskIds((current) =>
      current.filter((taskId) => {
        const task = taskIndex.get(taskId);
        return Boolean(task && task.children.length);
      }),
    );
  }, [taskIndex]);

  useEffect(() => {
    if (!displayTree.length) {
      setSelectedTaskId(null);
      return;
    }

    if (!selectedTaskId || !findTaskById(displayTree, selectedTaskId)) {
      setSelectedTaskId(displayTree[0]?.id ?? null);
    }
  }, [displayTree, selectedTaskId]);

  useEffect(() => {
    const visibleTaskIds = new Set(flatTasks.map((task) => task.id));
    setSelectedTaskIds((current) => current.filter((taskId) => visibleTaskIds.has(taskId)));
  }, [flatTasks]);

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = getStoredSession();
    if (!session?.access_token || !taskTitle.trim()) {
      return;
    }

    if (isHistoryView) {
      setError("历史里程碑视图为只读，不能直接创建任务。");
      return;
    }

    try {
      setSubmittingTask(true);
      setError(null);
      await apiRequest(`/workspaces/${workspaceId}/tasks`, {
        method: "POST",
        token: session.access_token,
        json: {
          parent_id: composeParentId,
          title: taskTitle.trim(),
        },
      });
      setTaskTitle("");
      setComposeParentId(null);
      setComposeParentTitle(null);
      await loadWorkbench();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "创建任务失败。");
    } finally {
      setSubmittingTask(false);
    }
  }

  async function handleCreateMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = getStoredSession();
    if (!session?.access_token || !milestoneName.trim() || !milestoneTargetAt) {
      return;
    }

    try {
      setSubmittingMilestone(true);
      setError(null);
      const milestone = await apiRequest<Milestone>(`/workspaces/${workspaceId}/milestones`, {
        method: "POST",
        token: session.access_token,
        json: {
          name: milestoneName.trim(),
          description: milestoneDescription.trim() || null,
          target_at: new Date(milestoneTargetAt).toISOString(),
        },
      });
      setMilestoneName("");
      setMilestoneDescription("");
      setMilestoneTargetAt("");
      setSelectedMilestoneId(milestone.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "创建里程碑失败。");
    } finally {
      setSubmittingMilestone(false);
    }
  }

  function toggleStatus(status: TaskStatus) {
    setSelectedStatuses((current) =>
      current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
    );
  }

  function startCreateChild(parentId: string, title: string) {
    if (isHistoryView) {
      setError("历史里程碑视图为只读，不能在快照中创建子任务。");
      return;
    }

    setComposeParentId(parentId);
    setComposeParentTitle(title);
  }

  async function handleQuickStatus(taskId: string, status: TaskStatus) {
    const session = getStoredSession();
    if (!session?.access_token || isHistoryView) {
      return;
    }

    try {
      setError(null);
      await apiRequest(`/workspaces/${workspaceId}/tasks/${taskId}/status`, {
        method: "POST",
        token: session.access_token,
        json: { status },
      });
      await loadWorkbench();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "快捷状态更新失败。");
    }
  }

  function toggleTaskCollapse(taskId: string) {
    if (!taskIndex.get(taskId)?.children.length) {
      return;
    }

    setCollapsedTaskIds((current) =>
      current.includes(taskId) ? current.filter((item) => item !== taskId) : [...current, taskId],
    );
  }

  function collapseAllBranches() {
    setCollapsedTaskIds(collectCollapsibleIds(tree));
  }

  function expandAllBranches() {
    setCollapsedTaskIds([]);
  }

  function toggleTaskSelection(taskId: string) {
    setSelectedTaskIds((current) =>
      current.includes(taskId) ? current.filter((item) => item !== taskId) : [...current, taskId],
    );
  }

  function toggleAllVisibleTasks() {
    const visibleIds = flatTasks.map((task) => task.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((taskId) => selectedTaskIds.includes(taskId));
    setSelectedTaskIds(allSelected ? [] : visibleIds);
  }

  async function handleBulkStatus(status: TaskStatus) {
    const session = getStoredSession();
    if (!session?.access_token || !selectedTaskIds.length || isHistoryView) {
      return;
    }

    try {
      setError(null);
      await apiRequest<MessageResponse>(`/workspaces/${workspaceId}/tasks/bulk-status`, {
        method: "POST",
        token: session.access_token,
        json: { task_ids: selectedTaskIds, status },
      });
      setSelectedTaskIds([]);
      await loadWorkbench();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "批量状态更新失败。");
    }
  }

  async function handleBulkDelete() {
    const session = getStoredSession();
    if (!session?.access_token || !selectedTaskIds.length || isHistoryView) {
      return;
    }

    if (!window.confirm(`确认批量删除选中的 ${selectedTaskIds.length} 个任务吗？`)) {
      return;
    }

    try {
      setError(null);
      await apiRequest<MessageResponse>(`/workspaces/${workspaceId}/tasks/bulk-delete`, {
        method: "POST",
        token: session.access_token,
        json: { task_ids: selectedTaskIds },
      });
      setSelectedTaskIds([]);
      await loadWorkbench();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "批量删除失败。");
    }
  }

  async function handleReorderDrop(targetTaskId: string) {
    const session = getStoredSession();
    if (!session?.access_token || !draggingTaskId || draggingTaskId === targetTaskId || isHistoryView) {
      setDraggingTaskId(null);
      setDropTargetTaskId(null);
      return;
    }

    const draggedTask = taskIndex.get(draggingTaskId);
    const targetTask = taskIndex.get(targetTaskId);
    if (!draggedTask || !targetTask || draggedTask.parent_id !== targetTask.parent_id) {
      setDraggingTaskId(null);
      setDropTargetTaskId(null);
      return;
    }

    const siblingIds = getSiblingTaskIds(tree, taskIndex, draggedTask.parent_id).filter(
      (taskId) => taskId !== draggingTaskId,
    );
    const targetIndex = siblingIds.indexOf(targetTaskId);
    if (targetIndex === -1) {
      setDraggingTaskId(null);
      setDropTargetTaskId(null);
      return;
    }

    siblingIds.splice(targetIndex, 0, draggingTaskId);

    try {
      setError(null);
      await apiRequest<MessageResponse>(`/workspaces/${workspaceId}/tasks/reorder`, {
        method: "POST",
        token: session.access_token,
        json: {
          parent_id: draggedTask.parent_id,
          task_ids: siblingIds,
        },
      });
      await loadWorkbench();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "拖拽排序失败。");
    } finally {
      setDraggingTaskId(null);
      setDropTargetTaskId(null);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-6 py-10 sm:px-8 lg:px-12">
        <div className="panel rounded-[28px] px-8 py-6 text-sm text-white/72">正在加载任务工作台...</div>
      </main>
    );
  }

  if (!workspace) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-10 sm:px-8 lg:px-12">
        <div className="panel w-full rounded-[32px] p-8 sm:p-10">
          <p className="text-xs uppercase tracking-[0.34em] text-white/38">Workspace Workbench</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white">
            暂时无法读取工作空间
          </h1>
          <p className="mt-5 text-sm leading-8 text-text-muted sm:text-base">
            {error ?? "请先登录，或确认当前账号已经加入该工作空间。"}
          </p>
          <div className="mt-8 flex gap-3">
            <Link className="primary-button" href="/workspaces">
              返回空间列表
            </Link>
            <Link className="secondary-button" href="/auth/login">
              去登录
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 sm:px-8 lg:px-12">
      <header className="panel rounded-[32px] px-6 py-6 sm:px-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.34em] text-white/38">Workspace Workbench</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              {workspace.name}
            </h1>
            <p className="mt-3 text-sm leading-7 text-text-muted">
              角色：{workspace.role} · 成员 {members.length} 人 · 视图模式 {viewMode === "tree" ? "思维导图" : "表格"}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-3xl border border-white/[0.08] bg-white/[0.04] px-4 py-4">
              <p className="text-xs uppercase tracking-[0.24em] text-white/35">当前节点数</p>
              <p className="mt-3 text-xl font-semibold text-white/90">{flatTasks.length}</p>
            </div>
            <div className="rounded-3xl border border-white/[0.08] bg-white/[0.04] px-4 py-4">
              <p className="text-xs uppercase tracking-[0.24em] text-white/35">里程碑</p>
              <p className="mt-3 text-xl font-semibold text-white/90">{milestones.length}</p>
            </div>
            <div className="rounded-3xl border border-white/[0.08] bg-white/[0.04] px-4 py-4">
              <p className="text-xs uppercase tracking-[0.24em] text-white/35">当前视图</p>
              <p className="mt-3 text-xl font-semibold text-white/90">
                {selectedMilestoneId === "live" ? "当前任务" : "历史里程碑"}
              </p>
            </div>
            <Link className="rounded-3xl border border-white/[0.08] bg-white/[0.04] px-4 py-4 transition hover:border-white/[0.18] hover:bg-white/[0.06]" href={`/workspaces/${workspace.id}/stats`}>
              <p className="text-xs uppercase tracking-[0.24em] text-white/35">统计入口</p>
              <p className="mt-3 text-xl font-semibold text-white/90">查看统计</p>
            </Link>
          </div>
        </div>
      </header>

      <section className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="panel rounded-[28px] p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-white/38">Controls</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">
            主工作台切换与筛选
          </h2>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="milestone-select">
                当前视图
              </label>
              <select
                className="field-input"
                id="milestone-select"
                onChange={(event) => setSelectedMilestoneId(event.target.value)}
                value={selectedMilestoneId}
              >
                <option value="live">当前任务视图</option>
                {milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label">视图模式</label>
              <div className="flex gap-3">
                <button
                  className={viewMode === "tree" ? "primary-button" : "secondary-button"}
                  onClick={() => setViewMode("tree")}
                  type="button"
                >
                  思维导图
                </button>
                <button
                  className={viewMode === "table" ? "primary-button" : "secondary-button"}
                  onClick={() => setViewMode("table")}
                  type="button"
                >
                  表格视图
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <label className="field-label">状态筛选</label>
            <div className="flex flex-wrap gap-3">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  className={selectedStatuses.includes(option.value) ? "primary-button" : "secondary-button"}
                  onClick={() => toggleStatus(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <label className="field-label">节点展开控制</label>
            <div className="flex flex-wrap gap-3">
              <button className="secondary-button" onClick={expandAllBranches} type="button">
                全部展开
              </button>
              <button className="secondary-button" onClick={collapseAllBranches} type="button">
                折叠全部子树
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-white/38">Selected node</p>
            {selectedTask ? (
              <>
                <div className="mt-3 flex items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${statusTone(selectedTask.status)}`}>
                    {statusLabel(selectedTask.status)}
                  </span>
                  <span className="text-xs text-white/42">
                    {selectedTask.children.length} 个子任务 · 深度 {selectedTask.depth}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-white/88">{selectedTask.title}</h3>
                <p className="mt-3 text-sm leading-7 text-text-muted">
                  {selectedTask.content_markdown
                    ? selectedTask.content_markdown.replace(/[#*_`>-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140)
                    : "当前节点还没有补充描述内容。"}
                </p>
                <div className="mt-4 flex flex-wrap gap-3 text-xs text-white/56">
                  <span>权重 {selectedTask.weight}</span>
                  <span>评分 {selectedTask.score ?? "-"}</span>
                  <span>负责人 {selectedTask.assignee_user_id ?? "未分配"}</span>
                </div>
                <button
                  className="secondary-button mt-5"
                  disabled={isHistoryView}
                  onClick={() => startCreateChild(selectedTask.id, selectedTask.title)}
                  type="button"
                >
                  {isHistoryView ? "历史视图只读" : "以此节点新建子任务"}
                </button>
                {selectedTask.children.length ? (
                  <button
                    className="secondary-button mt-3"
                    onClick={() => toggleTaskCollapse(selectedTask.id)}
                    type="button"
                  >
                    {collapsedTaskIdSet.has(selectedTask.id) ? "展开当前子树" : "折叠当前子树"}
                  </button>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm text-text-muted">点击思维导图中的任意节点后，这里会显示当前聚焦节点信息。</p>
            )}
          </div>
        </div>

        <div className="grid gap-6">
          <div className="panel rounded-[28px] p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.28em] text-white/38">Quick compose</p>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">快速新建任务</h2>
            {composeParentTitle ? (
              <p className="mt-3 text-sm text-text-muted">当前会创建到节点：{composeParentTitle}</p>
            ) : (
              <p className="mt-3 text-sm text-text-muted">当前会创建为顶层任务。</p>
            )}

            {isHistoryView ? (
              <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                当前处于历史里程碑视图，只能查看快照，不能直接修改任务树。
              </div>
            ) : null}

            <form className="mt-6 flex flex-col gap-4 sm:flex-row" onSubmit={handleCreateTask}>
              <input
                className="field-input"
                disabled={isHistoryView}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder={composeParentTitle ? "输入子任务名称" : "输入任务名称"}
                value={taskTitle}
              />
              <button className="primary-button justify-center" disabled={submittingTask} type="submit">
                {submittingTask ? "创建中..." : composeParentTitle ? "创建子任务" : "创建任务"}
              </button>
            </form>

            {composeParentTitle ? (
              <button
                className="secondary-button mt-4"
                onClick={() => {
                  setComposeParentId(null);
                  setComposeParentTitle(null);
                }}
                type="button"
              >
                改回顶层任务
              </button>
            ) : null}
          </div>

          <div className="panel rounded-[28px] p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.28em] text-white/38">Milestone</p>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">创建里程碑并归档历史任务</h2>
            <form className="mt-6 grid gap-4 lg:grid-cols-[1fr_220px_auto]" onSubmit={handleCreateMilestone}>
              <input
                className="field-input"
                onChange={(event) => setMilestoneName(event.target.value)}
                placeholder="里程碑名称，例如 Sprint Alpha"
                value={milestoneName}
              />
              <textarea
                className="field-input min-h-[120px] resize-y lg:col-span-3"
                onChange={(event) => setMilestoneDescription(event.target.value)}
                placeholder="描述本次里程碑的归档目的、阶段目标或说明"
                value={milestoneDescription}
              />
              <input
                className="field-input"
                onChange={(event) => setMilestoneTargetAt(event.target.value)}
                type="datetime-local"
                value={milestoneTargetAt}
              />
              <button className="primary-button justify-center" disabled={submittingMilestone} type="submit">
                {submittingMilestone ? "创建中..." : "创建里程碑"}
              </button>
            </form>

            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              <button
                className={selectedMilestoneId === "live" ? "primary-button justify-center" : "secondary-button justify-center"}
                onClick={() => setSelectedMilestoneId("live")}
                type="button"
              >
                查看当前任务视图
              </button>
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-text-muted">
                已创建 {milestones.length} 个里程碑，归档后可随时切换回历史快照。
              </div>
              {milestones.map((milestone) => (
                <article
                  key={milestone.id}
                  className={`rounded-[24px] border px-4 py-4 ${
                    selectedMilestoneId === milestone.id
                      ? "border-white/18 bg-white/[0.08]"
                      : "border-white/[0.08] bg-white/[0.04]"
                  } xl:col-span-1`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-white/88">{milestone.name}</p>
                      <p className="mt-2 text-sm text-text-muted">
                        {milestone.description || "未填写描述"}
                      </p>
                    </div>
                    <button
                      className={selectedMilestoneId === milestone.id ? "primary-button" : "secondary-button"}
                      onClick={() => setSelectedMilestoneId(milestone.id)}
                      type="button"
                    >
                      {selectedMilestoneId === milestone.id ? "当前查看中" : "查看快照"}
                    </button>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3 text-xs text-white/52">
                    <span>归档 {milestone.archived_task_count} 项</span>
                    <span>{new Date(milestone.target_at).toLocaleString("zh-CN")}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {error ? <p className="mt-6 text-sm text-rose-300">{error}</p> : null}

      <section className="mt-6 panel rounded-[28px] p-6 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-white/38">Task view</p>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">
              {selectedMilestoneId === "live" ? "当前任务树" : "里程碑历史视图"}
            </h2>
          </div>
          <p className="text-sm text-text-muted">
            {selectedMilestoneId === "live"
              ? "当前视图默认隐藏已归档任务。"
              : "历史视图展示里程碑快照，并保留上下文节点。"}
          </p>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            {flatTasks.length ? (
              viewMode === "tree" ? (
                <TaskMindmap
                  collapsedTaskIds={collapsedTaskIdSet}
                  onQuickStatus={handleQuickStatus}
                  onToggleCollapse={toggleTaskCollapse}
                  onSelectTask={setSelectedTaskId}
                  onStartCreateChild={startCreateChild}
                  readOnly={isHistoryView}
                  selectedTaskId={selectedTaskId}
                  taskIndex={taskIndex}
                  tree={displayTree}
                />
              ) : (
                <div className="overflow-x-auto rounded-[24px] border border-white/[0.08] bg-white/[0.03]">
                  {selectedTaskIds.length ? (
                    <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.08] px-4 py-4">
                      <span className="text-sm text-white/72">已选择 {selectedTaskIds.length} 项</span>
                      {(["in_progress", "pending_review", "completed", "terminated"] as TaskStatus[]).map((status) => (
                        <button
                          key={status}
                          className="secondary-button"
                          disabled={isHistoryView}
                          onClick={() => void handleBulkStatus(status)}
                          type="button"
                        >
                          批量设为{statusLabel(status)}
                        </button>
                      ))}
                      <button
                        className="secondary-button border-rose-400/18 text-rose-200 hover:border-rose-400/30 hover:text-rose-100"
                        disabled={isHistoryView}
                        onClick={() => void handleBulkDelete()}
                        type="button"
                      >
                        批量删除
                      </button>
                    </div>
                  ) : null}
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.08] text-white/52">
                        <th className="px-4 py-3 font-medium">
                          <input
                            checked={flatTasks.length > 0 && flatTasks.every((task) => selectedTaskIds.includes(task.id))}
                            className="h-4 w-4"
                            onChange={toggleAllVisibleTasks}
                            type="checkbox"
                          />
                        </th>
                        <th className="px-4 py-3 font-medium">任务</th>
                        <th className="px-4 py-3 font-medium">状态</th>
                        <th className="px-4 py-3 font-medium">负责人</th>
                        <th className="px-4 py-3 font-medium">权重</th>
                        <th className="px-4 py-3 font-medium">评分</th>
                        <th className="px-4 py-3 font-medium">截止时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flatTasks.map((task) => (
                        <tr
                          key={task.id}
                          className={`border-b text-white/78 last:border-b-0 ${
                            dropTargetTaskId === task.id
                              ? "border-sky-400/40 bg-sky-400/8"
                              : "border-white/[0.06]"
                          } ${draggingTaskId === task.id ? "opacity-45" : ""}`}
                          onClick={() => setSelectedTaskId(task.id)}
                          onDragEnd={() => {
                            setDraggingTaskId(null);
                            setDropTargetTaskId(null);
                          }}
                          onDragOver={(event) => {
                            const draggedTask = draggingTaskId ? taskIndex.get(draggingTaskId) : null;
                            const targetTask = taskIndex.get(task.id);
                            if (
                              draggedTask &&
                              targetTask &&
                              draggedTask.parent_id === targetTask.parent_id &&
                              !isHistoryView
                            ) {
                              event.preventDefault();
                              setDropTargetTaskId(task.id);
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            void handleReorderDrop(task.id);
                          }}
                        >
                          <td className="px-4 py-3">
                            <input
                              checked={selectedTaskIds.includes(task.id)}
                              className="h-4 w-4"
                              onChange={(event) => {
                                event.stopPropagation();
                                toggleTaskSelection(task.id);
                              }}
                              type="checkbox"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2" style={{ paddingLeft: `${task.level * 16}px` }}>
                              <button
                                className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-full border border-white/[0.08] text-white/68 transition hover:border-white/[0.18] hover:text-white active:cursor-grabbing disabled:opacity-40"
                                disabled={isHistoryView}
                                draggable={!isHistoryView}
                                onDragStart={(event) => {
                                  event.stopPropagation();
                                  setDraggingTaskId(task.id);
                                  setDropTargetTaskId(task.id);
                                }}
                                onClick={(event) => event.stopPropagation()}
                                type="button"
                              >
                                ::
                              </button>
                              {taskIndex.get(task.id)?.children.length ? (
                                <button
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.08] text-white/68 transition hover:border-white/[0.18] hover:text-white"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleTaskCollapse(task.id);
                                  }}
                                  type="button"
                                >
                                  {collapsedTaskIdSet.has(task.id) ? (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : (
                                <span className="inline-flex h-7 w-7" />
                              )}
                              <div>
                                <div className="font-medium">{task.title}</div>
                                <div className="mt-1 text-xs text-text-muted">{task.id}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">{statusLabel(task.status)}</td>
                          <td className="px-4 py-3">{task.assignee_user_id ?? "未分配"}</td>
                          <td className="px-4 py-3">{task.weight}</td>
                          <td className="px-4 py-3">{task.score ?? "-"}</td>
                          <td className="px-4 py-3">
                            {task.planned_due_at
                              ? new Date(task.planned_due_at).toLocaleString("zh-CN")
                              : "未设置"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <div className="rounded-3xl border border-dashed border-white/[0.12] px-5 py-10 text-sm text-text-muted">
                <p>当前没有可展示的任务节点。</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {selectedStatuses.length ? (
                    <button className="secondary-button" onClick={() => setSelectedStatuses([])} type="button">
                      清空状态筛选
                    </button>
                  ) : null}
                  {!isHistoryView ? (
                    <button className="primary-button" onClick={() => setComposeParentId(null)} type="button">
                      先创建一个顶层任务
                    </button>
                  ) : (
                    <button className="secondary-button" onClick={() => setSelectedMilestoneId("live")} type="button">
                      返回当前任务视图
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <TaskDetailPanel
            members={members}
            onRefresh={loadWorkbench}
            readOnly={isHistoryView}
            task={selectedTask}
            workspaceId={workspaceId}
            workspaceRole={workspace.role}
          />
        </div>
      </section>

      <div className="mt-6">
        <WorkspaceMembersPanel
          invitations={invitations}
          members={members}
          onRefresh={loadWorkbench}
          workspaceId={workspaceId}
          workspaceRole={workspace.role}
        />
      </div>
    </main>
  );
}
