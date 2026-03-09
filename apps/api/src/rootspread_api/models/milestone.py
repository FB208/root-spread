from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from rootspread_api.core.database import Base
from rootspread_api.models.mixins import IdMixin, TimestampMixin


class Milestone(IdMixin, TimestampMixin, Base):
    __tablename__ = "milestones"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    archived_task_count: Mapped[int] = mapped_column(Integer, default=0)
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)

    snapshots = relationship(
        "MilestoneSnapshot",
        back_populates="milestone",
        cascade="all, delete-orphan",
    )


class MilestoneSnapshot(IdMixin, TimestampMixin, Base):
    __tablename__ = "milestone_snapshots"

    milestone_id: Mapped[str] = mapped_column(
        ForeignKey("milestones.id", ondelete="CASCADE"),
        index=True,
    )
    snapshot_name: Mapped[str] = mapped_column(String(160))
    snapshot_data: Mapped[list[dict]] = mapped_column(JSON)
    archived_task_count: Mapped[int] = mapped_column(Integer, default=0)
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)

    milestone = relationship("Milestone", back_populates="snapshots")
