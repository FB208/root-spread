import { WorkspaceMembersPage } from "@/components/workspace-members-page";

type WorkspaceMembersRouteProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function WorkspaceMembersRoute({ params }: WorkspaceMembersRouteProps) {
  const { workspaceId } = await params;

  return <WorkspaceMembersPage workspaceId={workspaceId} />;
}
