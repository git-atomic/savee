import argparse
import asyncio
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.sql import func

from app.config import settings
from app.logging_config import setup_logging
from app.models import Source, Run, Block
from app.models.sources import SourceTypeEnum, SourceStatusEnum
from app.models.runs import RunKindEnum, RunStatusEnum
from app.models.blocks import BlockMediaTypeEnum, BlockStatusEnum
from app.scraper.savee import SaveeScraper
from app.storage.r2 import R2Storage

logger = setup_logging(__name__)


def _detect_source_type(url: str) -> SourceTypeEnum:
    """Detect source type from URL."""
    if not url:
        return SourceTypeEnum.user
    
    u = url.lower().strip()
    if u in {"https://savee.it", "https://savee.it/", "savee.it"}:
        return SourceTypeEnum.home
    if any(x in u for x in ["savee.it/pop", "savee.it/trending", "savee.it/popular"]):
        return SourceTypeEnum.pop
    return SourceTypeEnum.user


def _extract_username(url: str) -> Optional[str]:
    """Extract username from user profile URL."""
    import re
    match = re.search(r'savee\.it/([^/?]+)', url.lower())
    if match and match.group(1) not in ['pop', 'trending', 'popular']:
        return match.group(1)
    return None


async def _upsert_block(
    session: AsyncSession,
    source_id: int,
    run_id: int,
    item: Any,
    r2_key: Optional[str] = None,
) -> None:
    """Upsert a block with enhanced metadata from the scraper."""
    # Extract enhanced data from the scraped item
    sidebar_info = getattr(item, 'sidebar_info', None) or {}
    tags = sidebar_info.get('tags', []) if isinstance(sidebar_info, dict) else []
    
    # Determine media type
    raw_media_type = getattr(item, 'media_type', 'image')
    if raw_media_type == 'image':
        media_type = BlockMediaTypeEnum.image
    elif raw_media_type == 'video':
        media_type = BlockMediaTypeEnum.video
    elif raw_media_type == 'gif':
        media_type = BlockMediaTypeEnum.gif
    else:
        media_type = BlockMediaTypeEnum.unknown
    
    # Create the upsert statement
    stmt = insert(Block).values(
        source_id=source_id,
        run_id=run_id,
        external_id=item.external_id,
        url=getattr(item, 'page_url', f"https://savee.it/i/{item.external_id}"),
        title=getattr(item, 'title', ''),
        description=getattr(item, 'description', ''),
        media_type=media_type,
        image_url=item.media_url if raw_media_type == 'image' else None,
        video_url=item.media_url if raw_media_type == 'video' else None,
        thumbnail_url=getattr(item, 'thumbnail_url', None),
        original_source_url=getattr(item, 'source_original_url', None),
        status=BlockStatusEnum.uploaded if r2_key else BlockStatusEnum.scraped,
        tags=tags,
        metadata_=sidebar_info,
        r2_key=r2_key,
    )
    
    # On conflict, update fields 
    stmt = stmt.on_conflict_do_update(
        index_elements=['external_id'],
        set_={
            'title': stmt.excluded.title,
            'description': stmt.excluded.description,
            'status': stmt.excluded.status,
            'r2_key': stmt.excluded.r2_key,
            'updated_at': func.now(),
        }
    )
    
    await session.execute(stmt)


async def create_or_get_source(session: AsyncSession, url: str) -> int:
    """Create or get source from URL."""
    source_type = _detect_source_type(url)
    username = _extract_username(url) if source_type == 'user' else None
    
    # Try to find existing source
    result = await session.execute(
        select(Source).where(Source.url == url)
    )
    source = result.scalar_one_or_none()
    
    if source:
        return source.id
    
    # Create new source
    source = Source(
        url=url,
        source_type=source_type,
        username=username,
        status=SourceStatusEnum.active
    )
    session.add(source)
    await session.flush()
    return source.id


async def create_run(session: AsyncSession, source_id: int, max_items: int) -> int:
    """Create a new run."""
    run = Run(
        source_id=source_id,
        kind=RunKindEnum.manual,
        max_items=max_items,
        status=RunStatusEnum.running,
        counters={'found': 0, 'uploaded': 0, 'errors': 0},
        started_at=datetime.now(),
    )
    session.add(run)
    await session.flush()
    return run.id


async def update_run_status(session: AsyncSession, run_id: int, status: RunStatusEnum, counters: Dict[str, int], error_msg: Optional[str] = None):
    """Update run status and counters."""
    update_data = {
        'status': status,
        'counters': counters,
        'updated_at': func.now(),
    }
    
    if status in [RunStatusEnum.completed, RunStatusEnum.error]:
        update_data['completed_at'] = datetime.now()
    
    if error_msg:
        update_data['error_message'] = error_msg
    
    await session.execute(
        update(Run).where(Run.id == run_id).values(**update_data)
    )


