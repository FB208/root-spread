export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:18000/api/v1";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type ApiRequestOptions = RequestInit & {
  token?: string;
  json?: unknown;
};

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { token, json, headers, ...rest } = options;
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

export type TaskTreeNode = {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  root_id: string;
  path: string;
  depth: number;
  sort_order: number;
  title: string;
  content_markdown: string;
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
  tree: TaskTreeNode[];
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
