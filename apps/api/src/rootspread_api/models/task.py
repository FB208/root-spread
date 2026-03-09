from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from rootspread_api.core.database import Base
from rootspread_api.models.mixins import IdMixin, TimestampMixin


class TaskStatus(StrEnum):
    IN_PROGRESS = "in_progress"
    PENDING_REVIEW = "pending_review"
    COMPLETED = "completed"
    TERMINATED = "terminated"


class TaskNode(IdMixin, TimestampMixin, Base):
    __tablename__ = "task_nodes"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
    )
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("task_nodes.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    root_id: Mapped[str] = mapped_column(String(36), index=True)
    path: Mapped[str] = mapped_column(String(2000))
    depth: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    title: Mapped[str] = mapped_column(String(200))
    content_markdown: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(
        String(32), default=TaskStatus.IN_PROGRESS.value, index=True
    )

    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    assignee_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    planned_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    archived_by_milestone_id: Mapped[str | None] = mapped_column(
        ForeignKey("milestones.id"),
        nullable=True,
        index=True,
    )
    weight: Mapped[int] = mapped_column(Integer, default=0)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)

    parent = relationship("TaskNode", remote_side="TaskNode.id", back_populates="children")
    children = relationship("TaskNode", back_populates="parent", cascade="all, delete-orphan")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    assignee = relationship("User", foreign_keys=[assignee_user_id])
    transitions = relationship(
        "TaskStatusTransition",
        back_populates="task",
        cascade="all, delete-orphan",
    )


class TaskStatusTransition(IdMixin, TimestampMixin, Base):
    __tablename__ = "task_status_transitions"

    task_node_id: Mapped[str] = mapped_column(
        ForeignKey("task_nodes.id", ondelete="CASCADE"),
        index=True,
    )
    from_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_status: Mapped[str] = mapped_column(String(32))
    action_type: Mapped[str] = mapped_column(String(64), default="manual_update")
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    operator_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)

    task = relationship("TaskNode", back_populates="transitions")
    operator = relationship("User")
