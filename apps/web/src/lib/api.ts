export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:18000/api/v1";

export const API_WS_BASE_URL =
  process.env.NEXT_PUBLIC_API_WS_BASE_URL ?? API_BASE_URL.replace(/^http/, "ws");

export const COLLAB_WS_BASE_URL =
  process.env.NEXT_PUBLIC_COLLAB_WS_URL ?? "ws://localhost:18001";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type ApiRequestOptions = RequestInit & {
  disableAuthRefresh?: boolean;
  token?: string;
  json?: unknown;
};

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { disableAuthRefresh = false, token, json, headers, ...rest } = options;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (
    response.status === 401 &&
    token &&
    !disableAuthRefresh &&
    path !== "/auth/login" &&
    path !== "/auth/refresh" &&
    path !== "/auth/logout"
  ) {
    const { getStoredSession, refreshStoredSession } = await import("@/lib/auth-storage");
    const storedSession = getStoredSession();

    if (storedSession?.access_token && storedSession.access_token !== token) {
      return apiRequest<T>(path, {
        ...options,
        token: storedSession.access_token,
      });
    }

    if (storedSession?.access_token === token) {
      const refreshedSession = await refreshStoredSession();

      if (refreshedSession?.access_token && refreshedSession.access_token !== token) {
        return apiRequest<T>(path, {
          ...options,
          disableAuthRefresh: true,
          token: refreshedSession.access_token,
        });
      }
    }
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "detail" in payload
        ? String(payload.detail)
        : "请求失败，请稍后重试。";
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export type AuthUser = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  email_verified_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type AuthSession = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at?: string;
  user: AuthUser;
};

export type WorkspaceItem = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
  created_at: string;
  updated_at: string;
};

export type PendingInvitation = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  role: "owner" | "admin" | "member";
  email: string;
  expires_at: string;
  invited_by_user_id: string;
};

export type RegisterResponse = {
  message: string;
  debug_verification_token?: string | null;
  user: AuthUser;
};

export type VerifyResponse = {
  message: string;
};

export type MessageResponse = {
  message: string;
};

export type WorkspaceCreateResponse = {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceMember = {
  id: string;
  role: "owner" | "admin" | "member";
  status: string;
  joined_at: string;
  user: {
    id: string;
    email: string;
    display_name: string;
    avatar_url: string | null;
  };
};

export type WorkspaceInvitationDispatchResponse = {
  message: string;
  invitation: WorkspaceInvitation;
  debug_invitation_token?: string | null;
};

export type WorkspaceInvitation = {
  id: string;
  workspace_id: string;
  email: string;
  role: "owner" | "admin" | "member";
  invited_by_user_id: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskStatus =
  | "in_progress"
  | "pending_review"
  | "completed"
  | "terminated";

export type TaskNodeKind = "system_root" | "task";

export type TaskTreeNode = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  root_id: string;
  path: string;
  depth: number;
  sort_order: number;
  meta_revision: number;
  title: string;
  content_markdown: string;
  node_kind: TaskNodeKind;
  created_by_user_id: string;
  assignee_user_id: string | null;
  planned_due_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  archived_by_milestone_id: string | null;
  weight: number;
  score: number | null;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
  matched_filter: boolean;
  children: TaskTreeNode[];
};

export type TaskRecord = Omit<TaskTreeNode, "children" | "matched_filter">;

export type TaskTreeResponse = {
  root: TaskTreeNode;
};

export type TaskSnapshotResponse = {
  workspace_id: string;
  root_id: string | null;
  sync_seq: number;
  tasks: TaskRecord[];
};

export type TaskChangeset = {
  workspace_id: string;
  sync_seq: number;
  op_type: string;
  op_id?: string | null;
  upserts: TaskRecord[];
  deletes: string[];
};

export type TaskChangesResponse = {
  workspace_id: string;
  sync_seq: number;
  events: TaskChangeset[];
};

export type TaskDocumentSnapshot = {
  task_id: string;
  workspace_id: string;
  content_markdown: string;
  updated_at: string;
};

export type TaskOperationRequest = {
  op_id?: string;
  type:
    | "create_task"
    | "patch_task"
    | "set_status"
    | "delete_task"
    | "reorder_tasks"
    | "bulk_set_status"
    | "bulk_delete_tasks";
  task_id?: string | null;
  parent_id?: string | null;
  task_ids?: string[];
  title?: string | null;
  content_markdown?: string | null;
  assignee_user_id?: string | null;
  planned_due_at?: string | null;
  weight?: number | null;
  score?: number | null;
  status?: TaskStatus;
  remark?: string | null;
};

export type Milestone = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  target_at: string;
  archived_task_count: number;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export type MilestoneTreeResponse = {
  milestone: Milestone;
  root: TaskTreeNode | null;
};

export type TaskStatusTransition = {
  id: string;
  task_node_id: string;
  from_status: string | null;
  to_status: string;
  action_type: string;
  remark: string | null;
  operator_user_id: string;
  created_at: string;
  updated_at: string;
};

export type AuditLog = {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  message: string;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type WorkspaceStats = {
  workspace_id: string;
  active_task_count: number;
  archived_task_count: number;
  member_count: number;
  pending_invitation_count: number;
  milestone_count: number;
  completed_task_count: number;
  pending_review_task_count: number;
  terminated_task_count: number;
  in_progress_task_count: number;
  recent_activity_count: number;
};
