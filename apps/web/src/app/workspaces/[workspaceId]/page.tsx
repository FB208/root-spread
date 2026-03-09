import { WorkspaceWorkbench } from "@/components/workspace-workbench";

type WorkspaceDetailPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function WorkspaceDetailPage({ params }: WorkspaceDetailPageProps) {
  const { workspaceId } = await params;

  return <WorkspaceWorkbench workspaceId={workspaceId} />;
}
