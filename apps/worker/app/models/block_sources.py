"""
BlockSources junction table - Many-to-many relationship between Blocks and Sources
Records provenance of where a block was seen (home, pop, specific user sources).
"""
from datetime import datetime
from sqlalchemy import Column, Integer, ForeignKey, DateTime, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class BlockSource(Base):
    """Junction table linking Blocks to Sources (many-to-many)"""
    __tablename__ = "block_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    block_id: Mapped[int] = mapped_column(
        ForeignKey('blocks.id', ondelete="CASCADE"),
        nullable=False,
        index=True,
        doc="Block ID"
    )

    source_id: Mapped[int] = mapped_column(
        ForeignKey('sources.id', ondelete="CASCADE"),
        nullable=False,
        index=True,
        doc="Source where block was seen"
    )

    run_id: Mapped[int] = mapped_column(
        ForeignKey('runs.id', ondelete="SET NULL"),
        nullable=True,
        index=True,
        doc="Run during which this relation was recorded"
    )

    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        doc="When we first recorded this relation"
    )

    saved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        doc="Timestamp from listing when available"
    )

    __table_args__ = (
        UniqueConstraint('block_id', 'source_id', name='uq_block_source'),
    )

    def __repr__(self):
        return f"<BlockSource(block_id={self.block_id}, source_id={self.source_id}, run_id={self.run_id})>"




