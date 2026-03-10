from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rootspread_api.api.dependencies.auth import get_current_verified_user
from rootspread_api.core.database import get_db
from rootspread_api.core.config import get_settings
from rootspread_api.core.security import create_random_token, hash_token
from rootspread_api.core.time import utc_now
from rootspread_api.models.audit import AuditLog
from rootspread_api.models.user import User
from rootspread_api.models.workspace import Workspace, WorkspaceInvitation, WorkspaceMember
from rootspread_api.models.task import TaskNode, TaskNodeKind, TaskStatus
from rootspread_api.models.milestone import Milestone
from rootspread_api.schemas.audit import AuditLogRead, WorkspaceStatsRead
from rootspread_api.schemas.common import MessageResponse
from rootspread_api.schemas.workspace import (
    InvitationAcceptRequest,
    InvitationCreateRequest,
    PendingInvitationRead,
    WorkspaceInvitationDispatchResponse,
    WorkspaceInvitationRead,
    WorkspaceListItem,
    WorkspaceMemberRead,
    WorkspaceMemberSummary,
    WorkspaceMemberUpdateRequest,
    WorkspaceCreateRequest,
    WorkspaceRead,
)
from rootspread_api.services.auth_tokens import should_expose_debug_token
from rootspread_api.services.audit_service import log_audit_event
from rootspread_api.services.email_service import send_workspace_invitation_email
from rootspread_api.services.task_service import ensure_system_root
from rootspread_api.services.workspace_service import ensure_unique_workspace_slug

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def get_workspace_membership(
    session: Session, workspace_id: str, user_id: str
) -> WorkspaceMember | None:
    return session.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.status == "active",
        )
    )


def require_workspace_access(session: Session, workspace_id: str, user_id: str) -> WorkspaceMember:
    membership = get_workspace_membership(session, workspace_id, user_id)
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工作空间不存在。")

    return membership


def require_workspace_admin(membership: WorkspaceMember) -> None:
    if membership.role not in {"owner", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="当前角色没有管理权限。")


@router.post("", response_model=WorkspaceRead, status_code=status.HTTP_201_CREATED)
def create_workspace(
    payload: WorkspaceCreateRequest,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> WorkspaceRead:
    slug = ensure_unique_workspace_slug(session, payload.slug or payload.name)

    workspace = Workspace(name=payload.name.strip(), slug=slug, owner_user_id=current_user.id)
    session.add(workspace)
    session.flush()

    membership = WorkspaceMember(workspace_id=workspace.id, user_id=current_user.id, role="owner")
    session.add(membership)
    ensure_system_root(session, workspace.id, current_user.id)
    log_audit_event(
        session,
        workspace_id=workspace.id,
        actor_user_id=current_user.id,
        entity_type="workspace",
        entity_id=workspace.id,
        action="workspace_created",
        message=f"创建工作空间：{workspace.name}",
        metadata_json={"slug": workspace.slug},
    )
    session.commit()
    session.refresh(workspace)

    return WorkspaceRead.model_validate(workspace)


@router.get("", response_model=list[WorkspaceListItem])
def list_workspaces(
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> list[WorkspaceListItem]:
    rows = session.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == current_user.id, WorkspaceMember.status == "active")
        .order_by(Workspace.created_at.desc())
    ).all()

    return [
        WorkspaceListItem(
            id=workspace.id,
            name=workspace.name,
            slug=workspace.slug,
            role=role,
            created_at=workspace.created_at,
            updated_at=workspace.updated_at,
        )
        for workspace, role in rows
    ]


