"use client";

import Link from "next/link";
import { type FormEvent, useMemo, useState } from "react";

import { useWorkspaceContext } from "@/components/workspace-context";
import { type Milestone, apiRequest } from "@/lib/api";

type WorkspaceMilestonesPageProps = {
  workspaceId: string;
};

export function WorkspaceMilestonesPage({ workspaceId }: WorkspaceMilestonesPageProps) {
  const { accessToken, milestones, refreshWorkspaceData, workspace } = useWorkspaceContext();
  const [milestoneName, setMilestoneName] = useState("");
  const [milestoneDescription, setMilestoneDescription] = useState("");
  const [milestoneTargetAt, setMilestoneTargetAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const sortedMilestones = useMemo(
    () => [...milestones].sort((left, right) => new Date(right.target_at).getTime() - new Date(left.target_at).getTime()),
    [milestones],
  );

  if (!workspace) {
    return null;
  }

  async function handleCreateMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !milestoneName.trim() || !milestoneTargetAt) {
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);

      const milestone = await apiRequest<Milestone>(`/workspaces/${workspaceId}/milestones`, {
        method: "POST",
        token: accessToken,
        json: {
          description: milestoneDescription.trim() || null,
          name: milestoneName.trim(),
          target_at: new Date(milestoneTargetAt).toISOString(),
        },
      });

      setMilestoneName("");
      setMilestoneDescription("");
      setMilestoneTargetAt("");
      setMessage(`里程碑「${milestone.name}」已创建，可前往任务工作台查看快照。`);
      await refreshWorkspaceData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "创建里程碑失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <section className="panel rounded-[20px] px-5 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Milestone Console</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
              管理阶段归档与历史快照
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted sm:text-base">
              把里程碑抽成独立页面后，任务区只负责执行，阶段归档、历史追溯和时间节点统一在这里管理。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:w-[360px]">
            <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Milestones</p>
              <p className="mt-2 text-lg font-semibold text-white/90">{milestones.length}</p>
            </div>
            <Link
              className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-4 py-3 transition hover:border-white/[0.18] hover:bg-white/[0.06]"
              href={`/workspaces/${workspaceId}/tasks`}
            >
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Tasks</p>
              <p className="mt-2 text-sm font-semibold text-white/90">返回当前任务视图</p>
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="panel rounded-[20px] p-5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Create Milestone</p>
          <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">创建新的阶段归档</h3>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            设定阶段名称、说明和目标时间，归档后可以直接从任务工作台切换到对应快照视图。
          </p>

          <form className="mt-4 space-y-3" onSubmit={handleCreateMilestone}>
            <div>
              <label className="field-label" htmlFor="milestone-name">
                里程碑名称
              </label>
              <input
                className="field-input"
                id="milestone-name"
                onChange={(event) => setMilestoneName(event.target.value)}
                placeholder="例如：Beta 内测收口"
                value={milestoneName}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="milestone-description">
                描述
              </label>
              <textarea
                className="field-input min-h-36 resize-y"
                id="milestone-description"
                onChange={(event) => setMilestoneDescription(event.target.value)}
                placeholder="说明这个阶段要冻结哪些任务、保留哪些上下文。"
                value={milestoneDescription}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="milestone-target-at">
                目标时间
              </label>
              <input
                className="field-input"
                id="milestone-target-at"
                onChange={(event) => setMilestoneTargetAt(event.target.value)}
                type="datetime-local"
                value={milestoneTargetAt}
              />
            </div>

            <button className="primary-button w-full justify-center" disabled={submitting} type="submit">
              {submitting ? "创建中..." : "创建里程碑"}
            </button>
          </form>

          {message ? <p className="mt-5 text-sm text-emerald-200">{message}</p> : null}
          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
        </div>

        <div className="panel rounded-[20px] p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Snapshots</p>
              <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">已创建的里程碑</h3>
            </div>
            <p className="text-sm text-text-muted">点击任意里程碑可直接进入任务工作台并查看该快照。</p>
          </div>

          <div className="mt-4 space-y-3">
            <Link
              className="block rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-4 py-4 transition hover:border-white/[0.18] hover:bg-white/[0.06]"
              href={`/workspaces/${workspaceId}/tasks`}
            >
              <p className="text-sm font-semibold text-white/88">当前任务视图</p>
              <p className="mt-2 text-sm text-text-muted">回到实时任务树，继续处理未归档节点。</p>
            </Link>

            {sortedMilestones.length ? (
              sortedMilestones.map((milestone) => (
                <article
                  key={milestone.id}
                  className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-4 py-4"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-lg font-semibold text-white/90">{milestone.name}</p>
                      <p className="mt-2 text-sm leading-7 text-text-muted">
                        {milestone.description || "当前里程碑没有额外描述。"}
                      </p>
                    </div>
                    <Link
                      className="primary-button justify-center"
                      href={`/workspaces/${workspaceId}/tasks?milestone=${milestone.id}`}
                    >
                      查看快照
                    </Link>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3 text-xs text-white/50">
                    <span>归档任务 {milestone.archived_task_count} 项</span>
                    <span>目标时间 {new Date(milestone.target_at).toLocaleString("zh-CN")}</span>
                    <span>创建时间 {new Date(milestone.created_at).toLocaleString("zh-CN")}</span>
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-[24px] border border-dashed border-white/[0.12] px-5 py-8 text-sm text-text-muted">
                当前还没有里程碑。先创建一个阶段节点，后续就可以从任务工作台切换查看历史快照。
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
