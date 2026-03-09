import { redirect } from "next/navigation";

type WorkspaceDetailPageProps = {
  params: Promise<{ workspaceId: string }>;
};

export default async function WorkspaceDetailPage({ params }: WorkspaceDetailPageProps) {
  const { workspaceId } = await params;

  redirect(`/workspaces/${workspaceId}/tasks`);
}
