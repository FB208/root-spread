"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  type AuthSession,
  type AuthUser,
  type PendingInvitation,
  type WorkspaceCreateResponse,
  type WorkspaceItem,
  apiRequest,
} from "@/lib/api";
import { clearSession, getStoredSession } from "@/lib/auth-storage";

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
    const session = getStoredSession();
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
      clearSession();
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
      <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-6 py-10 sm:px-8 lg:px-12">
        <div className="panel rounded-[28px] px-8 py-6 text-sm text-white/70">正在加载工作空间控制台...</div>
      </main>
    );
  }

  if (!state.session || !state.user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-10 sm:px-8 lg:px-12">
        <div className="panel w-full rounded-[32px] p-8 sm:p-10">
          <p className="text-xs uppercase tracking-[0.34em] text-white/38">Workspace Console</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white">
            先登录，再进入你的 RootSpread 工作空间
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-8 text-text-muted sm:text-base">
            当前控制台会读取本地浏览器中的登录会话。完成注册、邮箱验证和登录后，就可以在这里创建工作空间、查看待处理邀请，并进入后续任务工作台。
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link className="primary-button" href="/auth/login">
              去登录
            </Link>
            <Link className="secondary-button" href="/auth/register">
              创建账号
            </Link>
          </div>
          {error ? <p className="mt-6 text-sm text-rose-300">{error}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 sm:px-8 lg:px-12">
      <header className="panel flex flex-col gap-5 rounded-[32px] px-6 py-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.34em] text-white/38">Workspace Console</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
            欢迎回来，{state.user.display_name}
          </h1>
          <p className="mt-3 text-sm leading-7 text-text-muted">
            {workspaceCountText}，当前邮箱为 {state.user.email}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link className="secondary-button" href="/">
            返回首页
          </Link>
          <button className="secondary-button" onClick={handleLogout} type="button">
            退出登录
          </button>
        </div>
      </header>

      <section className="mt-6 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="panel rounded-[28px] p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-white/38">Create workspace</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">
            创建新的团队空间
          </h2>
          <p className="mt-3 text-sm leading-7 text-text-muted">
            先建立工作空间，后续就可以继续接入任务树、里程碑和成员协作页面。
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleCreateWorkspace}>
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

        <div className="panel rounded-[28px] p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-white/38">Invitations</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">
            待处理邀请
          </h2>
          <div className="mt-6 space-y-3">
            {state.invitations.length ? (
              state.invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="rounded-3xl border border-white/[0.08] bg-white/[0.04] p-4"
                >
                  <p className="text-sm font-medium text-white/88">{invitation.workspace_name}</p>
                  <p className="mt-2 text-sm leading-7 text-text-muted">
                    邀请角色：{invitation.role} · 截止时间：{new Date(invitation.expires_at).toLocaleString("zh-CN")}
                  </p>
                  <div className="mt-4 rounded-2xl border border-white/[0.08] bg-[#081120] px-4 py-3 text-sm text-white/60">
                    请从邀请邮件进入接受页面，或手动打开
                    <Link className="mx-1 text-accent transition hover:text-white" href="/invitations/accept">
                      /invitations/accept
                    </Link>
                    粘贴 token。
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-white/[0.12] px-5 py-6 text-sm text-text-muted">
                当前没有待处理邀请。后续我会在这里继续接成员管理和邀请接受交互。
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mt-6 panel rounded-[28px] p-6 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-white/38">Workspaces</p>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">
              你的空间列表
            </h2>
          </div>
          <p className="text-sm text-text-muted">下一步将从这里进入任务工作台和里程碑视图。</p>
        </div>

        {error ? <p className="mt-5 text-sm text-rose-300">{error}</p> : null}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {state.workspaces.length ? (
            state.workspaces.map((workspace) => (
              <article
                key={workspace.id}
                className="rounded-[26px] border border-white/[0.08] bg-white/[0.04] p-5"
              >
                <p className="text-xs uppercase tracking-[0.24em] text-white/38">{workspace.role}</p>
                <h3 className="mt-4 text-lg font-semibold text-white/90">{workspace.name}</h3>
                <p className="mt-2 text-sm text-text-muted">slug: {workspace.slug}</p>
                <p className="mt-6 text-xs text-white/40">
                  创建时间：{new Date(workspace.created_at).toLocaleString("zh-CN")}
                </p>
                <div className="mt-5 flex gap-3">
                  <Link className="primary-button" href={`/workspaces/${workspace.id}`}>
                    进入空间
                  </Link>
                  <Link className="secondary-button" href={`/workspaces/${workspace.id}#members`}>
                    成员
                  </Link>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-3xl border border-dashed border-white/[0.12] px-5 py-8 text-sm text-text-muted md:col-span-2 xl:col-span-3">
              你还没有工作空间。先创建一个空间，后续就可以继续接任务树和里程碑界面。
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
