import { WorkspaceMilestonesPage } from "@/components/workspace-milestones-page";

type WorkspaceMilestonesRouteProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function WorkspaceMilestonesRoute({ params }: WorkspaceMilestonesRouteProps) {
  const { workspaceId } = await params;

  return <WorkspaceMilestonesPage workspaceId={workspaceId} />;
}