@router.get("/{workspace_id}/members", response_model=list[WorkspaceMemberRead])
def list_workspace_members(
    workspace_id: str,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> list[WorkspaceMemberRead]:
    require_workspace_access(session, workspace_id, current_user.id)

    rows = session.execute(
        select(WorkspaceMember, User)
        .join(User, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.status == "active")
        .order_by(WorkspaceMember.role.asc(), WorkspaceMember.joined_at.asc())
    ).all()

    return [
        WorkspaceMemberRead(
            id=membership.id,
            role=membership.role,
            status=membership.status,
            joined_at=membership.joined_at,
            user=WorkspaceMemberSummary(
                id=user.id,
                email=user.email,
                display_name=user.display_name,
                avatar_url=user.avatar_url,
            ),
        )
        for membership, user in rows
    ]


@router.get("/{workspace_id}/stats", response_model=WorkspaceStatsRead)
def get_workspace_stats(
    workspace_id: str,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> WorkspaceStatsRead:
    require_workspace_access(session, workspace_id, current_user.id)

    live_task_filters = (
        TaskNode.workspace_id == workspace_id,
        TaskNode.archived_at.is_(None),
        TaskNode.node_kind != TaskNodeKind.SYSTEM_ROOT.value,
    )
    archived_task_filters = (
        TaskNode.workspace_id == workspace_id,
        TaskNode.archived_at.is_not(None),
        TaskNode.node_kind != TaskNodeKind.SYSTEM_ROOT.value,
    )

    active_task_count = (
        session.scalar(select(func.count(TaskNode.id)).where(*live_task_filters)) or 0
    )
    archived_task_count = (
        session.scalar(select(func.count(TaskNode.id)).where(*archived_task_filters)) or 0
    )
    member_count = (
        session.scalar(
            select(func.count(WorkspaceMember.id)).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.status == "active",
            )
        )
        or 0
    )
    pending_invitation_count = (
        session.scalar(
            select(func.count(WorkspaceInvitation.id)).where(
                WorkspaceInvitation.workspace_id == workspace_id,
                WorkspaceInvitation.accepted_at.is_(None),
                WorkspaceInvitation.revoked_at.is_(None),
                WorkspaceInvitation.expires_at > utc_now(),
            )
        )
        or 0
    )
    milestone_count = (
        session.scalar(
            select(func.count(Milestone.id)).where(Milestone.workspace_id == workspace_id)
        )
        or 0
    )
    in_progress_task_count = (
        session.scalar(
            select(func.count(TaskNode.id)).where(
                *live_task_filters,
                TaskNode.status == TaskStatus.IN_PROGRESS.value,
            )
        )
        or 0
    )
    pending_review_task_count = (
        session.scalar(
            select(func.count(TaskNode.id)).where(
                *live_task_filters,
                TaskNode.status == TaskStatus.PENDING_REVIEW.value,
            )
        )
        or 0
    )
    completed_task_count = (
        session.scalar(
            select(func.count(TaskNode.id)).where(
                *live_task_filters,
                TaskNode.status == TaskStatus.COMPLETED.value,
            )
        )
        or 0
    )
    terminated_task_count = (
        session.scalar(
            select(func.count(TaskNode.id)).where(
                *live_task_filters,
                TaskNode.status == TaskStatus.TERMINATED.value,
            )
        )
        or 0
    )
    recent_activity_count = (
        session.scalar(select(func.count(AuditLog.id)).where(AuditLog.workspace_id == workspace_id))
        or 0
    )

    return WorkspaceStatsRead(
        workspace_id=workspace_id,
        active_task_count=int(active_task_count),
        archived_task_count=int(archived_task_count),
        member_count=int(member_count),
        pending_invitation_count=int(pending_invitation_count),
        milestone_count=int(milestone_count),
        completed_task_count=int(completed_task_count),
        pending_review_task_count=int(pending_review_task_count),
        terminated_task_count=int(terminated_task_count),
        in_progress_task_count=int(in_progress_task_count),
        recent_activity_count=int(recent_activity_count),
    )


@router.get("/{workspace_id}/audit-logs", response_model=list[AuditLogRead])
def list_workspace_audit_logs(
    workspace_id: str,
    limit: int = 40,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> list[AuditLogRead]:
    require_workspace_access(session, workspace_id, current_user.id)

    logs = session.scalars(
        select(AuditLog)
        .where(AuditLog.workspace_id == workspace_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    ).all()
    return [AuditLogRead.model_validate(log) for log in logs]


@router.delete("/{workspace_id}/members/{member_id}", response_model=MessageResponse)
def remove_workspace_member(
    workspace_id: str,
    member_id: str,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> MessageResponse:
    membership = require_workspace_access(session, workspace_id, current_user.id)
    require_workspace_admin(membership)

    target_member = session.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.id == member_id,
            WorkspaceMember.status == "active",
        )
    )
    if target_member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="成员不存在。")

    if target_member.role == "owner":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能移除空间所有者。")

    target_member.status = "inactive"
    log_audit_event(
        session,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        entity_type="workspace_member",
        entity_id=target_member.id,
        action="workspace_member_removed",
        message=f"移除成员：{target_member.user.display_name}",
        metadata_json={"user_id": target_member.user_id},
    )
    session.commit()
    return MessageResponse(message="成员已移除。")


@router.patch("/{workspace_id}/members/{member_id}", response_model=WorkspaceMemberRead)
def update_workspace_member_role(
    workspace_id: str,
    member_id: str,
    payload: WorkspaceMemberUpdateRequest,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> WorkspaceMemberRead:
    membership = require_workspace_access(session, workspace_id, current_user.id)
    require_workspace_admin(membership)

    target_member = session.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.id == member_id,
            WorkspaceMember.status == "active",
        )
    )
    if target_member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="成员不存在。")

    if target_member.role == "owner":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="不能修改空间所有者角色。"
        )

    target_member.role = payload.role
    user = target_member.user
    log_audit_event(
        session,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        entity_type="workspace_member",
        entity_id=target_member.id,
        action="workspace_member_role_updated",
        message=f"调整成员角色：{user.display_name}",
        metadata_json={"role": payload.role, "user_id": target_member.user_id},
    )
    session.commit()
    session.refresh(target_member)

    return WorkspaceMemberRead.model_validate(
        {
            "id": target_member.id,
            "role": target_member.role,
            "status": target_member.status,
            "joined_at": target_member.joined_at,
            "user": WorkspaceMemberSummary(
                id=user.id,
                email=user.email,
                display_name=user.display_name,
                avatar_url=user.avatar_url,
            ).model_dump(),
        }
    )


