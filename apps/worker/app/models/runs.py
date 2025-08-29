"""
Runs model - Enhanced with max_items configuration
"""
from sqlalchemy import DateTime, String, Text, JSON, ForeignKey, Integer, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from typing import Dict, Any, Optional
import enum

from .base import Base

# Define ENUM types to match Payload CMS
class RunKindEnum(enum.Enum):
    manual = "manual"
    scheduled = "scheduled"

class RunStatusEnum(enum.Enum):
    pending = "pending"
    running = "running"
    paused = "paused"
    completed = "completed"
    error = "error"


class Run(Base):
    __tablename__ = "runs"

    # Primary key - using integer to match Payload
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True
    )
    
    # Foreign key to source (integer to match)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), 
        nullable=False,
        doc="Source that this run belongs to"
    )
    
    # Execution Info (per-run configuration)
    kind: Mapped[RunKindEnum] = mapped_column(
        Enum(RunKindEnum, name="enum_runs_kind", create_type=False),
        default=RunKindEnum.manual,
        nullable=False,
        doc="Execution type: 'manual' or 'scheduled'"
    )
    max_items: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=50,
        doc="Maximum items to scrape for this run"
    )
    status: Mapped[RunStatusEnum] = mapped_column(
        Enum(RunStatusEnum, name="enum_runs_status", create_type=False), 
        default=RunStatusEnum.pending, 
        nullable=False,
        doc="Run status: pending, running, paused, completed, error"
    )
    
    # Counters (matching CMS JSON structure)
    counters: Mapped[Dict[str, Any]] = mapped_column(
        JSON, 
        nullable=True,
        default=lambda: {"found": 0, "uploaded": 0, "errors": 0},
        doc="Run metrics: found, uploaded, errors"
    )
    
    # Timestamps (matching CMS)
    started_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), 
        nullable=True,
        doc="When this run started"
    )
    completed_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), 
        nullable=True,
        doc="When this run completed"
    )
    
    # Error handling (matching CMS)
    error_message: Mapped[str] = mapped_column(
        Text, 
        nullable=True,
        doc="Error message if run failed"
    )
    
    # Payload timestamps
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), 
        nullable=False, 
        server_default=func.now(),
        doc="When this run was created"
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), 
        nullable=False, 
        server_default=func.now(), 
        onupdate=func.now(),
        doc="When this run was last updated"
    )

    # Relationship to source
    source = relationship("Source", back_populates="runs")

    def __repr__(self) -> str:
        return f"<Run(id={self.id}, source_id={self.source_id}, status='{self.status}', max_items={self.max_items})>"