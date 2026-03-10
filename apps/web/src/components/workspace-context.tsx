"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  type AuthSession,
  type Milestone,
  type WorkspaceInvitation,
  type WorkspaceItem,
  type WorkspaceMember,
  apiRequest,
} from "@/lib/api";
import { getCachedSession } from "@/lib/auth-storage";

type WorkspaceContextValue = {
  accessToken: string | null;
  error: string | null;
  invitations: WorkspaceInvitation[];
  loading: boolean;
  members: WorkspaceMember[];
  milestones: Milestone[];
  refreshWorkspaceData: () => Promise<void>;
  session: AuthSession | null;
  workspace: WorkspaceItem | null;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

type WorkspaceProviderProps = {
  children: ReactNode;
  workspaceId: string;
};

export function WorkspaceProvider({ children, workspaceId }: WorkspaceProviderProps) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceItem | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshWorkspaceData = useCallback(async () => {
    const storedSession = await getCachedSession();
    setSession(storedSession);

    if (!storedSession?.access_token) {
      setWorkspace(null);
      setMembers([]);
      setInvitations([]);
      setMilestones([]);
      setError("请先登录，再打开工作空间。");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [workspaces, membersResponse, invitationsResponse, milestonesResponse] = await Promise.all([
        apiRequest<WorkspaceItem[]>("/workspaces", { token: storedSession.access_token }),
        apiRequest<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`, {
          token: storedSession.access_token,
        }),
        apiRequest<WorkspaceInvitation[]>(`/workspaces/${workspaceId}/invitations`, {
          token: storedSession.access_token,
        }).catch(() => []),
        apiRequest<Milestone[]>(`/workspaces/${workspaceId}/milestones`, {
          token: storedSession.access_token,
        }),
      ]);

      setWorkspace(workspaces.find((item) => item.id === workspaceId) ?? null);
      setMembers(membersResponse);
      setInvitations(invitationsResponse);
      setMilestones(milestonesResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载工作空间失败。");
      setWorkspace(null);
      setMembers([]);
      setInvitations([]);
      setMilestones([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refreshWorkspaceData();
  }, [refreshWorkspaceData]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      accessToken: session?.access_token ?? null,
      error,
      invitations,
      loading,
      members,
      milestones,
      refreshWorkspaceData,
      session,
      workspace,
    }),
    [error, invitations, loading, members, milestones, refreshWorkspaceData, session, workspace],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceContext() {
  const context = useContext(WorkspaceContext);

  if (!context) {
    throw new Error("useWorkspaceContext 必须在 WorkspaceProvider 内使用。");
  }

  return context;
}