@router.post(
    "/{workspace_id}/invitations",
    response_model=WorkspaceInvitationDispatchResponse,
    status_code=status.HTTP_201_CREATED,
)
def invite_workspace_member(
    workspace_id: str,
    payload: InvitationCreateRequest,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> WorkspaceInvitationDispatchResponse:
    membership = require_workspace_access(session, workspace_id, current_user.id)
    if membership.role not in {"owner", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="当前角色不能邀请成员。")

    workspace = session.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="工作空间不存在。")

    normalized_email = payload.email.lower()
    existing_member = session.scalar(
        select(WorkspaceMember)
        .join(User, WorkspaceMember.user_id == User.id)
        .where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.status == "active",
            User.email == normalized_email,
        )
    )
    if existing_member is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该成员已经在工作空间中。")

    existing_invitation = session.scalar(
        select(WorkspaceInvitation).where(
            WorkspaceInvitation.workspace_id == workspace_id,
            WorkspaceInvitation.email == normalized_email,
            WorkspaceInvitation.accepted_at.is_(None),
            WorkspaceInvitation.revoked_at.is_(None),
            WorkspaceInvitation.expires_at > utc_now(),
        )
    )
    if existing_invitation is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该邮箱已有待处理邀请。")

    settings = get_settings()
    raw_token = create_random_token()
    invitation = WorkspaceInvitation(
        workspace_id=workspace_id,
        email=normalized_email,
        role=payload.role,
        invited_by_user_id=current_user.id,
        token_hash=hash_token(raw_token),
        expires_at=utc_now() + timedelta(days=settings.workspace_invitation_ttl_days),
    )
    session.add(invitation)
    session.flush()
    log_audit_event(
        session,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        entity_type="workspace_invitation",
        entity_id=invitation.id,
        action="workspace_invitation_sent",
        message=f"发送邀请：{normalized_email}",
        metadata_json={"role": payload.role},
    )
    session.commit()
    session.refresh(invitation)

    send_workspace_invitation_email(invitation.email, workspace.name, raw_token)
    return WorkspaceInvitationDispatchResponse(
        message="邀请已发送。",
        invitation=WorkspaceInvitationRead.model_validate(invitation),
        debug_invitation_token=raw_token if should_expose_debug_token() else None,
    )


