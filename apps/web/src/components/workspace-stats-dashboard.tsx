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
      <section className="panel rounded-[18px] px-5 py-3.5 text-sm text-white/72">
        正在加载统计与审计日志...
      </section>
    );
  }

  if (!stats) {
    return (
      <section className="panel rounded-[18px] p-5 sm:p-6">
        <p className="compact-kicker">Stats</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">暂时无法读取统计信息</h2>
        <p className="mt-3 text-sm leading-6 text-text-muted sm:text-base">
          {error ?? "请确认当前账号有访问该工作空间的权限。"}
        </p>
        <div className="mt-5 flex gap-2">
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
      <section className="panel rounded-[18px] px-4 py-3.5">
        <div className="compact-page-header">
          <div>
            <p className="compact-kicker">Stats & Audit</p>
            <h2 className="compact-title">工作空间统计入口</h2>
            <p className="compact-copy">
              这里专门收纳空间统计概览与最近审计日志，避免继续占用任务工作台的主操作区。
            </p>
          </div>
          <div className="compact-chip-row">
            <span className="compact-chip">任务 {stats.active_task_count}</span>
            <span className="compact-chip">成员 {stats.member_count}</span>
            <Link className="secondary-button" href={`/workspaces/${workspaceId}/tasks`}>
              返回任务工作台
            </Link>
          </div>
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
          <article key={String(label)} className="compact-metric-card">
            <p className="compact-metric-label">{label}</p>
            <p className="compact-metric-value">{value}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="panel rounded-[18px] p-4">
          <p className="compact-kicker">Task Status</p>
          <h3 className="compact-card-title">当前任务状态分布</h3>
          <div className="mt-4 space-y-3">
            {[
              ["进行中", stats.in_progress_task_count, "#7aa2ff"],
              ["待验证", stats.pending_review_task_count, "#fbbf24"],
              ["已完成", stats.completed_task_count, "#34d399"],
              ["终止", stats.terminated_task_count, "#fb7185"],
            ].map(([label, value, color]) => (
              <div key={String(label)}>
                <div className="flex items-center justify-between gap-3 text-[13px] text-white/78">
                  <span>{label}</span>
                  <span>{value}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.06]">
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
          <div className="compact-section-card mt-4 text-sm text-text-muted">
            最近共记录 {stats.recent_activity_count} 条审计事件，后续可以继续扩展趋势图、成员维度和审计筛选能力。
          </div>
        </div>

        <div className="panel rounded-[18px] p-4">
          <p className="compact-kicker">Audit Trail</p>
          <h3 className="compact-card-title">最近审计日志</h3>
          <div className="mt-3 space-y-2.5">
            {logs.length ? (
              logs.map((log) => (
                <article key={log.id} className="compact-list-card">
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm font-medium text-white/86">{log.message}</p>
                    <span className="text-[11px] text-white/42">{new Date(log.created_at).toLocaleString("zh-CN")}</span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs text-white/52">
                    <span className="compact-chip">{log.action}</span>
                    <span className="compact-chip">{log.entity_type}</span>
                    {log.entity_id ? (
                      <span className="compact-chip">{log.entity_id}</span>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <div className="compact-empty-state">
                当前还没有审计日志。
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
