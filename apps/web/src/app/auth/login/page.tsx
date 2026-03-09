"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { type AuthSession, apiRequest } from "@/lib/api";
import { saveSession } from "@/lib/auth-storage";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setLoading(true);
      setError(null);

      const session = await apiRequest<AuthSession>("/auth/login", {
        method: "POST",
        json: { email, password },
      });
      saveSession(session);
      router.push("/workspaces");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "登录失败，请稍后再试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      alternateHref="/auth/register"
      alternateLabel="还没有账号？去注册"
      description="登录成功后，浏览器会保存当前会话，用于继续访问工作空间、任务树与后续工作台。"
      eyebrow="Sign in"
      title="登录 RootSpread"
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="field-label" htmlFor="login-email">
            邮箱
          </label>
          <input
            autoComplete="email"
            className="field-input"
            id="login-email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            type="email"
            value={email}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="login-password">
            密码
          </label>
          <input
            autoComplete="current-password"
            className="field-input"
            id="login-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 8 位"
            type="password"
            value={password}
          />
        </div>

        <button className="primary-button w-full justify-center" disabled={loading} type="submit">
          {loading ? "登录中..." : "登录并进入工作空间"}
        </button>
      </form>

      {error ? <p className="mt-5 text-sm text-rose-300">{error}</p> : null}

      <p className="mt-6 text-sm text-text-muted">
        如果你已经拿到验证 token，可以直接去 <Link className="text-accent" href="/verify-email">邮箱验证页</Link>
      </p>
    </AuthCard>
  );
}
