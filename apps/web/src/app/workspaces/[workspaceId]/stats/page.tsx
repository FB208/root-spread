import { WorkspaceStatsDashboard } from "@/components/workspace-stats-dashboard";

type WorkspaceStatsPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function WorkspaceStatsPage({ params }: WorkspaceStatsPageProps) {
  const { workspaceId } = await params;
  return <WorkspaceStatsDashboard workspaceId={workspaceId} />;
}
