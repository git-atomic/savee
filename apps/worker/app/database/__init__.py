"""
Database package for ScrapeSavee worker
"""

from .blocks import (
    BlocksRepository,
    BlockOverridesRepository,
    upsert_block_from_savee_item,
    get_block_by_savee_id
)

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from ..config import settings

_engine = create_async_engine(settings.async_database_url)
_Session = async_sessionmaker(_engine, expire_on_commit=False)

class _SessionCtx:
    def __init__(self):
        self.session: AsyncSession | None = None
    async def __aenter__(self) -> AsyncSession:
        self.session = _Session()
        return self.session
    async def __aexit__(self, exc_type, exc, tb):
        await self.session.close()

def get_async_session() -> _SessionCtx:
    """Context manager to yield an AsyncSession (avoids circular imports)."""
    return _SessionCtx()

__all__ = [
    "BlocksRepository",
    "BlockOverridesRepository", 
    "upsert_block_from_savee_item",
    "get_block_by_savee_id"
]