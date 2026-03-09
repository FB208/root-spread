"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  type MessageResponse,
  type TaskStatus,
  type TaskStatusTransition,
  type TaskTreeNode,
  type WorkspaceItem,
  type WorkspaceMember,
  apiRequest,
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth-storage";

type TaskDetailPanelProps = {
  workspaceId: string;
  workspaceRole: WorkspaceItem["role"];
  task: TaskTreeNode | null;
  members: WorkspaceMember[];
  readOnly: boolean;
  onRefresh: () => Promise<void>;
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
  workspaceId,
  workspaceRole,
  task,
  members,
  readOnly,
  onRefresh,
}: TaskDetailPanelProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [plannedDueAt, setPlannedDueAt] = useState("");
  const [weight, setWeight] = useState("0");
  const [score, setScore] = useState("");
  const [remark, setRemark] = useState("");
  const [transitions, setTransitions] = useState<TaskStatusTransition[]>([]);
  const [loadingTransitions, setLoadingTransitions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canScore = workspaceRole === "owner" || workspaceRole === "admin";
  const canMutate = !readOnly && task !== null;
  const taskStatus = task?.status ?? "in_progress";

  useEffect(() => {
    setTitle(task?.title ?? "");
    setContent(task?.content_markdown ?? "");
    setAssigneeUserId(task?.assignee_user_id ?? "");
    setPlannedDueAt(toDateTimeLocal(task?.planned_due_at ?? null));
    setWeight(task ? String(task.weight) : "0");
    setScore(task?.score === null || task?.score === undefined ? "" : String(task.score));
    setRemark("");
    setError(null);
    setMessage(null);
  }, [task]);

  useEffect(() => {
    const session = getStoredSession();
    if (!task || !session?.access_token) {
      setTransitions([]);
      return;
    }

    const currentTask = task;
    const currentSession = session;
    let cancelled = false;

    async function loadTransitions() {
      try {
        setLoadingTransitions(true);
        const response = await apiRequest<TaskStatusTransition[]>(
          `/workspaces/${workspaceId}/tasks/${currentTask.id}/transitions`,
          { token: currentSession.access_token },
        );
        if (!cancelled) {
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
  }, [task, workspaceId]);

  const memberOptions = useMemo(
    () => members.map((member) => ({ label: member.user.display_name, value: member.user.id })),
    [members],
  );

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = getStoredSession();
    if (!session?.access_token || !task) {
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);
      await apiRequest(`/workspaces/${workspaceId}/tasks/${task.id}`, {
        method: "PATCH",
        token: session.access_token,
        json: {
          title,
          content_markdown: content,
          assignee_user_id: assigneeUserId || null,
          planned_due_at: plannedDueAt ? new Date(plannedDueAt).toISOString() : null,
          weight: Number(weight || 0),
          ...(canScore ? { score: score ? Number(score) : null } : {}),
        },
      });
      setMessage("节点详情已保存。");
      await onRefresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存节点失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(status: TaskStatus) {
    const session = getStoredSession();
    if (!session?.access_token || !task) {
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);
      const response = await apiRequest<MessageResponse | TaskTreeNode>(
        `/workspaces/${workspaceId}/tasks/${task.id}/status`,
        {
          method: "POST",
          token: session.access_token,
          json: { status, remark: remark.trim() || null },
        },
      );
      setMessage("status" in response ? null : "状态已更新。");
      setRemark("");
      await onRefresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "更新状态失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    const session = getStoredSession();
    if (!session?.access_token || !task) {
      return;
    }

    if (!window.confirm(`确认删除任务「${task.title}」吗？其子任务也会一起删除。`)) {
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);
      await apiRequest<MessageResponse>(`/workspaces/${workspaceId}/tasks/${task.id}`, {
        method: "DELETE",
        token: session.access_token,
      });
      setMessage("任务已删除。");
      await onRefresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "删除任务失败。");
    } finally {
      setSubmitting(false);
    }
  }

  if (!task) {
    return (
      <aside className="panel rounded-[20px] p-4 xl:sticky xl:top-3 xl:h-[calc(100vh-1.5rem)] xl:overflow-auto">
        <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Task Detail</p>
        <h2 className="mt-2 text-lg font-semibold text-white">节点详情侧栏</h2>
        <p className="mt-3 text-sm leading-7 text-text-muted">
          点击思维导图中的任意节点后，这里会显示详细信息、状态流转记录，以及可编辑字段。
        </p>
      </aside>
    );
  }

  return (
    <aside className="panel rounded-[20px] p-4 xl:sticky xl:top-3 xl:h-[calc(100vh-1.5rem)] xl:overflow-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Task Detail</p>
          <h2 className="mt-2 text-lg font-semibold text-white">{task.title}</h2>
          <p className="mt-2 text-sm text-text-muted">
            当前状态：{transitionLabel(taskStatus)} · 子任务 {task.children.length} 个
          </p>
        </div>
        {readOnly ? (
          <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-100">
            历史只读
          </span>
        ) : null}
      </div>

      <form className="mt-4 space-y-3" onSubmit={handleSave}>
        <div>
          <label className="field-label" htmlFor="task-title">
            名称
          </label>
          <input
            className="field-input"
            disabled={!canMutate}
            id="task-title"
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="task-content">
            内容（Markdown）
          </label>
          <textarea
            className="field-input min-h-32 resize-y"
            disabled={!canMutate}
            id="task-content"
            onChange={(event) => setContent(event.target.value)}
            value={content}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
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

        <div className="grid gap-3 sm:grid-cols-2">
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

        <button className="primary-button w-full justify-center" disabled={!canMutate || submitting} type="submit">
          {submitting ? "保存中..." : "保存节点详情"}
        </button>
      </form>

      <div className="mt-4 rounded-[16px] border border-white/[0.08] bg-white/[0.03] p-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-white/34">Status Actions</p>
        <div className="mt-3 flex flex-wrap gap-2">
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
          className="field-input mt-3 min-h-24 resize-y"
          disabled={!canMutate || submitting}
          onChange={(event) => setRemark(event.target.value)}
          placeholder="退回备注为选填，其他状态也可以补充说明"
          value={remark}
        />
      </div>

      <div className="mt-4 rounded-[16px] border border-white/[0.08] bg-white/[0.03] p-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-white/34">Transitions</p>
          {loadingTransitions ? <span className="text-xs text-white/42">加载中...</span> : null}
        </div>
        <div className="mt-3 space-y-2">
          {transitions.length ? (
            transitions.slice(0, 6).map((transition) => (
              <div key={transition.id} className="rounded-[14px] border border-white/[0.08] bg-black/10 px-3 py-2.5">
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

      <button
        className="secondary-button mt-4 w-full justify-center border-rose-400/18 text-rose-200 hover:border-rose-400/30 hover:text-rose-100"
        disabled={!canMutate || submitting}
        onClick={() => void handleDelete()}
        type="button"
      >
        删除当前任务
      </button>

      {message ? <p className="mt-4 text-sm text-emerald-200">{message}</p> : null}
      {error ? <p className="mt-2 text-sm text-rose-300">{error}</p> : null}
    </aside>
  );
}
