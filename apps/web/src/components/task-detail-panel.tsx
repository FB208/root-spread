"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { TaskDocumentEditor } from "@/components/task-document-editor";
import { type TaskStatus, type TaskStatusTransition, type TaskTreeNode, type WorkspaceItem, type WorkspaceMember, apiRequest } from "@/lib/api";

type TaskDetailPanelProps = {
  accessToken: string | null;
  autoFocusToken?: number;
  members: WorkspaceMember[];
  onDeleteTask: (taskId: string) => Promise<void>;
  onPatchTask: (
    taskId: string,
    patch: {
      assignee_user_id?: string | null;
      planned_due_at?: string | null;
      score?: number | null;
      title?: string;
      weight?: number;
    },
  ) => Promise<void>;
  onSetTaskStatus: (taskId: string, status: TaskStatus, remark?: string | null) => Promise<void>;
  readOnly: boolean;
  task: TaskTreeNode | null;
  userName: string;
  variant?: "floating" | "sidebar";
  workspaceId: string;
  workspaceRole: WorkspaceItem["role"];
};

function toDateTimeLocal(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function transitionLabel(status: string | null) {
  switch (status) {
    case "completed":
      return "已完成";
    case "pending_review":
      return "待验证";
    case "terminated":
      return "终止";
    case "in_progress":
      return "进行中";
    case null:
      return "初始";
    default:
      return status;
  }
}

export function TaskDetailPanel({
  accessToken,
  autoFocusToken = 0,
  members,
  onDeleteTask,
  onPatchTask,
  onSetTaskStatus,
  readOnly,
  task,
  userName,
  variant = "sidebar",
  workspaceId,
  workspaceRole,
}: TaskDetailPanelProps) {
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [plannedDueAt, setPlannedDueAt] = useState("");
  const [weight, setWeight] = useState("0");
  const [score, setScore] = useState("");
  const [remark, setRemark] = useState("");
  const [transitionCache, setTransitionCache] = useState<Record<string, TaskStatusTransition[]>>({});
  const [transitions, setTransitions] = useState<TaskStatusTransition[]>([]);
  const [loadingTransitions, setLoadingTransitions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isSystemRoot = task?.node_kind === "system_root";
  const isOptimisticTask = task?.id.startsWith("optimistic:") ?? false;
  const canScore = workspaceRole === "owner" || workspaceRole === "admin";
  const canMutate = !readOnly && task !== null && !isOptimisticTask;
  const canDelete = canMutate && !isSystemRoot;
  const taskStatus = task?.status ?? "in_progress";

  useEffect(() => {
    setTitle(task?.title ?? "");
    setAssigneeUserId(task?.assignee_user_id ?? "");
    setPlannedDueAt(toDateTimeLocal(task?.planned_due_at ?? null));
    setWeight(task ? String(task.weight) : "0");
    setScore(task?.score === null || task?.score === undefined ? "" : String(task.score));
    setRemark("");
    setError(null);
    setMessage(null);
  }, [task]);

  useEffect(() => {
    if (!task || !autoFocusToken || variant !== "sidebar") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [autoFocusToken, task, variant]);

  useEffect(() => {
    if (readOnly || !task || isSystemRoot || isOptimisticTask || !accessToken) {
      setTransitions([]);
      return;
    }

    const currentToken = accessToken;

    const cachedTransitions = transitionCache[task.id];
    if (cachedTransitions) {
      setTransitions(cachedTransitions);
      return;
    }

    setTransitions([]);

    const currentTask = task;
    let cancelled = false;

    async function loadTransitions() {
      try {
        setLoadingTransitions(true);
        const response = await apiRequest<TaskStatusTransition[]>(
          `/workspaces/${workspaceId}/tasks/${currentTask.id}/transitions`,
          { token: currentToken },
        );
        if (!cancelled) {
          setTransitionCache((current) => ({
            ...current,
            [currentTask.id]: response,
          }));
          setTransitions(response);
        }
      } catch {
        if (!cancelled) {
          setTransitions([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingTransitions(false);
        }
      }
    }

    void loadTransitions();

    return () => {
      cancelled = true;
    };
  }, [accessToken, isOptimisticTask, isSystemRoot, readOnly, task, transitionCache, workspaceId]);

  const memberOptions = useMemo(
    () => members.map((member) => ({ label: member.user.display_name, value: member.user.id })),
    [members],
  );

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task) {
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);
      await onPatchTask(task.id, {
        ...(isSystemRoot
          ? {
              title,
            }
          : {
              assignee_user_id: assigneeUserId || null,
              planned_due_at: plannedDueAt ? new Date(plannedDueAt).toISOString() : null,
              ...(canScore ? { score: score ? Number(score) : null } : {}),
              title,
              weight: Number(weight || 0),
            }),
      });
      setMessage(isSystemRoot ? "根节点标题已保存，正文实时协同中。" : "节点属性已保存，正文实时协同中。");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存节点失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(status: TaskStatus) {
    if (!task || isSystemRoot) {
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);
      await onSetTaskStatus(task.id, status, remark.trim() || null);
      setMessage("状态已更新。");
      setRemark("");
      setTransitionCache((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "更新状态失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!task || isSystemRoot) {
      return;
    }

    if (!window.confirm(`确认删除任务「${task.title}」吗？其子任务也会一起删除。`)) {
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);
      await onDeleteTask(task.id);
      setMessage("任务已删除。");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "删除任务失败。");
    } finally {
      setSubmitting(false);
    }
  }

  const panelClassName =
    variant === "floating"
      ? "absolute bottom-2.5 left-2.5 right-2.5 z-20 overflow-auto rounded-[20px] border border-white/[0.1] bg-[rgba(7,10,18,0.92)] p-3.5 shadow-[0_22px_64px_rgba(0,0,0,0.38)] backdrop-blur xl:bottom-auto xl:left-auto xl:right-3 xl:top-3 xl:max-h-[calc(100%-1.5rem)] xl:w-[21rem]"
      : "panel rounded-[18px] p-3.5 xl:sticky xl:top-2.5 xl:h-[calc(100vh-1rem)] xl:overflow-auto";

  if (!task) {
    return (
      <aside className={panelClassName}>
        <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Task Detail</p>
        <h2 className="mt-1.5 text-base font-semibold text-white">节点详情</h2>
        <p className="mt-2 text-sm leading-6 text-text-muted">
          点击导图中的节点后，这里会显示详细信息。快捷键：`Tab` 新建下级，`Enter` 新建同级，`Delete`
          删除当前普通节点。
        </p>
      </aside>
    );
  }

  return (
    <aside className={panelClassName}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Task Detail</p>
          <h2 className="mt-1.5 text-base font-semibold text-white">{task.title}</h2>
          <p className="mt-1.5 text-xs text-text-muted">
            {isSystemRoot ? "系统根节点" : `当前状态：${transitionLabel(taskStatus)} · 子任务 ${task.children.length} 个`}
          </p>
        </div>
        {readOnly ? (
          <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-100">
            历史只读
          </span>
        ) : isOptimisticTask ? (
          <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2.5 py-1 text-xs text-sky-100">
            同步中
          </span>
        ) : isSystemRoot ? (
          <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2.5 py-1 text-xs text-sky-100">
            根节点
          </span>
        ) : null}
      </div>

      <form className="mt-3 space-y-2.5" onSubmit={handleSave}>
        <div>
          <label className="field-label" htmlFor="task-title">
            名称
          </label>
          <input
            ref={titleInputRef}
            className="field-input"
            disabled={!canMutate}
            id="task-title"
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="task-content">
            正文（协同 Markdown）
          </label>
          <TaskDocumentEditor accessToken={accessToken} readOnly={!canMutate} task={task} userName={userName} />
        </div>

        {!isSystemRoot ? (
          <>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="task-assignee">
                  负责人
                </label>
                <select
                  className="field-input"
                  disabled={!canMutate}
                  id="task-assignee"
                  onChange={(event) => setAssigneeUserId(event.target.value)}
                  value={assigneeUserId}
                >
                  <option value="">未分配</option>
                  {memberOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="task-due-at">
                  计划截止时间
                </label>
                <input
                  className="field-input"
                  disabled={!canMutate}
                  id="task-due-at"
                  onChange={(event) => setPlannedDueAt(event.target.value)}
                  type="datetime-local"
                  value={plannedDueAt}
                />
              </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="task-weight">
                  权重
                </label>
                <input
                  className="field-input"
                  disabled={!canMutate}
                  id="task-weight"
                  min="0"
                  onChange={(event) => setWeight(event.target.value)}
                  type="number"
                  value={weight}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="task-score">
                  评分
                </label>
                <input
                  className="field-input"
                  disabled={!canMutate || !canScore}
                  id="task-score"
                  min="0"
                  onChange={(event) => setScore(event.target.value)}
                  type="number"
                  value={score}
                />
              </div>
            </div>
          </>
        ) : (
           <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-sm text-text-muted">
             根节点只作为整个工作空间的导图锚点，不参与状态流转、指派、排期、评分和删除。
           </div>
         )}

        {isOptimisticTask ? (
          <div className="rounded-[16px] border border-sky-400/18 bg-sky-400/6 px-3 py-2.5 text-sm text-sky-100/88">
            节点正在同步到服务端，稍后即可继续编辑。
          </div>
        ) : null}

        <button className="primary-button w-full justify-center" disabled={!canMutate || submitting} type="submit">
          {submitting ? "保存中..." : isSystemRoot ? "保存根节点标题" : "保存节点属性"}
        </button>
      </form>

      {!isSystemRoot ? (
        <div className="mt-3 rounded-[14px] border border-white/[0.08] bg-white/[0.03] p-2.5">
          <p className="text-[10px] uppercase tracking-[0.22em] text-white/34">Status Actions</p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {(["in_progress", "pending_review", "completed", "terminated"] as TaskStatus[]).map((status) => (
              <button
                key={status}
                className={taskStatus === status ? "primary-button" : "secondary-button"}
                disabled={!canMutate || submitting}
                onClick={() => void handleStatusChange(status)}
                type="button"
              >
                {transitionLabel(status)}
              </button>
            ))}
          </div>
          <textarea
            className="field-input mt-2.5 min-h-20 resize-y"
            disabled={!canMutate || submitting}
            onChange={(event) => setRemark(event.target.value)}
            placeholder="退回备注为选填，其他状态也可以补充说明"
            value={remark}
          />
        </div>
      ) : (
        <div className="mt-3 rounded-[14px] border border-white/[0.08] bg-white/[0.03] p-2.5 text-sm text-text-muted">
          <p>快捷键提示</p>
          <p className="mt-1.5 leading-6">Tab 新建下级节点，Enter 为当前节点新增同级节点，Delete 删除当前普通节点。</p>
        </div>
      )}

      {!isSystemRoot ? (
        <div className="mt-3 rounded-[14px] border border-white/[0.08] bg-white/[0.03] p-2.5">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-white/34">Transitions</p>
            {loadingTransitions ? <span className="text-xs text-white/42">加载中...</span> : null}
          </div>
          <div className="mt-2.5 space-y-2">
            {transitions.length ? (
              transitions.slice(0, 6).map((transition) => (
                <div key={transition.id} className="rounded-[12px] border border-white/[0.08] bg-black/10 px-3 py-2">
                  <p className="text-sm text-white/82">
                    {transitionLabel(transition.from_status)} {"->"} {transitionLabel(transition.to_status)}
                  </p>
                  <p className="mt-1 text-xs text-white/42">
                    {new Date(transition.created_at).toLocaleString("zh-CN")} · {transition.action_type}
                  </p>
                  {transition.remark ? <p className="mt-2 text-sm leading-6 text-text-muted">{transition.remark}</p> : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-text-muted">当前还没有状态流转记录。</p>
            )}
          </div>
        </div>
      ) : null}

      {canDelete ? (
        <button
          className="secondary-button mt-3 w-full justify-center border-rose-400/18 text-rose-200 hover:border-rose-400/30 hover:text-rose-100"
          disabled={submitting}
          onClick={() => void handleDelete()}
          type="button"
        >
          删除当前任务
        </button>
      ) : null}

      {message ? <p className="mt-3 text-sm text-emerald-200">{message}</p> : null}
      {error ? <p className="mt-2 text-sm text-rose-300">{error}</p> : null}
    </aside>
  );
}
