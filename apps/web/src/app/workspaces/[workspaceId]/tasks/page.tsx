import { WorkspaceWorkbench } from "@/components/workspace-workbench";

type WorkspaceTasksPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function WorkspaceTasksPage({ params }: WorkspaceTasksPageProps) {
  const { workspaceId } = await params;

  return <WorkspaceWorkbench workspaceId={workspaceId} />;
}
