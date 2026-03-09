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

const signals = [
  "深色控制台界面，统一账号入口与工作空间访问。",
  "浏览器本地会话持久化，用于后续空间、任务树与协作操作。",
  "注册、验证、登录和邀请接受共用同一套紧凑表单设计。",
];

export function AuthCard({
  eyebrow,
  title,
  description,
  alternateHref,
  alternateLabel,
  children,
}: AuthCardProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1180px] items-center px-4 py-4 sm:px-6 lg:px-8">
      <div className="grid w-full gap-3 xl:grid-cols-[0.92fr_1.08fr]">
        <section className="panel rounded-[24px] p-6 sm:p-7">
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.26em] text-white/34">
            <span>{eyebrow}</span>
            <span className="rounded-full border border-white/[0.08] px-2 py-1 text-white/46">Control Access</span>
          </div>
          <h1 className="mt-4 max-w-xl text-3xl font-semibold tracking-[-0.05em] text-white sm:text-4xl">
            {title}
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-text-muted">{description}</p>

          <div className="mt-6 grid gap-2">
            {signals.map((signal) => (
              <div
                key={signal}
                className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm leading-6 text-white/72"
              >
                {signal}
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-[16px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(20,25,38,0.88),rgba(13,16,25,0.94))] px-4 py-4">
            <p className="text-[10px] uppercase tracking-[0.24em] text-white/32">Workspace Flow</p>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              登录成功后即可进入工作空间控制台，再从左侧固定菜单进入任务工作台、成员管理、里程碑和统计视图。
            </p>
          </div>
        </section>

        <section className="panel rounded-[24px] p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] pb-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Account Gateway</p>
              <p className="mt-2 text-base font-semibold text-white/88">RootSpread 控制台入口</p>
            </div>
            <Link className="secondary-button" href={alternateHref}>
              {alternateLabel}
            </Link>
          </div>
          <div className="mt-5">{children}</div>
        </section>
      </div>
    </main>
  );
}
