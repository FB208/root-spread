"use client";

import Link from "next/link";

import { WorkspaceMembersPanel } from "@/components/workspace-members-panel";
import { useWorkspaceContext } from "@/components/workspace-context";

type WorkspaceMembersPageProps = {
  workspaceId: string;
};

export function WorkspaceMembersPage({ workspaceId }: WorkspaceMembersPageProps) {
  const { invitations, members, refreshWorkspaceData, workspace } = useWorkspaceContext();

  if (!workspace) {
    return null;
  }

  return (
    <div className="space-y-3">
      <section className="panel rounded-[20px] px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Members Console</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">
              团队协作与权限管理
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted sm:text-base">
              在这里集中处理成员邀请、角色调整与空间访问权限，不再把协作入口挤在任务工作台里。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Members</p>
              <p className="mt-2 text-lg font-semibold text-white/90">{members.length}</p>
            </div>
            <Link
              className="rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-4 py-3 transition hover:border-white/[0.18] hover:bg-white/[0.06]"
              href={`/workspaces/${workspaceId}/tasks`}
            >
              <p className="text-[10px] uppercase tracking-[0.24em] text-white/34">Workbench</p>
              <p className="mt-2 text-sm font-semibold text-white/90">回到任务工作台</p>
            </Link>
          </div>
        </div>
      </section>

      <WorkspaceMembersPanel
        invitations={invitations}
        members={members}
        onRefresh={refreshWorkspaceData}
        workspaceId={workspaceId}
        workspaceRole={workspace.role}
      />
    </div>
  );
}
