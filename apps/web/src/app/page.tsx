"use client";

import Link from "next/link";
import {
  useCallback,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  ArrowRight,
  CalendarClock,
  GitBranchPlus,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

import { MindmapPreview } from "@/components/mindmap-preview";
import { ReactivePanel } from "@/components/reactive-panel";

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

const heroMetrics = [
  ["核心模型", "Node-first"],
  ["协作范围", "Workspace"],
  ["里程碑策略", "Snapshot"],
];

const roadmap = [
  ["P0", "基础工程", "Monorepo、UI token、开发脚本与 API 入口"],
  ["P1", "账号与空间", "注册、登录、验证邮件、邀请与成员管理"],
  ["P2", "任务节点", "节点详情、状态联动、负责人、评分与排序"],
  ["P3", "里程碑与归档", "快照、历史切换、当前视图过滤归档任务"],
];

const stageStyle = {
  "--stage-pointer-x": "50%",
  "--stage-pointer-y": "18%",
} as CSSProperties;

function updateStagePointer(element: HTMLElement, clientX: number, clientY: number) {
  const rect = element.getBoundingClientRect();
  const offsetX = clientX - rect.left;
  const offsetY = clientY - rect.top;

  element.style.setProperty("--stage-pointer-x", `${offsetX}px`);
  element.style.setProperty("--stage-pointer-y", `${offsetY}px`);
}

export default function Home() {
  const stageRef = useRef<HTMLElement>(null);

  const handleStagePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const element = stageRef.current;

    if (element) {
      updateStagePointer(element, event.clientX, event.clientY);
    }
  }, []);

  const handleStagePointerLeave = useCallback(() => {
    const element = stageRef.current;

    if (!element) {
      return;
    }

    element.style.setProperty("--stage-pointer-x", "50%");
    element.style.setProperty("--stage-pointer-y", "18%");
  }, []);

  return (
    <main
      ref={stageRef}
      className="home-stage mx-auto flex min-h-screen w-full max-w-[1500px] flex-col px-4 py-4 sm:px-6 lg:px-8"
      onPointerLeave={handleStagePointerLeave}
      onPointerMove={handleStagePointerMove}
      style={stageStyle}
    >
      <div aria-hidden className="home-ambient-orb home-ambient-orb-one" />
      <div aria-hidden className="home-ambient-orb home-ambient-orb-two" />
      <div aria-hidden className="home-ambient-orb home-ambient-orb-three" />

      <ReactivePanel
        className="panel sticky top-4 z-20 mb-4 flex items-center justify-between rounded-[18px] px-4 py-3 breathe-card"
        rotationLimit={4}
      >
        <div>
          <p className="text-[10px] uppercase tracking-[0.32em] text-white/34">RootSpread</p>
          <p className="mt-1 text-sm text-white/70">面向专业团队的任务地图控制台</p>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <a className="secondary-button interactive-link" href="#architecture">
            Architecture
          </a>
          <a className="secondary-button interactive-link" href="#roadmap">
            Roadmap
          </a>
          <Link className="primary-button interactive-cta" href="/workspaces">
            打开工作台
          </Link>
        </div>
      </ReactivePanel>

      <section className="grid gap-3 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="grid gap-3">
          <ReactivePanel className="panel rounded-[24px] p-6 sm:p-7 breathe-card" rotationLimit={5}>
            <div aria-hidden className="hero-orbit hero-orbit-one" />
            <div aria-hidden className="hero-orbit hero-orbit-two" />

            <span className="section-label breathe-badge">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              linear-inspired control room
            </span>

            <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
              <div>
                <h1 className="max-w-3xl text-4xl font-semibold leading-[1.03] tracking-[-0.05em] text-white sm:text-5xl xl:text-6xl">
                  把项目拆成一张
                  <span className="gradient-text">可执行、可追溯、可协作</span>
                  的任务地图
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-text-muted sm:text-base">
                  RootSpread 把项目、任务、里程碑和协作上下文收束到统一节点模型中，让结构浏览、执行推进和历史回看在同一套系统里完成。
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Link className="primary-button interactive-cta" href="/auth/register">
                    开始注册
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link className="secondary-button interactive-cta" href="/workspaces">
                    打开工作空间
                  </Link>
                </div>
              </div>

              <div className="grid gap-2">
                {heroMetrics.map(([label, value], index) => (
                  <ReactivePanel
                    key={label}
                    className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] px-4 py-3 breathe-card"
                    rotationLimit={6}
                    style={{ animationDelay: `${index * 160}ms` }}
                  >
                    <p className="text-[10px] uppercase tracking-[0.24em] text-white/30">{label}</p>
                    <p className="mt-2 text-base font-semibold text-white/90">{value}</p>
                  </ReactivePanel>
                ))}
              </div>
            </div>
          </ReactivePanel>

          <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
            <ReactivePanel className="panel rounded-[22px] p-5 breathe-card" rotationLimit={5}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-[#86efac]">
                  <ShieldCheck className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.24em] text-white/32">Current Scope</p>
                  <h2 className="mt-1 text-lg font-semibold text-white/90">P0-P3 控制台闭环</h2>
                </div>
              </div>
              <div className="mt-4 grid gap-2">
                {checkpoints.map((checkpoint) => (
                  <ReactivePanel
                    key={checkpoint}
                    className="flex items-start gap-3 rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-4 py-3 breathe-card"
                    rotationLimit={6}
                  >
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-accent shadow-[0_0_14px_rgba(139,144,255,0.8)]" />
                    <p className="text-sm leading-6 text-white/72">{checkpoint}</p>
                  </ReactivePanel>
                ))}
              </div>
            </ReactivePanel>

            <ReactivePanel className="panel rounded-[22px] p-5 breathe-card" rotationLimit={6} style={{ animationDelay: "180ms" }}>
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/32">Design Direction</p>
              <h2 className="mt-2 text-lg font-semibold text-white/90">Linear 风格的深色管理台</h2>
              <p className="mt-3 text-sm leading-6 text-text-muted">
                深色基底、精细描边、冷静渐变、高对齐度和紧凑留白，让复杂项目保持专业与秩序感。
              </p>
            </ReactivePanel>
          </div>
        </div>

        <MindmapPreview />
      </section>

      <section id="architecture" className="mt-3 grid gap-3 xl:grid-cols-3">
        {pillars.map((pillar, index) => {
          const Icon = pillar.icon;

          return (
            <ReactivePanel
              key={pillar.title}
              className="panel rounded-[22px] p-5 breathe-card"
              rotationLimit={7}
              style={{ animationDelay: `${index * 160}ms` }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-accent">
                <Icon className="h-4.5 w-4.5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-white/88">{pillar.title}</h3>
              <p className="mt-3 text-sm leading-7 text-text-muted">{pillar.description}</p>
            </ReactivePanel>
          );
        })}
      </section>

      <ReactivePanel
        id="roadmap"
        className="panel mt-3 rounded-[24px] p-5 sm:p-6 breathe-card"
        rotationLimit={4}
        style={{ animationDelay: "260ms" }}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-white/32">Roadmap</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">从工程底座到任务树闭环</h2>
          </div>
          <p className="max-w-xl text-sm leading-7 text-text-muted">
            先完成统一底层能力，再逐步推进行为权限、节点执行、历史归档和管理系统式工作台体验。
          </p>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {roadmap.map(([phase, title, text], index) => (
            <ReactivePanel
              key={phase}
              className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4 breathe-card"
              rotationLimit={6}
              style={{ animationDelay: `${index * 140}ms` }}
            >
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">{phase}</p>
              <h3 className="mt-3 text-base font-semibold text-white/90">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-text-muted">{text}</p>
            </ReactivePanel>
          ))}
        </div>
      </ReactivePanel>
    </main>
  );
}
