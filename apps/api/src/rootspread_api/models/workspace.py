from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from rootspread_api.core.database import Base
from rootspread_api.core.time import utc_now
from rootspread_api.models.mixins import IdMixin, TimestampMixin


class Workspace(IdMixin, TimestampMixin, Base):
    __tablename__ = "workspaces"

    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)

    owner = relationship("User", back_populates="owned_workspaces")
    members = relationship(
        "WorkspaceMember", back_populates="workspace", cascade="all, delete-orphan"
    )
    invitations = relationship(
        "WorkspaceInvitation",
        back_populates="workspace",
        cascade="all, delete-orphan",
    )


class WorkspaceMember(IdMixin, Base):
    __tablename__ = "workspace_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", name="uq_workspace_membership"),)

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(32), default="member")
    status: Mapped[str] = mapped_column(String(32), default="active")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    workspace = relationship("Workspace", back_populates="members")
    user = relationship("User", back_populates="memberships")


class WorkspaceInvitation(IdMixin, TimestampMixin, Base):
    __tablename__ = "workspace_invitations"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
    )
    email: Mapped[str] = mapped_column(String(320), index=True)
    role: Mapped[str] = mapped_column(String(32), default="member")
    invited_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    workspace = relationship("Workspace", back_populates="invitations")
    invited_by = relationship(
        "User",
        back_populates="sent_invitations",
        foreign_keys=[invited_by_user_id],
    )
