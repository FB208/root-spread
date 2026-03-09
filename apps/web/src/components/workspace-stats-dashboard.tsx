"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { type AuditLog, type WorkspaceStats, apiRequest } from "@/lib/api";
import { getStoredSession } from "@/lib/auth-storage";

type WorkspaceStatsDashboardProps = {
  workspaceId: string;
};

export function WorkspaceStatsDashboard({ workspaceId }: WorkspaceStatsDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    const session = getStoredSession();
    if (!session?.access_token) {
      setError("请先登录，再查看统计页。");
      setLoading(false);
      return;
    }

    let cancelled = false;
    const currentSession = session;

    async function loadStats() {
      try {
        setLoading(true);
        setError(null);
        const [statsResponse, logsResponse] = await Promise.all([
          apiRequest<WorkspaceStats>(`/workspaces/${workspaceId}/stats`, {
            token: currentSession.access_token,
          }),
          apiRequest<AuditLog[]>(`/workspaces/${workspaceId}/audit-logs`, {
            token: currentSession.access_token,
          }),
        ]);

        if (!cancelled) {
          setStats(statsResponse);
          setLogs(logsResponse);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载统计数据失败。");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadStats();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (loading) {
    return (
      <section className="panel rounded-[20px] px-6 py-4 text-sm text-white/72">
        正在加载统计与审计日志...
      </section>
    );
  }

  if (!stats) {
    return (
      <section className="panel rounded-[24px] p-6 sm:p-7">
        <p className="text-[10px] uppercase tracking-[0.3em] text-white/34">Stats</p>
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">暂时无法读取统计信息</h2>
        <p className="mt-4 text-sm leading-7 text-text-muted sm:text-base">
          {error ?? "请确认当前账号有访问该工作空间的权限。"}
        </p>
        <div className="mt-8 flex gap-3">
          <Link className="primary-button" href={`/workspaces/${workspaceId}/tasks`}>
            返回任务工作台
          </Link>
          <Link className="secondary-button" href="/auth/login">
            去登录
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <section className="panel rounded-[20px] px-5 py-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-white/34">Stats & Audit</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
              工作空间统计入口
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              这里专门收纳空间统计概览与最近审计日志，避免继续占用任务工作台的主操作区。
            </p>
          </div>
          <Link className="secondary-button" href={`/workspaces/${workspaceId}/tasks`}>
            返回任务工作台
          </Link>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["当前任务", stats.active_task_count],
          ["已归档任务", stats.archived_task_count],
          ["团队成员", stats.member_count],
          ["待处理邀请", stats.pending_invitation_count],
          ["里程碑", stats.milestone_count],
        ].map(([label, value]) => (
          <article key={String(label)} className="panel rounded-[18px] px-4 py-4">
            <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">{label}</p>
            <p className="mt-3 text-2xl font-semibold text-white/90">{value}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="panel rounded-[20px] p-5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Task Status</p>
          <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">当前任务状态分布</h3>
          <div className="mt-6 space-y-4">
            {[
              ["进行中", stats.in_progress_task_count, "#7aa2ff"],
              ["待验证", stats.pending_review_task_count, "#fbbf24"],
              ["已完成", stats.completed_task_count, "#34d399"],
              ["终止", stats.terminated_task_count, "#fb7185"],
            ].map(([label, value, color]) => (
              <div key={String(label)}>
                <div className="flex items-center justify-between gap-3 text-sm text-white/78">
                  <span>{label}</span>
                  <span>{value}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      background: String(color),
                      width: `${stats.active_task_count ? (Number(value) / stats.active_task_count) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-[16px] border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-text-muted">
            最近共记录 {stats.recent_activity_count} 条审计事件，后续可以继续扩展趋势图、成员维度和审计筛选能力。
          </div>
        </div>

        <div className="panel rounded-[20px] p-5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Audit Trail</p>
          <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">最近审计日志</h3>
          <div className="mt-4 space-y-3">
            {logs.length ? (
              logs.map((log) => (
                <article key={log.id} className="rounded-[22px] border border-white/[0.08] bg-white/[0.04] px-4 py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm font-medium text-white/86">{log.message}</p>
                    <span className="text-xs text-white/42">{new Date(log.created_at).toLocaleString("zh-CN")}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/52">
                    <span className="rounded-full border border-white/10 px-2.5 py-1">{log.action}</span>
                    <span className="rounded-full border border-white/10 px-2.5 py-1">{log.entity_type}</span>
                    {log.entity_id ? (
                      <span className="rounded-full border border-white/10 px-2.5 py-1">{log.entity_id}</span>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-white/[0.12] px-5 py-8 text-sm text-text-muted">
                当前还没有审计日志。
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
