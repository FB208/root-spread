"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  GitBranchPlus,
  LayoutPanelLeft,
  Menu,
  Users2,
  X,
} from "lucide-react";

import { WorkspaceProvider, useWorkspaceContext } from "@/components/workspace-context";

type WorkspaceShellProps = {
  children: ReactNode;
  workspaceId: string;
};

type WorkspaceShellFrameProps = WorkspaceShellProps;

export function WorkspaceShell({ children, workspaceId }: WorkspaceShellProps) {
  return (
    <WorkspaceProvider workspaceId={workspaceId}>
      <WorkspaceShellFrame workspaceId={workspaceId}>{children}</WorkspaceShellFrame>
    </WorkspaceProvider>
  );
}

function WorkspaceShellFrame({ children, workspaceId }: WorkspaceShellFrameProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { error, loading, members, milestones, refreshWorkspaceData, session, workspace } = useWorkspaceContext();

  const navItems = useMemo(
    () => [
      {
        description: "导图、表格、详情侧栏",
        href: `/workspaces/${workspaceId}/tasks`,
        icon: LayoutPanelLeft,
        label: "任务工作台",
      },
      {
        description: "阶段归档与历史快照",
        href: `/workspaces/${workspaceId}/milestones`,
        icon: GitBranchPlus,
        label: "里程碑",
      },
      {
        description: "邀请、成员与角色",
        href: `/workspaces/${workspaceId}/members`,
        icon: Users2,
        label: "成员与邀请",
      },
      {
        description: "数据概览与审计流",
        href: `/workspaces/${workspaceId}/stats`,
        icon: BarChart3,
        label: "统计与审计",
      },
    ],
    [workspaceId],
  );

  if (loading) {
    return (
      <main className="min-h-screen px-4 py-4 md:pl-[17rem] md:pr-4">
        <div className="flex min-h-[calc(100vh-2rem)] items-center justify-center">
          <div className="panel rounded-[22px] px-6 py-4 text-sm text-white/72">正在构建工作台布局...</div>
        </div>
      </main>
    );
  }

  if (!workspace) {
    return (
      <main className="min-h-screen px-4 py-4 md:pl-[17rem] md:pr-4">
        <div className="flex min-h-[calc(100vh-2rem)] items-center justify-center">
          <div className="panel w-full max-w-3xl rounded-[24px] p-7 sm:p-8">
            <p className="text-[11px] uppercase tracking-[0.28em] text-white/34">Workspace Studio</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">暂时无法进入这个工作空间</h1>
            <p className="mt-4 text-sm leading-7 text-text-muted">
              {error ?? "请先登录，或确认当前账号已经加入该工作空间。"}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link className="primary-button" href="/workspaces">
                返回空间列表
              </Link>
              {!session ? (
                <Link className="secondary-button" href="/auth/login">
                  去登录
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      {mobileMenuOpen ? (
        <button
          aria-label="关闭工作台菜单"
          className="fixed inset-0 z-40 bg-black/66 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          type="button"
        />
      ) : null}

      <div className="min-h-screen md:grid md:h-screen md:grid-cols-[16.5rem_minmax(0,1fr)]">
        <aside
          className={`workspace-sidebar panel fixed inset-y-0 left-0 z-50 w-[16.5rem] rounded-none transition duration-200 md:sticky md:top-0 md:z-20 md:h-screen md:translate-x-0 ${
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-full flex-col overflow-y-auto px-4 py-4">
            <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] pb-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-white/34">RootSpread</p>
                <h1 className="mt-2 text-base font-semibold text-white/92">{workspace.name}</h1>
                <p className="mt-1 text-xs text-text-muted">{workspace.slug}</p>
              </div>
              <button
                aria-label="关闭菜单"
                className="secondary-button !h-8 !min-h-8 !rounded-xl !px-2.5 md:hidden"
                onClick={() => setMobileMenuOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.22em] text-white/30">Role</p>
                <p className="mt-1 text-xs font-medium text-white/86">{workspace.role}</p>
              </div>
              <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.22em] text-white/30">Members</p>
                <p className="mt-1 text-xs font-medium text-white/86">{members.length} 人</p>
              </div>
              <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.22em] text-white/30">Milestones</p>
                <p className="mt-1 text-xs font-medium text-white/86">{milestones.length} 个</p>
              </div>
              <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.22em] text-white/30">Mode</p>
                <p className="mt-1 text-xs font-medium text-white/86">Studio</p>
              </div>
            </div>

            <nav className="mt-5 flex flex-1 flex-col gap-1.5">
              <p className="px-1 text-[10px] uppercase tracking-[0.26em] text-white/24">Workspace Modules</p>
              {navItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    className="workspace-nav-link"
                    data-active={active ? "true" : "false"}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <span className="workspace-nav-icon">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold">{item.label}</span>
                      <span className="mt-1 block text-[11px] leading-5 text-white/40">{item.description}</span>
                    </span>
                  </Link>
                );
              })}
            </nav>

            <div className="space-y-2 border-t border-white/[0.06] pt-4">
              <button className="secondary-button w-full" onClick={() => void refreshWorkspaceData()} type="button">
                刷新空间数据
              </button>
              <Link className="secondary-button w-full" href="/workspaces" onClick={() => setMobileMenuOpen(false)}>
                <ArrowLeft className="h-4 w-4" />
                返回空间列表
              </Link>
            </div>
          </div>
        </aside>

        <main className="min-w-0 md:h-screen">
          <div className="flex h-full min-h-0 flex-col">
            <header className="panel m-3 flex items-center justify-between rounded-[18px] px-4 py-3 md:hidden">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-white/30">Workspace</p>
                <p className="mt-1 text-sm font-semibold text-white/90">{workspace.name}</p>
              </div>
              <button className="secondary-button" onClick={() => setMobileMenuOpen(true)} type="button">
                <Menu className="h-4 w-4" />
                菜单
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-0 md:pt-3">
              {error ? (
                <div className="mb-3 rounded-[16px] border border-amber-400/18 bg-amber-400/8 px-4 py-3 text-sm text-amber-100">
                  工作空间信息刷新失败：{error}
                </div>
              ) : null}

              <div className="min-w-0">{children}</div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