@router.get("/{workspace_id}/invitations", response_model=list[WorkspaceInvitationRead])
def list_workspace_invitations(
    workspace_id: str,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> list[WorkspaceInvitationRead]:
    membership = require_workspace_access(session, workspace_id, current_user.id)
    require_workspace_admin(membership)

    invitations = session.scalars(
        select(WorkspaceInvitation)
        .where(WorkspaceInvitation.workspace_id == workspace_id)
        .order_by(WorkspaceInvitation.created_at.desc())
    ).all()
    return [WorkspaceInvitationRead.model_validate(invitation) for invitation in invitations]


@router.delete("/{workspace_id}/invitations/{invitation_id}", response_model=MessageResponse)
def revoke_workspace_invitation(
    workspace_id: str,
    invitation_id: str,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> MessageResponse:
    membership = require_workspace_access(session, workspace_id, current_user.id)
    require_workspace_admin(membership)

    invitation = session.scalar(
        select(WorkspaceInvitation).where(
            WorkspaceInvitation.workspace_id == workspace_id,
            WorkspaceInvitation.id == invitation_id,
        )
    )
    if invitation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="邀请不存在。")

    if invitation.accepted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="已接受的邀请不能撤销。"
        )

    if invitation.revoked_at is None:
        invitation.revoked_at = utc_now()
        log_audit_event(
            session,
            workspace_id=workspace_id,
            actor_user_id=current_user.id,
            entity_type="workspace_invitation",
            entity_id=invitation.id,
            action="workspace_invitation_revoked",
            message=f"撤销邀请：{invitation.email}",
            metadata_json=None,
        )
        session.commit()

    return MessageResponse(message="邀请已撤销。")


@router.get("/invitations/pending", response_model=list[PendingInvitationRead])
def list_pending_invitations(
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> list[PendingInvitationRead]:
    rows = session.execute(
        select(WorkspaceInvitation, Workspace.name)
        .join(Workspace, WorkspaceInvitation.workspace_id == Workspace.id)
        .where(
            WorkspaceInvitation.email == current_user.email.lower(),
            WorkspaceInvitation.accepted_at.is_(None),
            WorkspaceInvitation.revoked_at.is_(None),
            WorkspaceInvitation.expires_at > utc_now(),
        )
        .order_by(WorkspaceInvitation.created_at.desc())
    ).all()

    return [
        PendingInvitationRead(
            id=invitation.id,
            workspace_id=invitation.workspace_id,
            workspace_name=workspace_name,
            role=invitation.role,
            email=invitation.email,
            expires_at=invitation.expires_at,
            invited_by_user_id=invitation.invited_by_user_id,
        )
        for invitation, workspace_name in rows
    ]


@router.post("/invitations/accept", response_model=MessageResponse)
def accept_workspace_invitation(
    payload: InvitationAcceptRequest,
    current_user: User = Depends(get_current_verified_user),
    session: Session = Depends(get_db),
) -> MessageResponse:
    invitation = session.scalar(
        select(WorkspaceInvitation).where(
            WorkspaceInvitation.token_hash == hash_token(payload.token)
        )
    )
    if (
        invitation is None
        or invitation.revoked_at is not None
        or invitation.expires_at <= utc_now()
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="邀请无效或已过期。")

    if invitation.accepted_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="邀请已被使用。")

    if invitation.email != current_user.email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="当前账号不能接受该邀请。"
        )

    existing_membership = session.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == invitation.workspace_id,
            WorkspaceMember.user_id == current_user.id,
        )
    )
    if existing_membership is None:
        session.add(
            WorkspaceMember(
                workspace_id=invitation.workspace_id,
                user_id=current_user.id,
                role=invitation.role,
                status="active",
            )
        )
    else:
        existing_membership.status = "active"
        existing_membership.role = invitation.role
        existing_membership.joined_at = utc_now()

    invitation.accepted_at = utc_now()
    log_audit_event(
        session,
        workspace_id=invitation.workspace_id,
        actor_user_id=current_user.id,
        entity_type="workspace_invitation",
        entity_id=invitation.id,
        action="workspace_invitation_accepted",
        message=f"接受邀请并加入工作空间：{invitation.email}",
        metadata_json={"role": invitation.role},
    )
    session.commit()

    return MessageResponse(message="已加入工作空间。")
