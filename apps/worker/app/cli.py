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
from app.scraper.savee import SaveeScraper
from app.storage.r2 import R2Storage

logger = setup_logging(__name__)


def _detect_source_type(url: str) -> str:
    """Detect source type from URL."""
    if not url:
        return 'user'
    
    u = url.lower().strip()
    if u in {"https://savee.it", "https://savee.it/", "savee.it"}:
        return 'home'
    if any(x in u for x in ["savee.it/pop", "savee.it/trending", "savee.it/popular"]):
        return 'pop'
    return 'user'


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
    
    # Create the upsert statement
    stmt = insert(Block).values(
        source_id=source_id,
        run_id=run_id,
        external_id=item.external_id,
        url=getattr(item, 'page_url', f"https://savee.it/i/{item.external_id}"),
        title=getattr(item, 'title', ''),
        description=getattr(item, 'description', ''),
        media_type=getattr(item, 'media_type', 'image'),
        image_url=item.media_url if getattr(item, 'media_type', 'image') == 'image' else None,
        video_url=item.media_url if getattr(item, 'media_type', 'image') == 'video' else None,
        thumbnail_url=getattr(item, 'thumbnail_url', None),
        original_source_url=getattr(item, 'source_original_url', None),
        status='uploaded' if r2_key else 'scraped',
        tags=tags,
        content_metadata=sidebar_info,
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
        status='active'
    )
    session.add(source)
    await session.flush()
    return source.id


async def create_run(session: AsyncSession, source_id: int, max_items: int) -> int:
    """Create a new run."""
    run = Run(
        source_id=source_id,
        kind='manual',
        max_items=max_items,
        status='running',
        counters={'found': 0, 'uploaded': 0, 'errors': 0},
        started_at=datetime.now(),
    )
    session.add(run)
    await session.flush()
    return run.id


async def update_run_status(session: AsyncSession, run_id: int, status: str, counters: Dict[str, int], error_msg: Optional[str] = None):
    """Update run status and counters."""
    update_data = {
        'status': status,
        'counters': counters,
        'updated_at': func.now(),
    }
    
    if status in ['completed', 'error']:
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
            if _detect_source_type(url) == 'home':
                items = await scraper.scrape_home(max_items=max_items)
            elif _detect_source_type(url) == 'pop':
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
            await update_run_status(session, run_id, 'running', counters)
            await session.commit()
            
            async with storage:
                for item in items:
                    try:
                        item_url = f"https://savee.com/i/{item.external_id}"
                        
                        # [FETCH] step
                        fetch_start = time.time()
                        print(f"[FETCH]... ↓ {item_url}", end=" ")
                        
                        # [SCRAPE] step 
                        scrape_start = time.time()
                        print(f"| ✓ | ⏱: {time.time() - fetch_start:.2f}s")
                        print(f"[SCRAPE].. ◆ {item_url}", end=" ")
                        
                        # [UPLOAD] step - R2 upload
                        upload_start = time.time()
                        print(f"| ✓ | ⏱: {time.time() - scrape_start:.2f}s")
                        
                        r2_key = None
                        if hasattr(item, 'media_url') and item.media_url:
                            base_key = f"blocks/{item.external_id}"
                            if getattr(item, 'media_type', 'image') == 'image':
                                r2_key = await storage.upload_image(item.media_url, base_key)
                            elif getattr(item, 'media_type', 'image') == 'video':
                                r2_key = await storage.upload_video(item.media_url, base_key)
                        
                        print(f"[COMPLETE] ● {item_url}", end=" ")
                        
                        # [WRITE] step - Database write
                        write_start = time.time()
                        print(f"| ✓ | ⏱: {time.time() - upload_start:.2f}s")
                        
                        await _upsert_block(session, source_id, run_id, item, r2_key)
                        
                        print(f"[WRITE/UPLOAD] ● {item_url} | ✓ | ⏱: {time.time() - write_start:.2f}s")
                        print("---")
                        
                        counters['uploaded'] += 1
                        
                        # Update run counters real-time
                        await update_run_status(session, run_id, 'running', counters)
                        await session.commit()
                        
                    except Exception as e:
                        print(f"[ERROR] ✗ {item_url} | ❌ | {str(e)}")
                        logger.error(f"Failed to process item {item.external_id}: {e}")
                        counters['errors'] += 1
                        
                        # Update error count
                        await update_run_status(session, run_id, 'running', counters)
                        await session.commit()
            
            # Mark run as completed
            await update_run_status(session, run_id, 'completed', counters)
            await session.commit()
            
            print(f"✅ Completed! Found: {counters['found']}, Uploaded: {counters['uploaded']}, Errors: {counters['errors']}")
            return counters
            
        except Exception as e:
            logger.error(f"Scraper run failed: {e}")
            if 'run_id' in locals():
                await update_run_status(session, run_id, 'error', counters, str(e))
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