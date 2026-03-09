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
      <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-6 py-10 sm:px-8 lg:px-12">
        <div className="panel rounded-[28px] px-8 py-6 text-sm text-white/72">正在加载统计与审计日志...</div>
      </main>
    );
  }

  if (!stats) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl px-6 py-10 sm:px-8 lg:px-12">
        <div className="panel w-full rounded-[32px] p-8 sm:p-10">
          <p className="text-xs uppercase tracking-[0.34em] text-white/38">Stats</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white">暂时无法读取统计信息</h1>
          <p className="mt-5 text-sm leading-8 text-text-muted sm:text-base">{error ?? "请确认当前账号有访问该工作空间的权限。"}</p>
          <div className="mt-8 flex gap-3">
            <Link className="primary-button" href={`/workspaces/${workspaceId}`}>
              返回工作台
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
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.34em] text-white/38">Stats & Audit</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              工作空间统计入口
            </h1>
            <p className="mt-3 text-sm leading-7 text-text-muted">
              这里先提供基础统计概览和最近审计日志，后续可以继续加燃尽、成员得分、里程碑趋势等图表。
            </p>
          </div>
          <Link className="primary-button" href={`/workspaces/${workspaceId}`}>
            返回工作台
          </Link>
        </div>
      </header>

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["当前任务", stats.active_task_count],
          ["已归档任务", stats.archived_task_count],
          ["团队成员", stats.member_count],
          ["待处理邀请", stats.pending_invitation_count],
          ["里程碑", stats.milestone_count],
        ].map(([label, value]) => (
          <article key={String(label)} className="panel rounded-[26px] px-5 py-5">
            <p className="text-xs uppercase tracking-[0.24em] text-white/38">{label}</p>
            <p className="mt-4 text-3xl font-semibold text-white/90">{value}</p>
          </article>
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="panel rounded-[28px] p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-white/38">Task Status</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">当前任务状态分布</h2>
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
          <div className="mt-8 rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-4 text-sm text-text-muted">
            最近共记录 {stats.recent_activity_count} 条审计事件，后续可以基于此继续扩展审计筛选和操作追踪。
          </div>
        </div>

        <div className="panel rounded-[28px] p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-white/38">Audit Trail</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">最近审计日志</h2>
          <div className="mt-6 space-y-3">
            {logs.length ? (
              logs.map((log) => (
                <article key={log.id} className="rounded-[22px] border border-white/[0.08] bg-white/[0.04] px-4 py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm font-medium text-white/86">{log.message}</p>
                    <span className="text-xs text-white/42">
                      {new Date(log.created_at).toLocaleString("zh-CN")}
                    </span>
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
    </main>
  );
}
