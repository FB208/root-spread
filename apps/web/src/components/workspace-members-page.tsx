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
      <section className="panel rounded-[18px] px-4 py-3.5 sm:px-[18px]">
        <div className="compact-page-header">
          <div>
            <p className="compact-kicker">Members Console</p>
            <h2 className="compact-title">团队协作与权限管理</h2>
            <p className="compact-copy">
              在这里集中处理成员邀请、角色调整与空间访问权限，不再把协作入口挤在任务工作台里。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="compact-chip">成员 {members.length}</span>
            <span className="compact-chip">邀请 {invitations.length}</span>
            <Link
              className="secondary-button"
              href={`/workspaces/${workspaceId}/tasks`}
            >
              回到任务工作台
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
