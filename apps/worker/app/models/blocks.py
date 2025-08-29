"""
Blocks model - Cleaned and optimized schema
"""
from datetime import datetime
from typing import Optional, Dict, Any

from sqlalchemy import String, Text, DateTime, Integer, func, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Block(Base):
    """Blocks table - scraped content data (cleaned schema)"""
    __tablename__ = "blocks"
    
    # Primary key - using integer to match Payload
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    
    # External Reference
    external_id: Mapped[str] = mapped_column(
        String(255), 
        nullable=False, 
        unique=True,
        index=True,
        doc="Unique identifier from Savee.it"
    )
    
    # Relationships (get source_type/username via relationships)
    source_id: Mapped[int] = mapped_column(
        ForeignKey('sources.id'), 
        nullable=False, 
        index=True,
        doc="Source that discovered this block"
    )
    run_id: Mapped[int] = mapped_column(
        ForeignKey('runs.id'), 
        nullable=False, 
        index=True,
        doc="Run that scraped this block"
    )
    
    # Content Info
    url: Mapped[str] = mapped_column(
        Text, 
        nullable=False,
        doc="Content URL on Savee.it"
    )
    title: Mapped[str] = mapped_column(
        Text, 
        nullable=True,
        doc="Title of the content"
    )
    description: Mapped[str] = mapped_column(
        Text, 
        nullable=True,
        doc="Description of the content"
    )
    
    # Media information
    media_type: Mapped[str] = mapped_column(
        String(20), 
        nullable=True,
        doc="Media type: image, video, gif, unknown"
    )
    image_url: Mapped[str] = mapped_column(
        Text, 
        nullable=True,
        doc="Original image URL"
    )
    video_url: Mapped[str] = mapped_column(
        Text, 
        nullable=True,
        doc="Original video URL"
    )
    thumbnail_url: Mapped[str] = mapped_column(
        Text, 
        nullable=True,
        doc="Thumbnail URL"
    )
    original_source_url: Mapped[str] = mapped_column(
        Text, 
        nullable=True,
        doc="Original source URL before Savee"
    )
    
    # Status and Processing
    status: Mapped[str] = mapped_column(
        String(50), 
        default="pending",
        nullable=False,
        doc="Processing status: pending, fetched, scraped, uploaded, error"
    )
    
    # Metadata
    tags: Mapped[Dict[str, Any]] = mapped_column(
        JSON, 
        nullable=True,
        doc="Content tags"
    )
    content_metadata: Mapped[Dict[str, Any]] = mapped_column(
        JSON, 
        nullable=True,
        doc="Additional metadata"
    )
    
    # Storage
    r2_key: Mapped[str] = mapped_column(
        Text, 
        nullable=True,
        doc="R2 storage key for uploaded media"
    )
    
    # Error handling
    error_message: Mapped[str] = mapped_column(
        Text, 
        nullable=True,
        doc="Error message if processing failed"
    )
    
    # Timestamps (standard Payload)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        doc="When this block was created"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        doc="When this block was last updated"
    )

    # Relationships
    source = relationship("Source")
    run = relationship("Run")

    def __repr__(self) -> str:
        return f"<Block(id={self.id}, external_id='{self.external_id}', media_type='{self.media_type}', status='{self.status}')>"