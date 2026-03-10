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
        <div className="panel rounded-[22px] px-6 py-4 text-sm text-white/70">正在加载工作空间控制台...</div>
      </main>
    );
  }

  if (!state.session || !state.user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-[1120px] items-center px-4 py-4 sm:px-6 lg:px-8">
        <div className="panel w-full rounded-[24px] p-6 sm:p-7">
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/34">Workspace Console</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">
            先登录，再进入你的 RootSpread 工作空间
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-text-muted sm:text-base">
            当前控制台会读取本地浏览器中的登录会话。完成注册、邮箱验证和登录后，就可以在这里创建工作空间、查看待处理邀请，并进入后续任务工作台。
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
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
      <header className="panel flex flex-col gap-4 rounded-[22px] px-5 py-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/34">Workspace Console</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
            欢迎回来，{state.user.display_name}
          </h1>
          <p className="mt-2 text-sm leading-7 text-text-muted">
            {workspaceCountText}，当前邮箱为 {state.user.email}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className="secondary-button" href="/">
            返回首页
          </Link>
          <button className="secondary-button" onClick={handleLogout} type="button">
            退出登录
          </button>
        </div>
      </header>

      <section className="mt-3 grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="grid gap-3">
          <div className="panel rounded-[20px] p-5">
            <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Create workspace</p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">创建新的团队空间</h2>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              新空间创建完成后，会直接进入左侧固定菜单的管理系统工作台。
            </p>

            <form className="mt-4 space-y-3" onSubmit={handleCreateWorkspace}>
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

          <div className="panel rounded-[20px] p-5">
            <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Invitations</p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">待处理邀请</h2>
            <div className="mt-4 space-y-2">
              {state.invitations.length ? (
                state.invitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] p-4"
                  >
                    <p className="text-sm font-medium text-white/88">{invitation.workspace_name}</p>
                    <p className="mt-2 text-sm leading-6 text-text-muted">
                      邀请角色：{invitation.role} · 截止时间：{new Date(invitation.expires_at).toLocaleString("zh-CN")}
                    </p>
                    <div className="mt-3 rounded-[14px] border border-white/[0.08] bg-[#0c1018] px-3 py-3 text-sm text-white/60">
                      请从邀请邮件进入接受页面，或手动打开
                      <Link className="mx-1 text-accent transition hover:text-white" href="/invitations/accept">
                        /invitations/accept
                      </Link>
                      粘贴 token。
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[16px] border border-dashed border-white/[0.12] px-4 py-5 text-sm text-text-muted">
                  当前没有待处理邀请。后续我会在这里继续接成员管理和邀请接受交互。
                </div>
              )}
            </div>
          </div>
        </div>

        <section className="panel rounded-[20px] p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Workspaces</p>
              <h2 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">你的空间列表</h2>
            </div>
            <p className="text-sm text-text-muted">进入空间后会切换到左侧菜单 + 右侧工作区的紧凑管理台布局。</p>
          </div>

          {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}

          <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {state.workspaces.length ? (
              state.workspaces.map((workspace) => (
                <article
                  key={workspace.id}
                  className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">{workspace.role}</p>
                      <h3 className="mt-3 text-base font-semibold text-white/90">{workspace.name}</h3>
                    </div>
                    <span className="rounded-full border border-white/[0.08] px-2 py-1 text-[10px] text-white/46">
                      {workspace.slug}
                    </span>
                  </div>
                  <p className="mt-4 text-xs text-white/40">
                    创建时间：{new Date(workspace.created_at).toLocaleString("zh-CN")}
                  </p>
                  <div className="mt-4 flex gap-2">
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
              <div className="rounded-[18px] border border-dashed border-white/[0.12] px-5 py-8 text-sm text-text-muted md:col-span-2 2xl:col-span-3">
                你还没有工作空间。先创建一个空间，后续就可以继续接任务树和里程碑界面。
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
