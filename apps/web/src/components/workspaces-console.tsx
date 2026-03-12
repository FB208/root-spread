"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  type AuthSession,
  type AuthUser,
  ApiError,
  type PendingInvitation,
  type WorkspaceCreateResponse,
  type WorkspaceItem,
  apiRequest,
} from "@/lib/api";
import { clearSession, getCachedSession } from "@/lib/auth-storage";

type WorkspaceState = {
  session: AuthSession | null;
  user: AuthUser | null;
  workspaces: WorkspaceItem[];
  invitations: PendingInvitation[];
};

const initialState: WorkspaceState = {
  session: null,
  user: null,
  workspaces: [],
  invitations: [],
};

export function WorkspacesConsole() {
  const [state, setState] = useState<WorkspaceState>(initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const accessToken = state.session?.access_token ?? null;

  async function loadConsole() {
    const session = await getCachedSession();
    if (!session) {
      setState(initialState);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [user, workspaces, invitations] = await Promise.all([
        apiRequest<AuthUser>("/auth/me", { token: session.access_token }),
        apiRequest<WorkspaceItem[]>("/workspaces", { token: session.access_token }),
        apiRequest<PendingInvitation[]>("/workspaces/invitations/pending", {
          token: session.access_token,
        }),
      ]);

      setState({ session, user, workspaces, invitations });
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "加载工作空间失败。";
      setError(message);
      setState(initialState);
      if (loadError instanceof ApiError && loadError.status === 401) {
        clearSession();
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConsole();
  }, []);

  const workspaceCountText = useMemo(() => {
    if (!state.workspaces.length) {
      return "还没有工作空间";
    }

    return `已加入 ${state.workspaces.length} 个工作空间`;
  }, [state.workspaces.length]);

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !createName.trim()) {
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const workspace = await apiRequest<WorkspaceCreateResponse>("/workspaces", {
        method: "POST",
        token: accessToken,
        json: {
          name: createName.trim(),
          slug: createSlug.trim() || undefined,
        },
      });

      setState((current) => ({
        ...current,
        workspaces: [
          {
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug,
            role: "owner",
            created_at: workspace.created_at,
            updated_at: workspace.updated_at,
          },
          ...current.workspaces,
        ],
      }));
      setCreateName("");
      setCreateSlug("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "创建工作空间失败。");
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogout() {
    clearSession();
    setState(initialState);
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-[1480px] items-center justify-center px-4 py-4 sm:px-6 lg:px-8">
        <div className="panel rounded-[18px] px-5 py-3.5 text-sm text-white/70">正在加载工作空间控制台...</div>
      </main>
    );
  }

  if (!state.session || !state.user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-[1120px] items-center px-4 py-4 sm:px-6 lg:px-8">
        <div className="panel w-full rounded-[20px] p-5 sm:p-6">
          <p className="compact-kicker">Workspace Console</p>
          <h1 className="compact-title">先登录，再进入你的 RootSpread 工作空间</h1>
          <p className="compact-copy max-w-2xl sm:text-base">
            当前控制台会读取本地浏览器中的登录会话。完成注册、邮箱验证和登录后，就可以在这里创建工作空间、查看待处理邀请，并进入后续任务工作台。
          </p>
          <div className="compact-chip-row mt-3">
            <span className="compact-chip">本地会话读取</span>
            <span className="compact-chip">工作区入口</span>
            <span className="compact-chip">邀请处理</span>
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Link className="primary-button" href="/auth/login">
              去登录
            </Link>
            <Link className="secondary-button" href="/auth/register">
              创建账号
            </Link>
          </div>
          {error ? <p className="mt-5 text-sm text-rose-300">{error}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1480px] flex-col px-4 py-4 sm:px-6 lg:px-8">
      <header className="panel rounded-[18px] px-4 py-3.5">
        <div className="compact-page-header">
          <div>
            <p className="compact-kicker">Workspace Console</p>
            <h1 className="compact-title">欢迎回来，{state.user.display_name}</h1>
            <p className="compact-copy">
              {workspaceCountText}，当前邮箱为 {state.user.email}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="compact-chip">空间 {state.workspaces.length}</span>
            <span className="compact-chip">待处理邀请 {state.invitations.length}</span>
            <Link className="secondary-button" href="/">
              返回首页
            </Link>
            <button className="secondary-button" onClick={handleLogout} type="button">
              退出登录
            </button>
          </div>
        </div>
      </header>

      <section className="mt-3 grid gap-3 xl:grid-cols-[332px_minmax(0,1fr)]">
        <div className="grid gap-3">
          <div className="panel rounded-[18px] p-4">
            <p className="compact-kicker">Create Workspace</p>
            <h2 className="compact-card-title">创建新的团队空间</h2>
            <p className="compact-card-copy">
              新空间创建完成后，会直接进入左侧固定菜单的管理系统工作台。
            </p>

            <form className="mt-3.5 space-y-2.5" onSubmit={handleCreateWorkspace}>
              <div>
                <label className="field-label" htmlFor="workspace-name">
                  工作空间名称
                </label>
                <input
                  className="field-input"
                  id="workspace-name"
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="例如：RootSpread Core"
                  value={createName}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="workspace-slug">
                  自定义 slug（可选）
                </label>
                <input
                  className="field-input"
                  id="workspace-slug"
                  onChange={(event) => setCreateSlug(event.target.value)}
                  placeholder="例如：rootspread-core"
                  value={createSlug}
                />
              </div>

              <button className="primary-button w-full justify-center" disabled={submitting} type="submit">
                {submitting ? "创建中..." : "创建工作空间"}
              </button>
            </form>
          </div>

          <div className="panel rounded-[18px] p-4">
            <p className="compact-kicker">Invitations</p>
            <h2 className="compact-card-title">待处理邀请</h2>
            <div className="mt-3 space-y-2">
              {state.invitations.length ? (
                state.invitations.map((invitation) => (
                  <div key={invitation.id} className="compact-list-card">
                    <p className="text-sm font-medium text-white/88">{invitation.workspace_name}</p>
                    <p className="mt-1.5 text-[13px] leading-6 text-text-muted">
                      邀请角色：{invitation.role} · 截止时间：{new Date(invitation.expires_at).toLocaleString("zh-CN")}
                    </p>
                    <div className="compact-note mt-2.5">
                      请从邀请邮件进入接受页面，或手动打开
                      <Link className="mx-1 text-accent transition hover:text-white" href="/invitations/accept">
                        /invitations/accept
                      </Link>
                      粘贴 token。
                    </div>
                  </div>
                ))
              ) : (
                <div className="compact-empty-state">
                  当前没有待处理邀请。后续我会在这里继续接成员管理和邀请接受交互。
                </div>
              )}
            </div>
          </div>
        </div>

        <section className="panel rounded-[18px] p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="compact-kicker">Workspaces</p>
              <h2 className="compact-card-title">你的空间列表</h2>
            </div>
            <p className="text-xs text-text-muted">进入空间后会切换到左侧菜单 + 右侧工作区的紧凑管理台布局。</p>
          </div>

          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}

          <div className="mt-3 grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
            {state.workspaces.length ? (
              state.workspaces.map((workspace) => (
                <article key={workspace.id} className="compact-list-card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="compact-kicker">{workspace.role}</p>
                      <h3 className="mt-2 text-[15px] font-semibold text-white/90">{workspace.name}</h3>
                    </div>
                    <span className="compact-chip">
                      {workspace.slug}
                    </span>
                  </div>
                  <p className="mt-3 text-[11px] text-white/40">
                    创建时间：{new Date(workspace.created_at).toLocaleString("zh-CN")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link className="primary-button" href={`/workspaces/${workspace.id}/tasks`}>
                      进入工作台
                    </Link>
                    <Link className="secondary-button" href={`/workspaces/${workspace.id}/members`}>
                      成员与邀请
                    </Link>
                  </div>
                </article>
              ))
            ) : (
              <div className="compact-empty-state md:col-span-2 2xl:col-span-3">
                你还没有工作空间。先创建一个空间，后续就可以继续接任务树和里程碑界面。
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