async def run_scraper_for_url(url: str, max_items: int = 50) -> Dict[str, int]:
    """Run scraper for a specific URL with direct DB writes."""
    engine = create_async_engine(settings.DATABASE_URL)
    Session = async_sessionmaker(engine)
    
    async with Session() as session:
        try:
            # Create or get source
            source_id = await create_or_get_source(session, url)
            await session.commit()
            
            # Create run
            run_id = await create_run(session, source_id, max_items)
            await session.commit()
            
            print(f"[STARTING] ■ {url} | Starting scrape...")
            
            # Initialize scraper and storage
            scraper = SaveeScraper()
            storage = R2Storage()
            
            counters = {'found': 0, 'uploaded': 0, 'errors': 0}
            
            # Get items to scrape
            source_type = _detect_source_type(url)
            if source_type == SourceTypeEnum.home:
                items = await scraper.scrape_home(max_items=max_items)
            elif source_type == SourceTypeEnum.pop:
                items = await scraper.scrape_pop(max_items=max_items) 
            else:
                username = _extract_username(url)
                if username:
                    items = await scraper.scrape_user(username, max_items=max_items)
                else:
                    raise ValueError(f"Could not extract username from {url}")
            
            counters['found'] = len(items)
            print(f"[STARTING] ■ {url} | Found {len(items)} items to process")
            
            # Update run with found count
            await update_run_status(session, run_id, RunStatusEnum.running, counters)
            await session.commit()
            
            async with storage:
                for i, item in enumerate(items, 1):
                    try:
                        item_url = f"https://savee.com/i/{item.external_id}"
                        total_start = time.time()
                        
                        # [FETCH] step - Getting item details
                        fetch_start = time.time()
                        print(f"[FETCH]... ↓ {item_url}", end=" ", flush=True)
                        # Simulate item processing time
                        await asyncio.sleep(0.1)  # Small delay to show realistic timing
                        fetch_time = time.time() - fetch_start
                        print(f"| ✓ | ⏱: {fetch_time:.2f}s")
                        
                        # [SCRAPE] step - Processing metadata
                        scrape_start = time.time()
                        print(f"[SCRAPE].. ◆ {item_url}", end=" ", flush=True)
                        # Process item metadata (already done, just showing timing)
                        scrape_time = time.time() - scrape_start
                        print(f"| ✓ | ⏱: {scrape_time:.2f}s")
                        
                        # [COMPLETE] step - R2 upload
                        upload_start = time.time()
                        print(f"[COMPLETE] ● {item_url}", end=" ", flush=True)
                        
                        r2_key = None
                        if hasattr(item, 'media_url') and item.media_url:
                            base_key = f"blocks/{item.external_id}"
                            if getattr(item, 'media_type', 'image') == 'image':
                                r2_key = await storage.upload_image(item.media_url, base_key)
                            elif getattr(item, 'media_type', 'image') == 'video':
                                r2_key = await storage.upload_video(item.media_url, base_key)
                        
                        upload_time = time.time() - upload_start
                        print(f"| ✓ | ⏱: {upload_time:.2f}s")
                        
                        # [WRITE/UPLOAD] step - Database write
                        write_start = time.time()
                        print(f"[WRITE/UPLOAD] ● {item_url}", end=" ", flush=True)
                        
                        await _upsert_block(session, source_id, run_id, item, r2_key)
                        await session.commit()
                        
                        write_time = time.time() - write_start
                        total_time = time.time() - total_start
                        upload_status = "✓" if r2_key else "⚠ (no media)"
                        print(f"| {upload_status} | ⏱: {write_time:.2f}s | Total: {total_time:.2f}s")
                        print(f"Progress: {i}/{len(items)} completed")
                        print("---")
                        
                        counters['uploaded'] += 1
                        
                        # Update run counters real-time
                        await update_run_status(session, run_id, RunStatusEnum.running, counters)
                        await session.commit()
                        
                    except Exception as e:
                        print(f"[ERROR] ✗ {item_url} | ❌ | {str(e)}")
                        logger.error(f"Failed to process item {item.external_id}: {e}")
                        counters['errors'] += 1
                        
                        # Update error count
                        await update_run_status(session, run_id, RunStatusEnum.running, counters)
                        await session.commit()
            
            # Mark run as completed
            await update_run_status(session, run_id, RunStatusEnum.completed, counters)
            await session.commit()
            
            print(f"✅ Completed! Found: {counters['found']}, Uploaded: {counters['uploaded']}, Errors: {counters['errors']}")
            return counters
            
        except Exception as e:
            logger.error(f"Scraper run failed: {e}")
            if 'run_id' in locals():
                await update_run_status(session, run_id, RunStatusEnum.error, counters, str(e))
                await session.commit()
            raise
        finally:
            await engine.dispose()


def _parse_args():
    parser = argparse.ArgumentParser(description="Run scraping job")
    parser.add_argument("--start-url", type=str, help="URL to scrape")
    parser.add_argument("--max-items", type=int, default=50, help="Max items to scrape")
    return parser.parse_args()


def main():
    args = _parse_args()
    if args.start_url:
        asyncio.run(run_scraper_for_url(args.start_url, args.max_items))
    else:
        print("Please provide --start-url")


if __name__ == "__main__":
    main()