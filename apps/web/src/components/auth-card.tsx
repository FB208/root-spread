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
    <main className="mx-auto flex min-h-screen w-full max-w-[1120px] items-center px-4 py-4 sm:px-6 lg:px-8">
      <div className="grid w-full gap-3 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="panel rounded-[20px] p-5 sm:p-6">
          <div className="compact-page-header">
            <div>
              <p className="compact-kicker">{eyebrow}</p>
              <h1 className="compact-title max-w-xl sm:text-[2rem]">{title}</h1>
              <p className="compact-copy max-w-xl">{description}</p>
            </div>
            <div className="compact-chip-row">
              <span className="compact-chip">Control Access</span>
              <span className="compact-chip">Workspace Entry</span>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            {signals.map((signal) => (
              <div key={signal} className="compact-list-card text-sm leading-6 text-white/72">
                {signal}
              </div>
            ))}
          </div>

          <div className="compact-section-card mt-4 bg-[linear-gradient(180deg,rgba(20,25,38,0.82),rgba(13,16,25,0.9))]">
            <p className="compact-kicker">Workspace Flow</p>
            <p className="compact-card-copy">
              登录成功后即可进入工作空间控制台，再从左侧固定菜单进入任务工作台、成员管理、里程碑和统计视图。
            </p>
          </div>
        </section>

        <section className="panel rounded-[20px] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] pb-3">
            <div>
              <p className="compact-kicker">Account Gateway</p>
              <p className="mt-1.5 text-[15px] font-semibold text-white/88">RootSpread 控制台入口</p>
            </div>
            <Link className="secondary-button" href={alternateHref}>
              {alternateLabel}
            </Link>
          </div>
          <div className="mt-4">{children}</div>
        </section>
      </div>
    </main>
  );
}
