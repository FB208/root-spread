"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { type RegisterResponse, apiRequest } from "@/lib/api";

export default function RegisterPage() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResponse | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setLoading(true);
      setError(null);
      const response = await apiRequest<RegisterResponse>("/auth/register", {
        method: "POST",
        json: {
          display_name: displayName,
          email,
          password,
        },
      });
      setResult(response);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "注册失败，请稍后再试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      alternateHref="/auth/login"
      alternateLabel="已有账号？去登录"
      description="当前开发环境会返回调试用验证 token，方便你在本地快速串联注册、验证和登录流程。"
      eyebrow="Create account"
      title="创建 RootSpread 账号"
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="field-label" htmlFor="register-display-name">
            昵称
          </label>
          <input
            className="field-input"
            id="register-display-name"
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="例如：Mark"
            value={displayName}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="register-email">
            邮箱
          </label>
          <input
            autoComplete="email"
            className="field-input"
            id="register-email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            type="email"
            value={email}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="register-password">
            密码
          </label>
          <input
            autoComplete="new-password"
            className="field-input"
            id="register-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 8 位"
            type="password"
            value={password}
          />
        </div>

        <button className="primary-button w-full justify-center" disabled={loading} type="submit">
          {loading ? "注册中..." : "注册并发送验证邮件"}
        </button>
      </form>

      {error ? <p className="mt-5 text-sm text-rose-300">{error}</p> : null}

      {result ? (
        <div className="mt-6 rounded-3xl border border-emerald-400/20 bg-emerald-400/8 p-4 text-sm text-emerald-100">
          <p>{result.message}</p>
          {result.debug_verification_token ? (
            <div className="mt-4 space-y-2">
              <p className="text-emerald-100/75">开发环境验证 token：</p>
              <code className="block overflow-x-auto rounded-2xl border border-white/10 bg-[#081120] px-3 py-2 text-xs text-white/80">
                {result.debug_verification_token}
              </code>
              <Link
                className="inline-flex text-accent transition hover:text-white"
                href={`/verify-email?token=${encodeURIComponent(result.debug_verification_token)}`}
              >
                打开验证页面
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </AuthCard>
  );
}
