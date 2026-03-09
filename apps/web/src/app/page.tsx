import Link from "next/link";

import {
  ArrowRight,
  CalendarClock,
  GitBranchPlus,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

import { MindmapPreview } from "@/components/mindmap-preview";

const pillars = [
  {
    title: "账号与团队协作",
    description: "邮箱注册、Resend 验证、工作空间邀请与成员角色管理。",
    icon: Users,
  },
  {
    title: "任务树即项目本体",
    description: "节点承载名称、Markdown 内容、负责人、评分、截止时间与状态联动。",
    icon: GitBranchPlus,
  },
  {
    title: "里程碑历史回看",
    description: "主工作台切换里程碑，自动归档历史完成任务并保留快照。",
    icon: CalendarClock,
  },
];

const checkpoints = [
  "Next.js + React 前端骨架",
  "FastAPI + SQLAlchemy 后端入口",
  "MySQL / Redis 本地开发基础设施",
  "Windows 优先的 PowerShell 启动脚本",
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 pb-16 pt-6 sm:px-8 lg:px-12">
      <header className="panel sticky top-6 z-20 mb-8 flex items-center justify-between rounded-full px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.34em] text-white/40">RootSpread</p>
          <p className="mt-1 text-sm text-white/70">根系蔓延 · 项目即任务，任务即项目</p>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <a
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:border-white/20 hover:text-white"
            href="#architecture"
          >
            Architecture
          </a>
          <a
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-[#0b1120] transition hover:bg-white/90"
            href="#roadmap"
          >
            Start Build
          </a>
        </div>
      </header>

      <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <div className="space-y-8">
          <span className="section-label">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            linear-inspired control room
          </span>
          <div className="space-y-5">
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
              用一张会蔓延的任务地图，
              <span className="gradient-text">管理整个项目生命周期</span>
            </h1>
            <p className="max-w-2xl text-base leading-8 text-text-muted sm:text-lg">
              RootSpread 把项目、任务、里程碑和协作上下文收束到统一的节点模型里。
              导图视图负责结构感，表格视图负责执行感，二者共享同一份真实数据。
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-[#0b1120] transition hover:bg-white/92"
              href="/auth/register"
            >
              开始注册
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              className="inline-flex items-center justify-center rounded-full border border-white/10 px-5 py-3 text-sm text-white/72 transition hover:border-white/20 hover:text-white"
              href="/workspaces"
            >
              打开工作空间
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["核心模型", "Node-first"],
              ["协作范围", "Workspace"],
              ["里程碑策略", "Snapshot"],
            ].map(([label, value]) => (
              <div key={label} className="panel rounded-3xl px-4 py-4">
                <p className="text-xs uppercase tracking-[0.24em] text-white/35">{label}</p>
                <p className="mt-3 text-lg font-semibold text-white/90">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <MindmapPreview />
      </section>

      <section
        id="architecture"
        className="mt-10 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]"
      >
        <div className="panel rounded-[28px] p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.32em] text-white/38">Architecture</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
            专为项目管理收敛的导图交互
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {pillars.map((pillar) => {
              const Icon = pillar.icon;

              return (
                <article key={pillar.title} className="rounded-3xl border border-white/[0.08] bg-white/[0.04] p-5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-accent">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-white/88">{pillar.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-text-muted">{pillar.description}</p>
                </article>
              );
            })}
          </div>
        </div>

        <div className="panel rounded-[28px] p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-[#86efac]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.26em] text-white/38">Current scope</p>
              <h2 className="mt-1 text-xl font-semibold text-white/90">P0 scaffolding</h2>
            </div>
          </div>
          <div className="mt-6 space-y-3">
            {checkpoints.map((checkpoint) => (
              <div
                key={checkpoint}
                className="flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3"
              >
                <span className="mt-1 h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_16px_rgba(122,162,255,0.9)]" />
                <p className="text-sm leading-7 text-white/72">{checkpoint}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="roadmap" className="mt-10 panel rounded-[32px] p-6 sm:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-white/38">Roadmap</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
              当前开发路线从脚手架开始，逐步落到任务树闭环
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-7 text-text-muted">
            优先建立统一的工程底座，再进入账号体系、任务节点、双视图与里程碑快照。
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {[
            ["P0", "基础工程", "Monorepo、UI token、开发脚本与 API 入口"],
            ["P1", "账号与空间", "注册、登录、验证邮件、邀请与成员管理"],
            ["P2", "任务节点", "节点详情、状态联动、负责人、评分与排序"],
            ["P3", "里程碑与归档", "快照、历史切换、当前视图过滤归档任务"],
          ].map(([phase, title, text]) => (
            <article key={phase} className="rounded-3xl border border-white/[0.08] bg-white/[0.04] p-5">
              <p className="text-xs uppercase tracking-[0.26em] text-white/38">{phase}</p>
              <h3 className="mt-4 text-lg font-semibold text-white/90">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-text-muted">{text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
