"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useWorkspaceContext } from "@/components/workspace-context";
import { TaskDetailPanel } from "@/components/task-detail-panel";
import { TaskMindmap } from "@/components/task-mindmap";
import {
  type MessageResponse,
  type MilestoneTreeResponse,
  type TaskStatus,
  type TaskTreeNode,
  apiRequest,
} from "@/lib/api";

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
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessToken, members, milestones, workspace } = useWorkspaceContext();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [selectedStatuses, setSelectedStatuses] = useState<TaskStatus[]>([]);
  const [tree, setTree] = useState<TaskTreeNode[]>([]);
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<string[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropTargetTaskId, setDropTargetTaskId] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [composeParentId, setComposeParentId] = useState<string | null>(null);
  const [composeParentTitle, setComposeParentTitle] = useState<string | null>(null);
  const [submittingTask, setSubmittingTask] = useState(false);

  const selectedMilestoneId = searchParams.get("milestone") ?? "live";
  const statusQuery = useMemo(() => buildStatusQuery(selectedStatuses), [selectedStatuses]);
  const taskIndex = useMemo(() => createTaskIndex(tree), [tree]);
  const collapsedTaskIdSet = useMemo(() => new Set(collapsedTaskIds), [collapsedTaskIds]);
  const displayTree = useMemo(() => collapseTree(tree, collapsedTaskIdSet), [tree, collapsedTaskIdSet]);
  const flatTasks = useMemo(() => flattenTree(displayTree), [displayTree]);
  const selectedTask = useMemo(() => findTaskById(tree, selectedTaskId), [selectedTaskId, tree]);
  const isHistoryView = selectedMilestoneId !== "live";
  const activeMilestone = useMemo(
    () => milestones.find((milestone) => milestone.id === selectedMilestoneId) ?? null,
    [milestones, selectedMilestoneId],
  );

  const setMilestoneFilter = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "live") {
        params.delete("milestone");
      } else {
        params.set("milestone", value);
      }

      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (selectedMilestoneId !== "live" && milestones.length && !activeMilestone) {
      setMilestoneFilter("live");
    }
  }, [activeMilestone, milestones.length, selectedMilestoneId, setMilestoneFilter]);

  const loadWorkbench = useCallback(async () => {
    if (!accessToken) {
      setError("请先登录，再打开工作空间。");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const treeResponse =
        selectedMilestoneId === "live"
          ? await apiRequest<TaskTreeNode[]>(`/workspaces/${workspaceId}/tasks/tree${statusQuery}`, {
              token: accessToken,
            })
          : await apiRequest<MilestoneTreeResponse>(
              `/workspaces/${workspaceId}/milestones/${selectedMilestoneId}/tree${statusQuery}`,
              { token: accessToken },
            ).then((response) => response.tree);

      setTree(treeResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载任务工作台失败。");
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, selectedMilestoneId, statusQuery, workspaceId]);

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

  if (!workspace) {
    return null;
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !taskTitle.trim()) {
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
        token: accessToken,
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
    if (!accessToken || isHistoryView) {
      return;
    }

    try {
      setError(null);
      await apiRequest(`/workspaces/${workspaceId}/tasks/${taskId}/status`, {
        method: "POST",
        token: accessToken,
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
    if (!accessToken || !selectedTaskIds.length || isHistoryView) {
      return;
    }

    try {
      setError(null);
      await apiRequest<MessageResponse>(`/workspaces/${workspaceId}/tasks/bulk-status`, {
        method: "POST",
        token: accessToken,
        json: { task_ids: selectedTaskIds, status },
      });
      setSelectedTaskIds([]);
      await loadWorkbench();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "批量状态更新失败。");
    }
  }

  async function handleBulkDelete() {
    if (!accessToken || !selectedTaskIds.length || isHistoryView) {
      return;
    }

    if (!window.confirm(`确认批量删除选中的 ${selectedTaskIds.length} 个任务吗？`)) {
      return;
    }

    try {
      setError(null);
      await apiRequest<MessageResponse>(`/workspaces/${workspaceId}/tasks/bulk-delete`, {
        method: "POST",
        token: accessToken,
        json: { task_ids: selectedTaskIds },
      });
      setSelectedTaskIds([]);
      await loadWorkbench();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "批量删除失败。");
    }
  }

  async function handleReorderDrop(targetTaskId: string) {
    if (!accessToken || !draggingTaskId || draggingTaskId === targetTaskId || isHistoryView) {
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
        token: accessToken,
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

  return (
    <div className="space-y-3">
      <section className="panel rounded-[20px] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-white/34">
              <span>Task Workbench</span>
              <span className="rounded-full border border-white/[0.08] px-2 py-1 text-white/48">{workspace.name}</span>
              <span className="rounded-full border border-white/[0.08] px-2 py-1 text-white/48">
                {isHistoryView ? "History Snapshot" : "Live Tree"}
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">任务工作区</h2>
            <p className="mt-2 max-w-3xl text-sm text-text-muted">
              固定左侧菜单仅负责模块切换，右侧区域集中处理筛选、结构浏览、节点编辑与里程碑快照切换。
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/30">Visible</p>
              <p className="mt-1 text-base font-semibold text-white/90">{flatTasks.length} 个节点</p>
            </div>
            <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/30">Mode</p>
              <p className="mt-1 text-base font-semibold text-white/90">{viewMode === "tree" ? "导图" : "表格"}</p>
            </div>
            <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/30">Milestone</p>
              <p className="mt-1 line-clamp-1 text-base font-semibold text-white/90">
                {selectedMilestoneId === "live" ? "当前任务" : activeMilestone?.name ?? "历史快照"}
              </p>
            </div>
            <Link
              className="secondary-button h-full justify-center rounded-[16px] border-white/[0.08] bg-white/[0.03] px-3"
              href={`/workspaces/${workspace.id}/milestones`}
            >
              里程碑管理
            </Link>
            <Link
              className="secondary-button h-full justify-center rounded-[16px] border-white/[0.08] bg-white/[0.03] px-3"
              href={`/workspaces/${workspace.id}/stats`}
            >
              统计与审计
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-3 2xl:grid-cols-[1.1fr_1fr_0.95fr] xl:grid-cols-2">
        <div className="panel rounded-[18px] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/32">Filters</p>
              <h3 className="mt-1 text-base font-semibold text-white/90">视图与状态筛选</h3>
            </div>
            <span className="rounded-full border border-white/[0.08] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-white/40">
              {selectedStatuses.length ? `${selectedStatuses.length} Filters` : "No Filter"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="milestone-select">
                当前视图
              </label>
              <select
                className="field-input"
                id="milestone-select"
                onChange={(event) => setMilestoneFilter(event.target.value)}
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
              <label className="field-label">呈现模式</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={viewMode === "tree" ? "primary-button w-full" : "secondary-button w-full"}
                  onClick={() => setViewMode("tree")}
                  type="button"
                >
                  思维导图
                </button>
                <button
                  className={viewMode === "table" ? "primary-button w-full" : "secondary-button w-full"}
                  onClick={() => setViewMode("table")}
                  type="button"
                >
                  表格视图
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-[16px] border border-white/[0.08] bg-white/[0.03] p-3 text-sm text-text-muted">
            <div className="flex flex-wrap items-center gap-2">
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
        </div>

        <div className="panel rounded-[18px] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/32">Quick Compose</p>
              <h3 className="mt-1 text-base font-semibold text-white/90">任务创建与结构动作</h3>
            </div>
            <div className="flex items-center gap-2">
              <button className="secondary-button" onClick={expandAllBranches} type="button">
                全展开
              </button>
              <button className="secondary-button" onClick={collapseAllBranches} type="button">
                折叠子树
              </button>
            </div>
          </div>

          <form className="mt-4 flex flex-col gap-2 xl:flex-row" onSubmit={handleCreateTask}>
            <input
              className="field-input"
              disabled={isHistoryView}
              onChange={(event) => setTaskTitle(event.target.value)}
              placeholder={composeParentTitle ? `创建到：${composeParentTitle}` : "输入任务名称，默认创建顶层节点"}
              value={taskTitle}
            />
            <button className="primary-button min-w-28" disabled={submittingTask} type="submit">
              {submittingTask ? "创建中..." : composeParentTitle ? "创建子任务" : "创建任务"}
            </button>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/48">
            <span className="rounded-full border border-white/[0.08] px-2.5 py-1">
              {composeParentTitle ? `父节点：${composeParentTitle}` : "父节点：顶层"}
            </span>
            <span className="rounded-full border border-white/[0.08] px-2.5 py-1">
              {isHistoryView ? "当前为只读快照" : "当前可编辑"}
            </span>
            {composeParentTitle ? (
              <button
                className="secondary-button"
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
        </div>

        <div className="panel rounded-[18px] p-4 xl:col-span-2 2xl:col-span-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/32">Focus Node</p>
              <h3 className="mt-1 text-base font-semibold text-white/90">当前聚焦节点</h3>
            </div>
            <Link className="secondary-button" href={`/workspaces/${workspaceId}/milestones`}>
              里程碑页
            </Link>
          </div>

          {selectedTask ? (
            <div className="mt-4 rounded-[16px] border border-white/[0.08] bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs ${statusTone(selectedTask.status)}`}>
                  {statusLabel(selectedTask.status)}
                </span>
                <span className="text-xs text-white/42">
                  深度 {selectedTask.depth} · 子任务 {selectedTask.children.length}
                </span>
              </div>
              <h4 className="mt-3 text-sm font-semibold text-white/90">{selectedTask.title}</h4>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-text-muted">
                {selectedTask.content_markdown
                  ? selectedTask.content_markdown.replace(/[#*_`>-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140)
                  : "当前节点还没有补充描述内容。"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/48">
                <span className="rounded-full border border-white/[0.08] px-2.5 py-1">权重 {selectedTask.weight}</span>
                <span className="rounded-full border border-white/[0.08] px-2.5 py-1">评分 {selectedTask.score ?? "-"}</span>
                <span className="rounded-full border border-white/[0.08] px-2.5 py-1">
                  负责人 {selectedTask.assignee_user_id ?? "未分配"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="secondary-button"
                  disabled={isHistoryView}
                  onClick={() => startCreateChild(selectedTask.id, selectedTask.title)}
                  type="button"
                >
                  {isHistoryView ? "历史只读" : "创建子任务"}
                </button>
                {selectedTask.children.length ? (
                  <button className="secondary-button" onClick={() => toggleTaskCollapse(selectedTask.id)} type="button">
                    {collapsedTaskIdSet.has(selectedTask.id) ? "展开当前子树" : "折叠当前子树"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-[16px] border border-dashed border-white/[0.1] px-4 py-6 text-sm text-text-muted">
              点击导图或表格中的任意节点后，这里会显示聚焦摘要，并提供快捷结构操作。
            </div>
          )}
        </div>
      </section>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      <section className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="panel min-h-0 rounded-[20px] p-0">
          <div className="flex flex-col gap-3 border-b border-white/[0.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/32">Task View</p>
              <h3 className="mt-1 text-base font-semibold text-white/92">
                {selectedMilestoneId === "live" ? "当前任务树" : `历史快照 · ${activeMilestone?.name ?? "里程碑"}`}
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/44">
              <span className="rounded-full border border-white/[0.08] px-2.5 py-1">
                {selectedMilestoneId === "live" ? "实时视图" : "只读快照"}
              </span>
              <span className="rounded-full border border-white/[0.08] px-2.5 py-1">
                {viewMode === "tree" ? "Mind Map" : "Table Grid"}
              </span>
              <span className="rounded-full border border-white/[0.08] px-2.5 py-1">{flatTasks.length} Nodes</span>
            </div>
          </div>

          {loading ? (
            <div className="flex min-h-[48vh] items-center justify-center px-5 py-10 text-sm text-white/72">正在加载任务视图...</div>
          ) : (
            <div className="min-h-0 p-3">
              {flatTasks.length ? (
                viewMode === "tree" ? (
                  <TaskMindmap
                    collapsedTaskIds={collapsedTaskIdSet}
                    onQuickStatus={handleQuickStatus}
                    onSelectTask={setSelectedTaskId}
                    onStartCreateChild={startCreateChild}
                    onToggleCollapse={toggleTaskCollapse}
                    readOnly={isHistoryView}
                    selectedTaskId={selectedTaskId}
                    taskIndex={taskIndex}
                    tree={displayTree}
                  />
                ) : (
                  <div className="overflow-x-auto rounded-[16px] border border-white/[0.06] bg-white/[0.02]">
                    {selectedTaskIds.length ? (
                      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-3">
                        <span className="mr-1 text-sm text-white/72">已选择 {selectedTaskIds.length} 项</span>
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
                    <table className="min-w-full border-collapse text-left text-[13px]">
                      <thead>
                        <tr className="border-b border-white/[0.06] text-white/46">
                          <th className="px-3 py-2.5 font-medium">
                            <input
                              checked={flatTasks.length > 0 && flatTasks.every((task) => selectedTaskIds.includes(task.id))}
                              className="h-4 w-4"
                              onChange={toggleAllVisibleTasks}
                              type="checkbox"
                            />
                          </th>
                          <th className="px-3 py-2.5 font-medium">任务</th>
                          <th className="px-3 py-2.5 font-medium">状态</th>
                          <th className="px-3 py-2.5 font-medium">负责人</th>
                          <th className="px-3 py-2.5 font-medium">权重</th>
                          <th className="px-3 py-2.5 font-medium">评分</th>
                          <th className="px-3 py-2.5 font-medium">截止时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flatTasks.map((task) => (
                          <tr
                            key={task.id}
                            className={`border-b text-white/76 last:border-b-0 ${
                              dropTargetTaskId === task.id
                                ? "border-sky-400/40 bg-sky-400/8"
                                : "border-white/[0.04] hover:bg-white/[0.02]"
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
                            <td className="px-3 py-2.5">
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
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2" style={{ paddingLeft: `${task.level * 14}px` }}>
                                <button
                                  className="inline-flex h-6 w-6 cursor-grab items-center justify-center rounded-lg border border-white/[0.08] text-white/62 transition hover:border-white/[0.16] hover:text-white active:cursor-grabbing disabled:opacity-40"
                                  disabled={isHistoryView}
                                  draggable={!isHistoryView}
                                  onClick={(event) => event.stopPropagation()}
                                  onDragStart={(event) => {
                                    event.stopPropagation();
                                    setDraggingTaskId(task.id);
                                    setDropTargetTaskId(task.id);
                                  }}
                                  type="button"
                                >
                                  ::
                                </button>
                                {taskIndex.get(task.id)?.children.length ? (
                                  <button
                                    className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-white/[0.08] text-white/62 transition hover:border-white/[0.16] hover:text-white"
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
                                  <span className="inline-flex h-6 w-6" />
                                )}
                                <div>
                                  <div className="font-medium text-white/88">{task.title}</div>
                                  <div className="mt-1 text-[11px] text-text-muted">{task.id}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">{statusLabel(task.status)}</td>
                            <td className="px-3 py-2.5">{task.assignee_user_id ?? "未分配"}</td>
                            <td className="px-3 py-2.5">{task.weight}</td>
                            <td className="px-3 py-2.5">{task.score ?? "-"}</td>
                            <td className="px-3 py-2.5">
                              {task.planned_due_at ? new Date(task.planned_due_at).toLocaleString("zh-CN") : "未设置"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                <div className="rounded-[16px] border border-dashed border-white/[0.1] px-5 py-10 text-sm text-text-muted">
                  <p>当前没有可展示的任务节点。</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedStatuses.length ? (
                      <button className="secondary-button" onClick={() => setSelectedStatuses([])} type="button">
                        清空状态筛选
                      </button>
                    ) : null}
                    {!isHistoryView ? (
                      <button
                        className="primary-button"
                        onClick={() => {
                          setComposeParentId(null);
                          setComposeParentTitle(null);
                        }}
                        type="button"
                      >
                        先创建一个顶层任务
                      </button>
                    ) : (
                      <button className="secondary-button" onClick={() => setMilestoneFilter("live")} type="button">
                        返回当前任务视图
                      </button>
                    )}
                  </div>
                </div>
              )}
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
      </section>
    </div>
  );
}
