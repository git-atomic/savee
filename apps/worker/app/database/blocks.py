"""
Database operations for blocks
Production-grade upsert operations with proper error handling
"""
from datetime import datetime
from typing import Dict, Any, Optional, List
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import Block, BlockOverride, Source
from ..logging_config import get_logger, PerformanceLogger
from typing import Any

logger = get_logger(__name__)


class BlocksRepository:
    """Repository for blocks database operations"""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def upsert_block_from_parsed_item(
        self, 
        parsed_item: Any, 
        source_id: UUID,
        media_keys: Dict[str, str]
    ) -> Block:
        """
        Upsert a block from parsed Savee item data
        
        Args:
            parsed_item: Parsed item data from Savee scraper
            source_id: Source UUID
            media_keys: Dict of media type -> R2 object key
            
        Returns:
            The upserted Block instance
        """
        with PerformanceLogger(logger, "upsert_block", 
                             item_id=parsed_item.item_id, source_id=str(source_id)):
            
            # Prepare tags array
            tags_raw = []
            if parsed_item.sidebar_info and parsed_item.sidebar_info.get('tags'):
                tags_raw.extend(parsed_item.sidebar_info['tags'])
            if parsed_item.sidebar_info and parsed_item.sidebar_info.get('aiTags'):
                tags_raw.extend(parsed_item.sidebar_info['aiTags'])
            # Remove duplicates and clean
            tags_raw = list(set([tag.strip() for tag in tags_raw if tag and tag.strip()]))
            
            # Determine primary media key
            primary_media_key = None
            video_poster_key = None
            
            if parsed_item.media_type == 'video':
                primary_media_key = media_keys.get('video') or media_keys.get('image')
                video_poster_key = media_keys.get('poster') or media_keys.get('image')
            else:
                primary_media_key = media_keys.get('image')
            
            if not primary_media_key:
                raise ValueError(f"No primary media key available for item {parsed_item.item_id}")
            
            # Prepare upsert data
            upsert_data = {
                'source_id': source_id,
                'external_id': parsed_item.item_id,
                'title_raw': parsed_item.og_title,
                'description_raw': parsed_item.og_description,
                'tags_raw': tags_raw,
                'media_key': primary_media_key,
                'media_type': parsed_item.media_type,
                'video_poster_key': video_poster_key,
                'url': parsed_item.page_url,
                'source_api_url': parsed_item.source_api_url,
                'source_original_url': parsed_item.source_original_url,
                'sidebar_info': parsed_item.sidebar_info or {},
                'og_title': parsed_item.og_title,
                'og_description': parsed_item.og_description,
                'og_image_url': parsed_item.og_image_url,
                'og_url': parsed_item.og_url,
                'updated_at': func.current_timestamp()
            }
            
            # PostgreSQL upsert (ON CONFLICT DO UPDATE)
            stmt = insert(Block).values(**upsert_data)
            stmt = stmt.on_conflict_do_update(
                constraint='uq_core_blocks_source_external',
                set_={
                    'title_raw': stmt.excluded.title_raw,
                    'description_raw': stmt.excluded.description_raw,
                    'tags_raw': stmt.excluded.tags_raw,
                    'media_key': stmt.excluded.media_key,
                    'media_type': stmt.excluded.media_type,
                    'video_poster_key': stmt.excluded.video_poster_key,
                    'url': stmt.excluded.url,
                    'source_api_url': stmt.excluded.source_api_url,
                    'source_original_url': stmt.excluded.source_original_url,
                    'sidebar_info': stmt.excluded.sidebar_info,
                    'og_title': stmt.excluded.og_title,
                    'og_description': stmt.excluded.og_description,
                    'og_image_url': stmt.excluded.og_image_url,
                    'og_url': stmt.excluded.og_url,
                    'updated_at': stmt.excluded.updated_at
                }
            ).returning(Block)
            
            result = await self.session.execute(stmt)
            block = result.scalar_one()
            
            # Commit the transaction
            await self.session.commit()
            
            logger.info(f"Upserted block {parsed_item.item_id} -> {block.id}")
            return block
    
    async def get_block_by_external_id(
        self, 
        source_id: UUID, 
        external_id: str
    ) -> Optional[Block]:
        """Get block by source and external ID"""
        stmt = select(Block).where(
            Block.source_id == source_id,
            Block.external_id == external_id
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
    
    async def get_blocks_by_source(
        self, 
        source_id: UUID, 
        limit: int = 100,
        offset: int = 0,
        order_by: str = 'created_at'
    ) -> List[Block]:
        """Get blocks for a source with pagination"""
        order_col = getattr(Block, order_by, Block.created_at)
        
        stmt = (
            select(Block)
            .where(Block.source_id == source_id)
            .order_by(order_col.desc())
            .limit(limit)
            .offset(offset)
        )
        
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
    
    async def get_recent_blocks(
        self, 
        limit: int = 50,
        media_type: Optional[str] = None
    ) -> List[Block]:
        """Get recently created blocks"""
        stmt = select(Block).order_by(Block.created_at.desc()).limit(limit)
        
        if media_type:
            stmt = stmt.where(Block.media_type == media_type)
        
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
    
    async def block_exists(self, source_id: UUID, external_id: str) -> bool:
        """Check if block exists"""
        stmt = select(func.count(Block.id)).where(
            Block.source_id == source_id,
            Block.external_id == external_id
        )
        result = await self.session.execute(stmt)
        count = result.scalar()
        return count > 0
    
    async def get_blocks_missing_media(self, limit: int = 100) -> List[Block]:
        """Get blocks that might be missing media files"""
        # This is a placeholder - in production you'd check against R2
        stmt = (
            select(Block)
            .where(Block.media_key.isnot(None))
            .order_by(Block.created_at.desc())
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
    
    async def get_block_stats(self, source_id: Optional[UUID] = None) -> Dict[str, Any]:
        """Get block statistics"""
        base_query = select(func.count(Block.id).label('total'))
        
        if source_id:
            base_query = base_query.where(Block.source_id == source_id)
        
        # Total count
        result = await self.session.execute(base_query)
        total = result.scalar()
        
        # Media type breakdown
        media_query = (
            select(Block.media_type, func.count(Block.id).label('count'))
            .group_by(Block.media_type)
        )
        
        if source_id:
            media_query = media_query.where(Block.source_id == source_id)
        
        media_result = await self.session.execute(media_query)
        media_types = {row.media_type: row.count for row in media_result}
        
        # Recent activity
        recent_query = (
            select(func.count(Block.id))
            .where(Block.created_at >= func.current_timestamp() - func.interval('24 hours'))
        )
        
        if source_id:
            recent_query = recent_query.where(Block.source_id == source_id)
        
        recent_result = await self.session.execute(recent_query)
        recent_24h = recent_result.scalar()
        
        return {
            'total_blocks': total,
            'media_types': media_types,
            'recent_24h': recent_24h,
            'source_id': str(source_id) if source_id else None
        }


class BlockOverridesRepository:
    """Repository for block overrides (CMS layer)"""
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def create_override(
        self,
        block_id: UUID,
        title_override: Optional[str] = None,
        description_override: Optional[str] = None,
        tags_override: Optional[List[str]] = None,
        status: str = 'draft',
        priority: int = 0,
        notes: Optional[str] = None
    ) -> BlockOverride:
        """Create a new block override"""
        override = BlockOverride(
            block_id=block_id,
            title_override=title_override,
            description_override=description_override,
            tags_override=tags_override,
            status=status,
            priority=priority,
            notes=notes
        )
        
        self.session.add(override)
        await self.session.commit()
        await self.session.refresh(override)
        
        return override
    
    async def update_override(
        self,
        block_id: UUID,
        **updates
    ) -> Optional[BlockOverride]:
        """Update an existing override"""
        stmt = select(BlockOverride).where(BlockOverride.block_id == block_id)
        result = await self.session.execute(stmt)
        override = result.scalar_one_or_none()
        
        if not override:
            return None
        
        for key, value in updates.items():
            if hasattr(override, key):
                setattr(override, key, value)
        
        await self.session.commit()
        await self.session.refresh(override)
        
        return override
    
    async def get_override(self, block_id: UUID) -> Optional[BlockOverride]:
        """Get override for a block"""
        stmt = select(BlockOverride).where(BlockOverride.block_id == block_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
    
    async def delete_override(self, block_id: UUID) -> bool:
        """Delete an override"""
        stmt = select(BlockOverride).where(BlockOverride.block_id == block_id)
        result = await self.session.execute(stmt)
        override = result.scalar_one_or_none()
        
        if override:
            await self.session.delete(override)
            await self.session.commit()
            return True
        
        return False
    
    async def get_overrides_by_status(
        self,
        status: str,
        limit: int = 100,
        offset: int = 0
    ) -> List[BlockOverride]:
        """Get overrides by status"""
        stmt = (
            select(BlockOverride)
            .where(BlockOverride.status == status)
            .order_by(BlockOverride.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        
        result = await self.session.execute(stmt)
        return list(result.scalars().all())


# Helper functions for easy access
async def upsert_block_from_savee_item(
    session: AsyncSession,
    parsed_item: ParsedItem,
    source_id: UUID,
    media_keys: Dict[str, str]
) -> Block:
    """Convenience function for upserting blocks"""
    repo = BlocksRepository(session)
    return await repo.upsert_block_from_parsed_item(parsed_item, source_id, media_keys)


async def get_block_by_savee_id(
    session: AsyncSession,
    source_id: UUID,
    savee_id: str
) -> Optional[Block]:
    """Convenience function for getting blocks by Savee ID"""
    repo = BlocksRepository(session)
    return await repo.get_block_by_external_id(source_id, savee_id)

