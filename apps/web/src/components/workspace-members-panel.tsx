"use client";

import { type FormEvent, useMemo, useState } from "react";

import {
  type MessageResponse,
  type WorkspaceInvitation,
  type WorkspaceInvitationDispatchResponse,
  type WorkspaceItem,
  type WorkspaceMember,
  apiRequest,
} from "@/lib/api";
import { getStoredSession } from "@/lib/auth-storage";

type WorkspaceMembersPanelProps = {
  invitations: WorkspaceInvitation[];
  workspaceId: string;
  workspaceRole: WorkspaceItem["role"];
  members: WorkspaceMember[];
  onRefresh: () => Promise<void>;
};

export function WorkspaceMembersPanel({
  invitations,
  workspaceId,
  workspaceRole,
  members,
  onRefresh,
}: WorkspaceMembersPanelProps) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [debugToken, setDebugToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const canManage = workspaceRole === "owner" || workspaceRole === "admin";
  const sortedMembers = useMemo(
    () => [...members].sort((left, right) => left.role.localeCompare(right.role)),
    [members],
  );
  const sortedInvitations = useMemo(() => [...invitations], [invitations]);

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied((current) => (current === label ? null : current)), 1800);
    } catch {
      setError("复制失败，请手动复制内容。");
    }
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = getStoredSession();
    if (!session?.access_token || !inviteEmail.trim()) {
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);
      setDebugToken(null);

      const response = await apiRequest<WorkspaceInvitationDispatchResponse>(
        `/workspaces/${workspaceId}/invitations`,
        {
          method: "POST",
          token: session.access_token,
          json: {
            email: inviteEmail.trim(),
            role: inviteRole,
          },
        },
      );

      setMessage(response.message);
      setDebugToken(response.debug_invitation_token ?? null);
      setInviteEmail("");
      await onRefresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "发送邀请失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevokeInvitation(invitationId: string) {
    const session = getStoredSession();
    if (!session?.access_token) {
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);
      await apiRequest<MessageResponse>(`/workspaces/${workspaceId}/invitations/${invitationId}`, {
        method: "DELETE",
        token: session.access_token,
      });
      setMessage("邀请已撤销。");
      await onRefresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "撤销邀请失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveMember(memberId: string, displayName: string) {
    const session = getStoredSession();
    if (!session?.access_token) {
      return;
    }

    if (!window.confirm(`确认将成员「${displayName}」移出工作空间吗？`)) {
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);
      await apiRequest<MessageResponse>(`/workspaces/${workspaceId}/members/${memberId}`, {
        method: "DELETE",
        token: session.access_token,
      });
      setMessage("成员已移除。");
      await onRefresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "移除成员失败。");
    } finally {
      setSubmitting(false);
    }
  }

  const debugAcceptUrl =
    debugToken && typeof window !== "undefined"
      ? `${window.location.origin}/invitations/accept?token=${encodeURIComponent(debugToken)}`
      : null;

  async function handleRoleChange(memberId: string, role: "admin" | "member") {
    const session = getStoredSession();
    if (!session?.access_token) {
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setMessage(null);
      await apiRequest(`/workspaces/${workspaceId}/members/${memberId}`, {
        method: "PATCH",
        token: session.access_token,
        json: { role },
      });
      setMessage("成员角色已更新。");
      await onRefresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "更新成员角色失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel rounded-[28px] p-6 sm:p-8" id="members">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-white/38">Members</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">团队成员管理</h2>
        </div>
        <p className="text-sm text-text-muted">
          当前共 {members.length} 人{canManage ? "，可邀请成员并调整角色。" : "，当前账号仅可查看。"}
        </p>
      </div>

      {canManage ? (
        <form className="mt-6 grid gap-4 lg:grid-cols-[1fr_180px_auto]" onSubmit={handleInvite}>
          <input
            className="field-input"
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="邀请成员邮箱"
            type="email"
            value={inviteEmail}
          />
          <select
            className="field-input"
            onChange={(event) => setInviteRole(event.target.value as "admin" | "member")}
            value={inviteRole}
          >
            <option value="member">成员</option>
            <option value="admin">管理员</option>
          </select>
          <button className="primary-button justify-center" disabled={submitting} type="submit">
            {submitting ? "发送中..." : "发送邀请"}
          </button>
        </form>
      ) : null}

      {message ? <p className="mt-5 text-sm text-emerald-200">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      {debugToken ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-[#081120] p-4 text-xs text-white/78">
          <p className="text-white/56">最近一次邀请调试信息</p>
          <code className="mt-3 block overflow-x-auto rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
            邀请 token: {debugToken}
          </code>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="secondary-button" onClick={() => void copyText("token", debugToken)} type="button">
              {copied === "token" ? "已复制 token" : "复制 token"}
            </button>
            {debugAcceptUrl ? (
              <button
                className="secondary-button"
                onClick={() => void copyText("invite-link", debugAcceptUrl)}
                type="button"
              >
                {copied === "invite-link" ? "已复制链接" : "复制接受链接"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-6 rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/38">Invitations</p>
            <h3 className="mt-3 text-lg font-semibold text-white/88">邀请状态</h3>
          </div>
          <p className="text-sm text-text-muted">展示当前工作空间的邀请记录与处理状态。</p>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedInvitations.length ? (
            sortedInvitations.map((invitation) => {
              const invitationState = invitation.revoked_at
                ? "已撤销"
                : invitation.accepted_at
                  ? "已接受"
                  : "待接受";

              return (
                <article
                  key={invitation.id}
                  className="rounded-[22px] border border-white/[0.08] bg-white/[0.03] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-white/88">{invitation.email}</p>
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/70">
                      {invitationState}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-text-muted">
                    <p>角色：{invitation.role}</p>
                    <p>过期：{new Date(invitation.expires_at).toLocaleString("zh-CN")}</p>
                    <p>创建：{new Date(invitation.created_at).toLocaleString("zh-CN")}</p>
                  </div>
                  {!invitation.accepted_at && !invitation.revoked_at && canManage ? (
                    <button
                      className="secondary-button mt-4"
                      disabled={submitting}
                      onClick={() => void handleRevokeInvitation(invitation.id)}
                      type="button"
                    >
                      撤销邀请
                    </button>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-white/[0.12] px-4 py-5 text-sm text-text-muted md:col-span-2 xl:col-span-3">
              当前还没有邀请记录。
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sortedMembers.map((member) => (
          <article
            key={member.id}
            className="rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-white/88">{member.user.display_name}</p>
                <p className="mt-1 text-sm text-text-muted">{member.user.email}</p>
              </div>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/72">
                {member.role}
              </span>
            </div>
            <p className="mt-4 text-xs text-white/42">
              加入时间：{new Date(member.joined_at).toLocaleString("zh-CN")}
            </p>

            {canManage && member.role !== "owner" ? (
              <div className="mt-5">
                <label className="field-label" htmlFor={`member-role-${member.id}`}>
                  角色调整
                </label>
                <select
                  className="field-input"
                  id={`member-role-${member.id}`}
                  onChange={(event) => void handleRoleChange(member.id, event.target.value as "admin" | "member")}
                  value={member.role}
                >
                  <option value="member">成员</option>
                  <option value="admin">管理员</option>
                </select>
                <button
                  className="secondary-button mt-4 w-full justify-center border-rose-400/18 text-rose-200 hover:border-rose-400/30 hover:text-rose-100"
                  disabled={submitting}
                  onClick={() => void handleRemoveMember(member.id, member.user.display_name)}
                  type="button"
                >
                  移出空间
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
