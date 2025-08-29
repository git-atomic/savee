"""
Sources model - Cleaned and optimized schema
"""
from sqlalchemy import DateTime, String, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .base import Base


class Source(Base):
    __tablename__ = "sources"

    # Primary key - using integer to match Payload
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True
    )
    
    # Core source information (essential only)
    url: Mapped[str] = mapped_column(
        Text, 
        nullable=False,
        unique=True,
        doc="Source URL for scraping"
    )
    source_type: Mapped[str] = mapped_column(
        String(50), 
        nullable=False,
        doc="Source type: 'home', 'pop', 'user'"
    )
    username: Mapped[str] = mapped_column(
        String(255), 
        nullable=True,
        doc="Username for user profile sources"
    )
    
    # Status only (everything else moved to appropriate tables)
    status: Mapped[str] = mapped_column(
        String(50), 
        default="active",
        nullable=False,
        doc="Current status: active, paused, completed, error"
    )
    
    # Timestamps (standard Payload)
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), 
        nullable=False, 
        server_default=func.now(),
        doc="When this source was created"
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), 
        nullable=False, 
        server_default=func.now(), 
        onupdate=func.now(),
        doc="When this source was last updated"
    )

    # Relationships
    runs = relationship("Run", back_populates="source", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Source(id={self.id}, url='{self.url}', source_type='{self.source_type}', status='{self.status}')>"