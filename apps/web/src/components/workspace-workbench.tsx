"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TaskDetailPanel } from "@/components/task-detail-panel";
import { TaskMindmap } from "@/components/task-mindmap";
import { useWorkspaceContext } from "@/components/workspace-context";
import {
  type MilestoneTreeResponse,
  type TaskStatus,
  type TaskTreeNode,
  apiRequest,
} from "@/lib/api";
import { useTaskSync } from "@/lib/task-sync";
import { deriveWorkbenchTreeState, getVirtualWindow } from "@/lib/task-tree";

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

const TABLE_ROW_HEIGHT = 68;
const TABLE_ROW_OVERSCAN = 8;
const TABLE_VIEWPORT_FALLBACK = 520;

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

function getSiblingTaskIds(
  root: TaskTreeNode | null,
  taskIndex: Map<string, TaskTreeNode>,
  parentId: string | null,
) {
  if (!root) {
    return [];
  }

  if (parentId) {
    return taskIndex.get(parentId)?.children.map((child) => child.id) ?? [];
  }

  return [root.id];
}

export function WorkspaceWorkbench({ workspaceId }: WorkspaceWorkbenchProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessToken, members, milestones, session, workspace } = useWorkspaceContext();

  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [selectedStatuses, setSelectedStatuses] = useState<TaskStatus[]>([]);
  const [historyRootTask, setHistoryRootTask] = useState<TaskTreeNode | null>(null);
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<string[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropTargetTaskId, setDropTargetTaskId] = useState<string | null>(null);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(TABLE_VIEWPORT_FALLBACK);
  const [treeFitViewToken, setTreeFitViewToken] = useState(0);
  const [canvasFocusToken, setCanvasFocusToken] = useState(0);
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const detailFocusToken = 0;

  const selectedMilestoneId = searchParams.get("milestone") ?? "live";
  const isHistoryView = selectedMilestoneId !== "live";
  const userName = session?.user.display_name ?? "协作者";
  const statusQuery = useMemo(() => buildStatusQuery(selectedStatuses), [selectedStatuses]);
  const {
    bulkDeleteTasks: bulkDeleteLiveTasks,
    bulkSetStatus: bulkSetLiveStatus,
    connected: liveConnected,
    createTask: createLiveTask,
    deleteTask: deleteLiveTask,
    error: liveError,
    loading: liveLoading,
    patchTask: patchLiveTask,
    reorderTasks: reorderLiveTasks,
    rootTask: liveRootTask,
    setTaskStatus: setLiveTaskStatus,
  } = useTaskSync({
    accessToken,
    enabled: !isHistoryView,
    statusFilters: selectedStatuses,
    workspaceId,
  });
  const rootTask = isHistoryView ? historyRootTask : liveRootTask;
  const loading = isHistoryView ? historyLoading : liveLoading;
  const error = uiError ?? (isHistoryView ? historyError : liveError);
  const collapsedTaskIdSet = useMemo(() => new Set(collapsedTaskIds), [collapsedTaskIds]);
  const { collapsibleTaskIdSet, collapsibleTaskIds, flatTasks, taskIndex, visibleTaskIds, visibleTaskIdSet } = useMemo(
    () => deriveWorkbenchTreeState(rootTask, collapsedTaskIdSet),
    [rootTask, collapsedTaskIdSet],
  );
  const selectedTask = useMemo(
    () => (selectedTaskId ? taskIndex.get(selectedTaskId) ?? null : null),
    [selectedTaskId, taskIndex],
  );
  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
  const selectableVisibleTaskIds = useMemo(
    () => visibleTaskIds.filter((taskId) => taskIndex.get(taskId)?.node_kind !== "system_root"),
    [taskIndex, visibleTaskIds],
  );
  const allVisibleSelected = useMemo(
    () =>
      selectableVisibleTaskIds.length > 0 &&
      selectableVisibleTaskIds.every((taskId) => selectedTaskIdSet.has(taskId)),
    [selectableVisibleTaskIds, selectedTaskIdSet],
  );
  const virtualWindow = useMemo(
    () => getVirtualWindow(flatTasks.length, tableScrollTop, tableViewportHeight, TABLE_ROW_HEIGHT, TABLE_ROW_OVERSCAN),
    [flatTasks.length, tableScrollTop, tableViewportHeight],
  );
  const virtualFlatTasks = useMemo(
    () => flatTasks.slice(virtualWindow.startIndex, virtualWindow.endIndex),
    [flatTasks, virtualWindow.endIndex, virtualWindow.startIndex],
  );
  const activeMilestone = useMemo(
    () => milestones.find((milestone) => milestone.id === selectedMilestoneId) ?? null,
    [milestones, selectedMilestoneId],
  );
  const visibleTaskCount = useMemo(
    () => flatTasks.filter(({ task }) => task.node_kind !== "system_root").length,
    [flatTasks],
  );

  const focusCanvas = useCallback(() => {
    setCanvasFocusToken((current) => current + 1);
  }, []);

  const handleSelectTask = useCallback(
    (taskId: string) => {
      setSelectedTaskId(taskId);
      focusCanvas();
    },
    [focusCanvas],
  );

  const startInlineRename = useCallback(
    (taskId: string) => {
      if (isHistoryView) {
        return;
      }

      const task = taskIndex.get(taskId);
      if (!task) {
        return;
      }

      setSelectedTaskId(taskId);
      setEditingTaskId(taskId);
      setEditingTitle(task.title);
      focusCanvas();
    },
    [focusCanvas, isHistoryView, taskIndex],
  );

  const cancelInlineRename = useCallback(() => {
    if (editingTaskId) {
      const task = taskIndex.get(editingTaskId);
      setEditingTitle(task?.title ?? "");
    }

    setEditingTaskId(null);
    focusCanvas();
  }, [editingTaskId, focusCanvas, taskIndex]);

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

  const loadHistoryWorkbench = useCallback(async (fitView = false, silent = false) => {
    if (!accessToken || !isHistoryView) {
      setHistoryLoading(false);
      return;
    }

    try {
      if (!silent) {
        setHistoryLoading(true);
      }
      setHistoryError(null);
      const response = await apiRequest<MilestoneTreeResponse>(
        `/workspaces/${workspaceId}/milestones/${selectedMilestoneId}/tree${statusQuery}`,
        { token: accessToken },
      );
      setHistoryRootTask(response.root ?? null);
      if (fitView) {
        setTreeFitViewToken((current) => current + 1);
      }
    } catch (loadError) {
      setHistoryError(loadError instanceof Error ? loadError.message : "加载任务工作台失败。");
      if (!silent) {
        setHistoryRootTask(null);
      }
    } finally {
      if (!silent) {
        setHistoryLoading(false);
      }
    }
  }, [accessToken, isHistoryView, selectedMilestoneId, statusQuery, workspaceId]);

  useEffect(() => {
    if (isHistoryView) {
      void loadHistoryWorkbench(true);
      return;
    }

    setHistoryLoading(false);
    setHistoryError(null);
    setHistoryRootTask(null);
  }, [isHistoryView, loadHistoryWorkbench]);

  useEffect(() => {
    if (!isHistoryView && liveRootTask) {
      setTreeFitViewToken((current) => current + 1);
    }
  }, [isHistoryView, liveRootTask]);

  const commitInlineRename = useCallback(
    async (taskId: string, draftTitle: string) => {
      const task = taskIndex.get(taskId);
      if (!task) {
        setEditingTaskId(null);
        setEditingTitle("");
        focusCanvas();
        return;
      }

      const normalizedTitle = draftTitle.trim() || task.title || "新节点";
      setEditingTaskId(null);
      setEditingTitle(normalizedTitle);
      setSelectedTaskId(taskId);
      focusCanvas();

      if (isHistoryView || task.id.startsWith("optimistic:") || normalizedTitle === task.title) {
        return;
      }

      try {
        setUiError(null);
        await patchLiveTask(task.id, { title: normalizedTitle });
      } catch (submitError) {
        setUiError(submitError instanceof Error ? submitError.message : "更新节点名称失败。");
      }
    },
    [focusCanvas, isHistoryView, patchLiveTask, taskIndex],
  );

  useEffect(() => {
    setCollapsedTaskIds((current) => {
      const next = current.filter((taskId) => collapsibleTaskIdSet.has(taskId));
      return next.length === current.length ? current : next;
    });
  }, [collapsibleTaskIdSet]);

  useEffect(() => {
    if (!visibleTaskIds.length) {
      setSelectedTaskId(null);
      return;
    }

    if (!selectedTaskId || !visibleTaskIdSet.has(selectedTaskId)) {
      setSelectedTaskId(visibleTaskIds[0] ?? null);
      focusCanvas();
    }
  }, [focusCanvas, selectedTaskId, visibleTaskIdSet, visibleTaskIds]);

  useEffect(() => {
    if (editingTaskId && !taskIndex.has(editingTaskId)) {
      setEditingTaskId(null);
      setEditingTitle("");
    }
  }, [editingTaskId, taskIndex]);

  useEffect(() => {
    setSelectedTaskIds((current) => {
      const next = current.filter((taskId) => selectableVisibleTaskIds.includes(taskId));
      return next.length === current.length ? current : next;
    });
  }, [selectableVisibleTaskIds]);

  useEffect(() => {
    if (viewMode !== "table") {
      return;
    }

    const viewport = tableViewportRef.current;
    if (!viewport) {
      return;
    }

    const syncViewport = () => {
      setTableViewportHeight(viewport.clientHeight || TABLE_VIEWPORT_FALLBACK);
      setTableScrollTop(viewport.scrollTop);
    };

    syncViewport();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      syncViewport();
    });
    observer.observe(viewport);

    return () => {
      observer.disconnect();
    };
  }, [flatTasks.length, viewMode]);

  const toggleStatus = useCallback((status: TaskStatus) => {
    setSelectedStatuses((current) =>
      current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
    );
  }, []);

  const createTask = useCallback(
    async (parentId: string) => {
      if (isHistoryView) {
        return;
      }

      const parentTask = taskIndex.get(parentId);
      if (!parentTask) {
        return;
      }

      try {
        setUiError(null);
        setCollapsedTaskIds((current) => current.filter((taskId) => taskId !== parentId));
        const createdTaskId = await createLiveTask(parentId, "新节点");
        if (createdTaskId) {
          setSelectedTaskId(createdTaskId);
          setEditingTaskId(createdTaskId);
          setEditingTitle("新节点");
          focusCanvas();
        }
      } catch (submitError) {
        setSelectedTaskId(parentId);
        setEditingTaskId(null);
        setEditingTitle("");
        focusCanvas();
        setUiError(submitError instanceof Error ? submitError.message : "创建任务失败。");
      }
    },
    [createLiveTask, focusCanvas, isHistoryView, taskIndex],
  );

  const handleCreateChild = useCallback(
    (taskId: string) => {
      void createTask(taskId);
    },
    [createTask],
  );

  const handleCreateSibling = useCallback(
    (taskId: string) => {
      const task = taskIndex.get(taskId);
      if (!task) {
        return;
      }

      const parentId = task.node_kind === "system_root" ? task.id : task.parent_id ?? rootTask?.id;
      if (!parentId) {
        return;
      }

      void createTask(parentId);
    },
    [createTask, rootTask?.id, taskIndex],
  );

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      if (isHistoryView) {
        return;
      }

      const task = taskIndex.get(taskId);
      if (!task || task.node_kind === "system_root") {
        return;
      }

      if (!window.confirm(`确认删除任务「${task.title}」吗？其子任务也会一起删除。`)) {
        return;
      }

      try {
        setUiError(null);
        setSelectedTaskId(task.parent_id ?? rootTask?.id ?? null);
        if (editingTaskId === taskId) {
          setEditingTaskId(null);
          setEditingTitle("");
        }
        focusCanvas();
        await deleteLiveTask(taskId);
      } catch (submitError) {
        setSelectedTaskId(taskId);
        if (editingTaskId === taskId) {
          setEditingTaskId(taskId);
          setEditingTitle(task.title);
        }
        focusCanvas();
        setUiError(submitError instanceof Error ? submitError.message : "删除任务失败。");
      }
    },
    [deleteLiveTask, editingTaskId, focusCanvas, isHistoryView, rootTask?.id, taskIndex],
  );

  const toggleTaskCollapse = useCallback(
    (taskId: string) => {
      if (!taskIndex.get(taskId)?.children.length) {
        return;
      }

      setCollapsedTaskIds((current) =>
        current.includes(taskId) ? current.filter((item) => item !== taskId) : [...current, taskId],
      );
    },
    [taskIndex],
  );

  const collapseAllBranches = useCallback(() => {
    setCollapsedTaskIds(collapsibleTaskIds);
  }, [collapsibleTaskIds]);

  const expandAllBranches = useCallback(() => {
    setCollapsedTaskIds([]);
  }, []);

  const toggleTaskSelection = useCallback(
    (taskId: string) => {
      if (taskIndex.get(taskId)?.node_kind === "system_root") {
        return;
      }

      setSelectedTaskIds((current) =>
        current.includes(taskId) ? current.filter((item) => item !== taskId) : [...current, taskId],
      );
    },
    [taskIndex],
  );

  const toggleAllVisibleTasks = useCallback(() => {
    setSelectedTaskIds(allVisibleSelected ? [] : selectableVisibleTaskIds);
  }, [allVisibleSelected, selectableVisibleTaskIds]);

  const handleTableScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setTableScrollTop(event.currentTarget.scrollTop);
  }, []);

  async function handleBulkStatus(status: TaskStatus) {
    if (!selectedTaskIds.length || isHistoryView) {
      return;
    }

    try {
      setUiError(null);
      await bulkSetLiveStatus(selectedTaskIds, status);
      setSelectedTaskIds([]);
    } catch (submitError) {
      setUiError(submitError instanceof Error ? submitError.message : "批量状态更新失败。");
    }
  }

  async function handleBulkDelete() {
    if (!selectedTaskIds.length || isHistoryView) {
      return;
    }

    if (!window.confirm(`确认批量删除选中的 ${selectedTaskIds.length} 个任务吗？`)) {
      return;
    }

    try {
      setUiError(null);
      await bulkDeleteLiveTasks(selectedTaskIds);
      setSelectedTaskIds([]);
    } catch (submitError) {
      setUiError(submitError instanceof Error ? submitError.message : "批量删除失败。");
    }
  }

  const handleMindmapReorder = useCallback(
    async (parentId: string, orderedTaskIds: string[]) => {
      if (isHistoryView) {
        return;
      }

      const parentTask = taskIndex.get(parentId);
      if (!parentTask || orderedTaskIds.length !== parentTask.children.length) {
        return;
      }

      try {
        setUiError(null);
        await reorderLiveTasks(parentId, orderedTaskIds);
      } catch (submitError) {
        setUiError(submitError instanceof Error ? submitError.message : "拖拽排序失败。");
      }
    },
    [isHistoryView, reorderLiveTasks, taskIndex],
  );

  async function handleReorderDrop(targetTaskId: string) {
    if (!draggingTaskId || draggingTaskId === targetTaskId || isHistoryView) {
      setDraggingTaskId(null);
      setDropTargetTaskId(null);
      return;
    }

    const draggedTask = taskIndex.get(draggingTaskId);
    const targetTask = taskIndex.get(targetTaskId);
    if (
      !draggedTask ||
      !targetTask ||
      draggedTask.node_kind === "system_root" ||
      targetTask.node_kind === "system_root" ||
      draggedTask.parent_id !== targetTask.parent_id
    ) {
      setDraggingTaskId(null);
      setDropTargetTaskId(null);
      return;
    }

    const siblingIds = getSiblingTaskIds(rootTask, taskIndex, draggedTask.parent_id).filter(
      (taskId) => taskId !== draggingTaskId,
    );
    const targetIndex = siblingIds.indexOf(targetTaskId);
    if (targetIndex === -1) {
      setDraggingTaskId(null);
      setDropTargetTaskId(null);
      return;
    }

    siblingIds.splice(targetIndex, 0, draggingTaskId);
    const parentId = draggedTask.parent_id;
    if (!parentId) {
      setDraggingTaskId(null);
      setDropTargetTaskId(null);
      return;
    }

    try {
      setUiError(null);
      await reorderLiveTasks(parentId, siblingIds);
    } catch (submitError) {
      setUiError(submitError instanceof Error ? submitError.message : "拖拽排序失败。");
    } finally {
      setDraggingTaskId(null);
      setDropTargetTaskId(null);
    }
  }

  if (!workspace) {
    return null;
  }

  return (
    <div className="space-y-3">
      <section className="panel rounded-[20px] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-white/34">
              <span>Task Workspace</span>
              <span className="rounded-full border border-white/[0.08] px-2 py-1 text-white/48">{workspace.name}</span>
              <span className="rounded-full border border-white/[0.08] px-2 py-1 text-white/48">
                {isHistoryView ? "History Snapshot" : "System Root"}
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">任务工作区</h2>
            <p className="mt-2 max-w-3xl text-sm text-text-muted">
              新空间默认包含唯一系统根节点，导图内直接使用键盘扩展结构，不再通过额外卡片创建根或子节点。
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/30">Visible</p>
              <p className="mt-1 text-base font-semibold text-white/90">{visibleTaskCount} 个任务</p>
            </div>
            <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/30">Focus</p>
              <p className="mt-1 line-clamp-1 text-base font-semibold text-white/90">{selectedTask?.title ?? "根节点"}</p>
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

      <section className="panel rounded-[20px] px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <label className="field-label min-w-0" htmlFor="milestone-select">
              当前视图
            </label>
            <select
              className="field-input w-full min-w-[14rem] max-w-[18rem]"
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

            <div className="flex items-center gap-2">
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
                表格
              </button>
            </div>

            <button className="secondary-button" onClick={expandAllBranches} type="button">
              全展开
            </button>
            <button className="secondary-button" onClick={collapseAllBranches} type="button">
              折叠子树
            </button>
          </div>

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
      </section>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      <section className="panel min-h-0 rounded-[22px] p-0 overflow-hidden">
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
            {!isHistoryView ? (
              <span className="rounded-full border border-white/[0.08] px-2.5 py-1">
                {liveConnected ? "协同在线" : "协同重连中"}
              </span>
            ) : null}
            <span className="rounded-full border border-white/[0.08] px-2.5 py-1">
              {viewMode === "tree" ? "Mind Map" : "Table Grid"}
            </span>
            <span className="rounded-full border border-white/[0.08] px-2.5 py-1">{visibleTaskCount} Tasks</span>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[58vh] items-center justify-center px-5 py-10 text-sm text-white/72">
            正在加载任务视图...
          </div>
        ) : rootTask ? (
          <div className="relative min-h-0 p-3">
            {viewMode === "tree" ? (
              <>
                <TaskMindmap
                  allowReorder={!isHistoryView && selectedStatuses.length === 0}
                  collapsedTaskIds={collapsedTaskIdSet}
                  editingTaskId={editingTaskId}
                  editingTitle={editingTitle}
                  fitViewToken={treeFitViewToken}
                  focusCanvasToken={canvasFocusToken}
                  onCreateChild={handleCreateChild}
                  onCreateSibling={handleCreateSibling}
                  onDeleteTask={(taskId) => void handleDeleteTask(taskId)}
                  onReorderSiblings={(parentId, orderedTaskIds) => void handleMindmapReorder(parentId, orderedTaskIds)}
                  onRenameCancel={cancelInlineRename}
                  onRenameChange={setEditingTitle}
                  onRenameCommit={(taskId, title) => void commitInlineRename(taskId, title)}
                  onRenameStart={startInlineRename}
                  onSelectTask={handleSelectTask}
                  onToggleCollapse={toggleTaskCollapse}
                  readOnly={isHistoryView}
                  root={rootTask}
                  selectedTaskId={selectedTaskId}
                />
                <TaskDetailPanel
                  accessToken={accessToken}
                  autoFocusToken={detailFocusToken}
                  members={members}
                  onDeleteTask={deleteLiveTask}
                  onPatchTask={patchLiveTask}
                  onSetTaskStatus={setLiveTaskStatus}
                  readOnly={isHistoryView}
                  task={selectedTask}
                  userName={userName}
                  variant="floating"
                  workspaceId={workspaceId}
                  workspaceRole={workspace.role}
                />
              </>
            ) : (
              <div className="relative rounded-[16px] border border-white/[0.06] bg-white/[0.02]">
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

                <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2 text-xs text-white/42">
                  <span>窗口化渲染已启用，滚动时只绘制可视区附近行</span>
                  <span>
                    当前渲染 {virtualFlatTasks.length} / {flatTasks.length} 行
                  </span>
                </div>

                <div
                  data-testid="task-table-viewport"
                  ref={tableViewportRef}
                  className="max-h-[68vh] overflow-auto xl:max-h-[calc(100vh-14rem)]"
                  onScroll={handleTableScroll}
                >
                  <table className="min-w-full border-collapse text-left text-[13px]">
                    <thead className="sticky top-0 z-10 bg-[#0d121d] shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
                      <tr className="border-b border-white/[0.06] text-white/46">
                        <th className="px-3 py-2.5 font-medium">
                          <input
                            checked={allVisibleSelected}
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
                      {virtualWindow.paddingTop ? (
                        <tr aria-hidden="true">
                          <td className="p-0" colSpan={7} style={{ height: `${virtualWindow.paddingTop}px` }} />
                        </tr>
                      ) : null}

                      {virtualFlatTasks.map(({ level, task }) => {
                        const isSystemRoot = task.node_kind === "system_root";

                        return (
                          <tr
                            key={task.id}
                            className={`h-[68px] border-b align-middle text-white/76 last:border-b-0 ${
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
                                draggedTask.node_kind !== "system_root" &&
                                targetTask.node_kind !== "system_root" &&
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
                                checked={selectedTaskIdSet.has(task.id)}
                                className="h-4 w-4"
                                disabled={isSystemRoot}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  toggleTaskSelection(task.id);
                                }}
                                type="checkbox"
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2" style={{ paddingLeft: `${level * 14}px` }}>
                                <button
                                  className="inline-flex h-6 w-6 cursor-grab items-center justify-center rounded-lg border border-white/[0.08] text-white/62 transition hover:border-white/[0.16] hover:text-white active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
                                  disabled={isHistoryView || isSystemRoot}
                                  draggable={!isHistoryView && !isSystemRoot}
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
                                <div className="min-w-0">
                                  <div className="truncate font-medium text-white/88">{task.title}</div>
                                  <div className="mt-1 truncate text-[11px] text-text-muted">
                                    {isSystemRoot ? "系统根节点" : task.id}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {isSystemRoot ? (
                                <span className="rounded-full border border-sky-400/25 bg-sky-400/10 px-2.5 py-1 text-xs text-sky-100">
                                  系统根节点
                                </span>
                              ) : (
                                <span className={`rounded-full border px-2.5 py-1 text-xs ${statusTone(task.status)}`}>
                                  {statusLabel(task.status)}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">{isSystemRoot ? "-" : task.assignee_user_id ?? "未分配"}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap">{isSystemRoot ? "-" : task.weight}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap">{isSystemRoot ? "-" : task.score ?? "-"}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {isSystemRoot
                                ? "-"
                                : task.planned_due_at
                                  ? new Date(task.planned_due_at).toLocaleString("zh-CN")
                                  : "未设置"}
                            </td>
                          </tr>
                        );
                      })}

                      {virtualWindow.paddingBottom ? (
                        <tr aria-hidden="true">
                          <td className="p-0" colSpan={7} style={{ height: `${virtualWindow.paddingBottom}px` }} />
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <TaskDetailPanel
                  accessToken={accessToken}
                  autoFocusToken={detailFocusToken}
                  members={members}
                  onDeleteTask={deleteLiveTask}
                  onPatchTask={patchLiveTask}
                  onSetTaskStatus={setLiveTaskStatus}
                  readOnly={isHistoryView}
                  task={selectedTask}
                  userName={userName}
                  variant="floating"
                  workspaceId={workspaceId}
                  workspaceRole={workspace.role}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-[16px] border border-dashed border-white/[0.1] px-5 py-10 text-sm text-text-muted">
            当前没有可展示的任务节点，请刷新或切换回当前任务视图。
          </div>
        )}
      </section>
    </div>
  );
}
