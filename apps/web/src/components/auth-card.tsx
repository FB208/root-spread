import Link from "next/link";
import type { ReactNode } from "react";

type AuthCardProps = {
  eyebrow: string;
  title: string;
  description: string;
  alternateHref: string;
  alternateLabel: string;
  children: ReactNode;
};

export function AuthCard({
  eyebrow,
  title,
  description,
  alternateHref,
  alternateLabel,
  children,
}: AuthCardProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-10 sm:px-8 lg:px-12">
      <div className="grid w-full gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="panel rounded-[32px] p-8 sm:p-10">
          <p className="text-xs uppercase tracking-[0.34em] text-white/38">{eyebrow}</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-8 text-text-muted sm:text-base">
            {description}
          </p>

          <div className="mt-10 space-y-4 text-sm text-white/65">
            <div className="rounded-3xl border border-white/[0.08] bg-white/[0.04] p-5">
              思维导图视图负责结构感，表格视图负责执行感，里程碑负责回看与归档。
            </div>
            <div className="rounded-3xl border border-white/[0.08] bg-white/[0.04] p-5">
              当前阶段已接通注册、验证、登录、工作空间、任务树与里程碑归档后端能力。
            </div>
          </div>
        </section>

        <section className="panel rounded-[32px] p-8 sm:p-10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.26em] text-white/38">Account</p>
              <p className="mt-2 text-lg font-medium text-white/82">RootSpread 控制台入口</p>
            </div>
            <Link className="text-sm text-accent transition hover:text-white" href={alternateHref}>
              {alternateLabel}
            </Link>
          </div>
          <div className="mt-8">{children}</div>
        </section>
      </div>
    </main>
  );
}
