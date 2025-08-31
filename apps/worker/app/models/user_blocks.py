"""
UserBlocks junction table - Many-to-many relationship between SaveeUsers and Blocks
"""
from datetime import datetime
from sqlalchemy import Column, Integer, ForeignKey, DateTime, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class UserBlock(Base):
    """Junction table linking SaveeUsers to Blocks (many-to-many)"""
    __tablename__ = "user_blocks"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    
    # Foreign keys
    user_id: Mapped[int] = mapped_column(
        ForeignKey('savee_users.id'),
        nullable=False,
        index=True,
        doc="SaveeUser who saved this block"
    )
    
    block_id: Mapped[int] = mapped_column(
        ForeignKey('blocks.id'),
        nullable=False,
        index=True,
        doc="Block that was saved"
    )
    
    # When this user saved this block
    saved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        doc="When this user saved this block"
    )
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now()
    )
    
    # Unique constraint: each user can only save each block once
    __table_args__ = (
        UniqueConstraint('user_id', 'block_id', name='uq_user_block'),
    )

    def __repr__(self):
        return f"<UserBlock(user_id={self.user_id}, block_id={self.block_id}, saved_at='{self.saved_at}')>"


