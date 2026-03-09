"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { apiRequest } from "@/lib/api";
import { getStoredSession } from "@/lib/auth-storage";

export default function AcceptInvitationPage() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const tokenFromUrl = new URLSearchParams(window.location.search).get("token");
    if (tokenFromUrl) {
      setToken(tokenFromUrl);
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const session = getStoredSession();
    if (!session?.access_token) {
      setError("请先登录，再接受邀请。");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await apiRequest<{ message: string }>("/workspaces/invitations/accept", {
        method: "POST",
        token: session.access_token,
        json: { token },
      });
      setMessage(response.message);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "接受邀请失败。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      alternateHref="/workspaces"
      alternateLabel="返回工作空间"
      description="邀请邮件会把 token 带到这个页面。当前浏览器只要已登录对应邮箱，就可以直接接受邀请。"
      eyebrow="Accept invitation"
      title="加入团队工作空间"
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="field-label" htmlFor="invitation-token">
            邀请 token
          </label>
          <textarea
            className="field-input min-h-32 resize-y"
            id="invitation-token"
            onChange={(event) => setToken(event.target.value)}
            placeholder="粘贴邀请 token"
            value={token}
          />
        </div>

        <button className="primary-button w-full justify-center" disabled={loading} type="submit">
          {loading ? "接受中..." : "接受邀请"}
        </button>
      </form>

      {message ? (
        <div className="mt-6 rounded-3xl border border-emerald-400/20 bg-emerald-400/8 p-4 text-sm text-emerald-100">
          <p>{message}</p>
          <Link className="mt-3 inline-flex text-accent transition hover:text-white" href="/workspaces">
            打开工作空间列表
          </Link>
        </div>
      ) : null}

      {error ? <p className="mt-5 text-sm text-rose-300">{error}</p> : null}
    </AuthCard>
  );
}
