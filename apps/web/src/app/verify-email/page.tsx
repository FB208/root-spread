"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { type VerifyResponse, apiRequest } from "@/lib/api";

export default function VerifyEmailPage() {
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

    try {
      setLoading(true);
      setError(null);
      const response = await apiRequest<VerifyResponse>("/auth/verify-email", {
        method: "POST",
        json: { token },
      });
      setMessage(response.message);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "验证失败，请稍后再试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      alternateHref="/auth/login"
      alternateLabel="验证完成后去登录"
      description="如果是开发环境，可以把注册接口返回的调试 token 直接粘贴到这里完成验证。"
      eyebrow="Verify email"
      title="完成邮箱验证"
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="field-label" htmlFor="verification-token">
            验证 token
          </label>
          <textarea
            className="field-input min-h-32 resize-y"
            id="verification-token"
            onChange={(event) => setToken(event.target.value)}
            placeholder="粘贴验证 token"
            value={token}
          />
        </div>

        <button className="primary-button w-full justify-center" disabled={loading} type="submit">
          {loading ? "验证中..." : "验证邮箱"}
        </button>
      </form>

      {message ? (
        <div className="mt-6 rounded-3xl border border-emerald-400/20 bg-emerald-400/8 p-4 text-sm text-emerald-100">
          <p>{message}</p>
          <Link className="mt-3 inline-flex text-accent transition hover:text-white" href="/auth/login">
            去登录
          </Link>
        </div>
      ) : null}

      {error ? <p className="mt-5 text-sm text-rose-300">{error}</p> : null}
    </AuthCard>
  );
}
