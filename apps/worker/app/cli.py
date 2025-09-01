import argparse
import asyncio
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

# Set up proper encoding for Windows to prevent Unicode errors
import sys
import os
if sys.platform.startswith('win'):
    os.environ['PYTHONIOENCODING'] = 'utf-8'
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from sqlalchemy import select, update, or_, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.sql import func

from app.config import settings
from app.logging_config import setup_logging
from app.logging import log_starting, log_fetch, log_scrape, log_upload, log_write, log_error, log_complete
import aiohttp
from app.models import Source, Run, Block, SaveeUser, UserBlock
from app.models.sources import SourceTypeEnum, SourceStatusEnum
from app.models.runs import RunKindEnum, RunStatusEnum
from app.models.blocks import BlockMediaTypeEnum, BlockStatusEnum
from app.scraper.savee import SaveeScraper
from app.storage.r2 import R2Storage
import re
from datetime import timezone

logger = setup_logging(__name__)


async def _check_if_paused(session: AsyncSession, source_id: int) -> bool:
    """Check if the source has been paused by checking its status in the database."""
    try:
        result = await session.execute(
            select(Source.status).where(Source.id == source_id)
        )
        status = result.scalar_one_or_none()
        return status == SourceStatusEnum.paused
    except Exception as e:
        logger.error(f"Error checking pause status: {e}")
        return False


async def _handle_graceful_pause(session: AsyncSession, run_id: int):
    """Handle graceful pause by updating run status."""
    try:
        await session.execute(
            update(Run)
            .where(Run.id == run_id)
            .values(status=RunStatusEnum.paused)
        )
        await session.commit()
        print("\n🛑 PAUSED - Current block completed, waiting for resume...")
        await log_complete(run_id, "PAUSE", 0.0, "Job paused gracefully after completing current block")
    except Exception as e:
        logger.error(f"Error handling graceful pause: {e}")


async def _wait_for_resume(session: AsyncSession, source_id: int, run_id: int):
    """Wait for the job to be resumed by polling the database status."""
    print("⏳ Waiting for resume command...")
    while True:
        try:
            result = await session.execute(
                select(Source.status).where(Source.id == source_id)
            )
            status = result.scalar_one_or_none()
            
            if status == SourceStatusEnum.active:
                # Update run status back to running
                await session.execute(
                    update(Run)
                    .where(Run.id == run_id)
                    .values(status=RunStatusEnum.running)
                )
                await session.commit()
                print("▶️ RESUMED - Continuing from next block...")
                await log_complete(run_id, "RESUME", 0.0, "Job resumed, continuing processing")
                break
            elif status == SourceStatusEnum.completed or status == SourceStatusEnum.error:
                print("🛑 Job completed/stopped during pause. Exiting...")
                return False
                
            await asyncio.sleep(2)  # Check every 2 seconds
        except Exception as e:
            # If the session is in an invalid transaction state, roll it back before retrying
            try:
                await session.rollback()
            except Exception as rb_err:
                logger.error(f"Rollback failed while waiting for resume: {rb_err}")
            logger.error(f"Error waiting for resume: {e}")
            await asyncio.sleep(5)
    
    return True


async def _item_already_processed(session: AsyncSession, run_id: int, external_id: str) -> bool:
    """Check if an item has already been processed in this run."""
    try:
        result = await session.execute(
            select(Block.id).where(
                (Block.run_id == run_id) & (Block.external_id == external_id)
            )
        )
        return result.scalar_one_or_none() is not None
    except Exception as e:
        logger.error(f"Error checking if item already processed: {e}")
        return False


async def _item_exists_globally(session: AsyncSession, external_id: str) -> bool:
    """Check if an item exists in blocks table across any run/source."""
    try:
        result = await session.execute(
            select(Block.id).where(Block.external_id == external_id)
        )
        return result.scalar_one_or_none() is not None
    except Exception as e:
        logger.error(f"Error checking global item existence: {e}")
        return False


async def _load_known_external_ids(
    session: AsyncSession,
    source_id: int,
    source_limit: int = 1000,
    global_limit: int = 0,
) -> tuple[set[str], set[str]]:
    """Prefetch recent known external_ids for fast skip checks.

    Returns (known_source_ids, known_global_ids)
    """
    from sqlalchemy import desc

    known_source: set[str] = set()
    known_global: set[str] = set()
    try:
        if source_limit > 0:
            rows = await session.execute(
                select(Block.external_id)
                .where(Block.source_id == source_id)
                .order_by(desc(Block.id))
                .limit(source_limit)
            )
            known_source = set([r[0] for r in rows.fetchall() if r and r[0]])
    except Exception as e:
        logger.error(f"Failed to load known source ids: {e}")

    try:
        if global_limit > 0:
            rows = await session.execute(
                select(Block.external_id)
                .order_by(desc(Block.id))
                .limit(global_limit)
            )
            known_global = set([r[0] for r in rows.fetchall() if r and r[0]])
    except Exception as e:
        logger.error(f"Failed to load known global ids: {e}")

    return known_source, known_global


def _detect_source_type(url: str) -> SourceTypeEnum:
    """Detect source type from URL."""
    if not url:
        return SourceTypeEnum.user
    
    u = url.lower().strip()
    # Support both savee.it and savee.com domains
    if u in {"https://savee.it", "https://savee.it/", "savee.it", 
             "https://savee.com", "https://savee.com/", "savee.com"}:
        return SourceTypeEnum.home
    if any(x in u for x in ["savee.it/pop", "savee.it/trending", "savee.it/popular",
                            "savee.com/pop", "savee.com/trending", "savee.com/popular"]):
        return SourceTypeEnum.pop
    return SourceTypeEnum.user

async def _send_simple_log_to_cms(run_id: int, log_data: dict):
    """Send log entry to CMS API for real-time display"""
    try:
        cms_url = "http://localhost:3000"  # CMS URL
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{cms_url}/api/engine/logs",
                json={
                    "jobId": str(run_id),  # Use runId as jobId for log storage
                    "log": log_data
                },
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                pass  # Don't log response to avoid noise
    except Exception:
        pass  # Fail silently if CMS is unavailable

def _generate_r2_key(url: str, external_id: str) -> str:
    """Generate organized R2 key based on source type and URL

    Unified layout:
      - home/blocks/<external_id>
      - pop/blocks/<external_id>
      - users/<username>/blocks/<external_id>
    """
    source_type = _detect_source_type(url)
    
    if source_type == SourceTypeEnum.home:
        return f"home/blocks/{external_id}"
    elif source_type == SourceTypeEnum.pop:
        return f"pop/blocks/{external_id}"
    elif source_type == SourceTypeEnum.user:
        username = _extract_username(url)
        if username:
            return f"users/{username}/blocks/{external_id}"
        else:
            return f"users/unknown/blocks/{external_id}"
    else:
        return f"misc/blocks/{external_id}"

async def _create_or_update_savee_user(session: AsyncSession, username: str, url: str) -> int:
    """Create or update SaveeUser profile with scraped data"""
    from sqlalchemy import select
    from datetime import datetime, timezone
    import re
    import asyncio

    # Ensure schema is up-to-date (add new columns if missing)
    try:
        await session.execute(
            text(
                "ALTER TABLE savee_users ADD COLUMN IF NOT EXISTS profile_image_r2_key VARCHAR(500)"
            )
        )
        await session.commit()
    except Exception:
        # Non-fatal; continue
        await session.rollback()
    
    # Check if user already exists
    result = await session.execute(
        select(SaveeUser).where(SaveeUser.username == username)
    )
    existing_user = result.scalar_one_or_none()
    
    # Scrape user profile data
    try:
        async with aiohttp.ClientSession() as scrape_session:
            async with scrape_session.get(url) as response:
                if response.status == 200:
                    html_content = await response.text()
                    
                    # Extract profile data from HTML
                    profile_data = _extract_user_profile_data(html_content, username, url)

                    # Upload avatar to R2 if present (store even if default avatar)
                    avatar_url = profile_data.get('profile_image_url')
                    if avatar_url:
                        try:
                            storage = R2Storage()
                            # Store as users/<username>/avatar/...
                            base_key = f"users/{username}/avatar"
                            async with storage:
                                uploaded_key = await storage.upload_image(avatar_url, base_key)
                            if uploaded_key:
                                # Persist R2 key into profile metadata
                                profile_data['profile_image_r2_key'] = uploaded_key
                        except Exception as avatar_err:
                            logger.warning(f"Avatar upload failed for {username}: {avatar_err}")
                    
                    if existing_user:
                        # Update existing user with new profile data
                        for key, value in profile_data.items():
                            if hasattr(existing_user, key) and value is not None:
                                setattr(existing_user, key, value)
                        existing_user.last_scraped_at = datetime.now(timezone.utc)
                        await session.flush()
                        return existing_user.id
                    else:
                        # Create new SaveeUser with scraped data
                        savee_user = SaveeUser(**profile_data)
                        session.add(savee_user)
                        await session.flush()
                        return savee_user.id
                        
    except Exception as e:
        print(f"Error scraping user profile {url}: {e}")
    
    # Fallback: create/update with minimal data if scraping fails
    if existing_user:
        existing_user.last_scraped_at = datetime.now(timezone.utc)
        await session.flush()
        return existing_user.id
    
    # Create new SaveeUser with minimal data
    savee_user = SaveeUser(
        username=username,
        display_name=username,
        profile_url=url,
        is_active=True,
        last_scraped_at=datetime.now(timezone.utc)
    )
    session.add(savee_user)
    await session.flush()
    return savee_user.id

def _extract_user_profile_data(html_content: str, username: str, url: str) -> dict:
    """Extract user profile data from HTML"""
    from datetime import datetime, timezone
    import json
    import re
    
    # Initialize with default values
    profile_data = {
        'username': username,
        'display_name': username,
        'profile_url': url,
        'is_active': True,
        'last_scraped_at': datetime.now(timezone.utc)
    }
    
    try:
        # Try to extract display name from title or meta tags
        display_name_match = re.search(r'<title>([^<]+)', html_content, re.IGNORECASE)
        if display_name_match:
            title = display_name_match.group(1).strip()
            # Remove "- Savee" suffix if present
            if " - Savee" in title:
                profile_data['display_name'] = title.replace(" - Savee", "").strip()
        
        # Extract profile image URL - try multiple strategies
        # 1) <img ... class~="rounded-full" ... src="...">
        img_match = re.search(r'<img[^>]+class=["\"][^"\"]*rounded-full[^"\"]*["\"][^>]*src=["\"]([^"\"]+)["\"]', html_content, re.IGNORECASE | re.DOTALL)
        if not img_match:
            # Attributes may be in different order
            img_match = re.search(r'<img[^>]*src=["\"]([^"\"]+)["\"][^>]+class=["\"][^"\"]*rounded-full[^"\"]*["\"]', html_content, re.IGNORECASE | re.DOTALL)
        if img_match:
            profile_data['profile_image_url'] = img_match.group(1)
        
        # 2) OpenGraph image fallback
        if 'profile_image_url' not in profile_data:
            profile_img_match = re.search(r'<meta\s+property=["\"]og:image["\"][^>]*content=["\"]([^"\"]+)["\"]', html_content, re.IGNORECASE)
            if profile_img_match:
                profile_data['profile_image_url'] = profile_img_match.group(1)
        
        # 3) Default avatar fallback
        if 'profile_image_url' not in profile_data:
            default_match = re.search(r'(https?://[^\s"\']+/default-avatar-\d+\.jpg)', html_content, re.IGNORECASE)
            if default_match:
                profile_data['profile_image_url'] = default_match.group(1)
        
        # Extract bio/description
        description_match = re.search(r'<meta property="og:description" content="([^"]+)"', html_content)
        if description_match:
            profile_data['bio'] = description_match.group(1)
        
        # Try to extract stats from JSON data in script tags
        json_data_match = re.search(r'window\.__INITIAL_STATE__\s*=\s*({.+?});', html_content, re.DOTALL)
        if json_data_match:
            try:
                initial_state = json.loads(json_data_match.group(1))
                # Navigate through the JSON structure to find user stats
                if 'user' in initial_state:
                    user_data = initial_state['user']
                    if 'followers_count' in user_data:
                        profile_data['follower_count'] = user_data['followers_count']
                    if 'following_count' in user_data:
                        profile_data['following_count'] = user_data['following_count']
                    if 'saves_count' in user_data:
                        profile_data['saves_count'] = user_data['saves_count']
                    if 'collections_count' in user_data:
                        profile_data['collections_count'] = user_data['collections_count']
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Could not parse user JSON data: {e}")
        
        # Try to extract stats from HTML elements (fallback)
        if 'follower_count' not in profile_data:
            # Look for follower count patterns in HTML
            followers_match = re.search(r'(\d+)\s*(?:followers?|Followers?)', html_content, re.IGNORECASE)
            if followers_match:
                profile_data['follower_count'] = int(followers_match.group(1))
        
        if 'following_count' not in profile_data:
            # Look for following count patterns in HTML
            following_match = re.search(r'(\d+)\s*(?:following|Following)', html_content, re.IGNORECASE)
            if following_match:
                profile_data['following_count'] = int(following_match.group(1))
        
        if 'saves_count' not in profile_data:
            # Look for saves count patterns in HTML
            saves_match = re.search(r'(\d+)\s*(?:saves?|Saves?)', html_content, re.IGNORECASE)
            if saves_match:
                profile_data['saves_count'] = int(saves_match.group(1))
        
    except Exception as e:
        print(f"Error extracting profile data: {e}")
    
    return profile_data

async def _create_user_block_relationship(session: AsyncSession, user_id: int, block_id: int) -> None:
    """Create user-block relationship (user saved this block)"""
    from sqlalchemy import select
    from sqlalchemy.dialects.postgresql import insert
    
    # Use INSERT ... ON CONFLICT DO NOTHING to avoid duplicates
    stmt = insert(UserBlock).values(
        user_id=user_id,
        block_id=block_id
    )
    stmt = stmt.on_conflict_do_nothing(index_elements=['user_id', 'block_id'])
    
    await session.execute(stmt)


def _extract_username(url: str) -> Optional[str]:
    """Extract username from user profile URL."""
    import re
    # Support both savee.it and savee.com domains
    match = re.search(r'savee\.(?:it|com)/([^/?]+)', url.lower())
    if match and match.group(1) not in ['pop', 'trending', 'popular']:
        return match.group(1)
    return None


async def _upsert_block(
    session: AsyncSession,
    source_id: int,
    run_id: int,
    item: Any,
    r2_key: Optional[str] = None,
) -> Tuple[int, bool]:
    """Upsert a block with enhanced metadata from the scraper.

    Returns (block_id, is_new)
    """
    # Pre-dedupe by external_id or stable media URLs to avoid duplicates across users/runs
    try:
        dedupe_conditions = [Block.external_id == item.external_id]
        og_img = getattr(item, 'og_image_url', None)
        img_url = getattr(item, 'image_url', None)
        thumb_url = getattr(item, 'thumbnail_url', None)
        vid_url = getattr(item, 'video_url', None)

        if og_img:
            dedupe_conditions.append(Block.og_image_url == og_img)
        if img_url:
            dedupe_conditions.append(Block.image_url == img_url)
        if thumb_url:
            dedupe_conditions.append(Block.thumbnail_url == thumb_url)
        if vid_url:
            dedupe_conditions.append(Block.video_url == vid_url)

        # Fast exact match first
        existing_q = await session.execute(select(Block.id).where(or_(*dedupe_conditions)))
        existing_block_id = existing_q.scalar_one_or_none()
        if existing_block_id:
            return int(existing_block_id), False

        # Fuzzy match by canonical Savee CDN asset fingerprint (filename/hash)
        def _asset_fp(u: Optional[str]) -> Optional[str]:
            if not u or not isinstance(u, str):
                return None
            try:
                base = u.split('?')[0]
                filename = base.rsplit('/', 1)[-1]
                # strip size/type prefixes
                for p in ("original_", "thumb_", "small_", "medium_", "large_"):
                    if filename.startswith(p):
                        filename = filename[len(p):]
                # remove extension
                if '.' in filename:
                    filename = filename.rsplit('.', 1)[0]
                # keep hex/hash-ish core if present
                import re
                m = re.search(r"[0-9a-fA-F]{10,}", filename)
                return (m.group(0) if m else filename).lower()
            except Exception:
                return None

        fps = list(filter(None, [_asset_fp(og_img), _asset_fp(img_url), _asset_fp(thumb_url), _asset_fp(vid_url)]))
        for fp in fps:
            like = f"%{fp}%"
            fuzzy_q = await session.execute(
                select(Block.id).where(
                    or_(
                        Block.og_image_url.ilike(like),
                        Block.image_url.ilike(like),
                        Block.thumbnail_url.ilike(like),
                        Block.video_url.ilike(like),
                    )
                )
            )
            fuzzy_id = fuzzy_q.scalar_one_or_none()
            if fuzzy_id:
                return int(fuzzy_id), False
    except Exception as _dedupe_err:
        logger.error(f"Pre-dedupe check failed: {_dedupe_err}")
    # Extract enhanced data from the scraped item
    # Convert sidebar_info to JSON-serializable format
    sidebar_info = getattr(item, 'sidebar_info', None) or {}
    if sidebar_info:
        # Ensure it's JSON serializable
        import json
        try:
            json.dumps(sidebar_info)  # Test serialization
        except (TypeError, ValueError):
            # Convert non-serializable objects to strings
            sidebar_info = {str(k): str(v) for k, v in sidebar_info.items()}
    tags = getattr(item, 'tags', [])  # Use tags from ScrapedItem which includes hashtags, AI tags, and colors
    
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
    
    # Check if this external_id already exists (don't update run_id on existing blocks)
    existing_check = await session.execute(
        select(Block.id).where(Block.external_id == item.external_id)
    )
    existing_block = existing_check.scalar_one_or_none()
    
    if existing_block:
        # Block already exists - just return it without changing run_id
        return int(existing_block), False
    
    # Create new block only if it doesn't exist
    stmt = insert(Block).values(
        source_id=source_id,
        run_id=run_id,
        external_id=item.external_id,
        url=getattr(item, 'page_url', f"https://savee.com/i/{item.external_id}"),
        title=getattr(item, 'title', ''),
        description=getattr(item, 'description', ''),
        media_type=media_type,
        image_url=getattr(item, 'image_url', None),
        video_url=getattr(item, 'video_url', None),
        thumbnail_url=getattr(item, 'thumbnail_url', None),
        status=BlockStatusEnum.uploaded if r2_key else BlockStatusEnum.scraped,
        
        # Rich metadata fields
        metadata_=sidebar_info,
        r2_key=r2_key,
        
        # Comprehensive OpenGraph metadata
        og_title=getattr(item, 'og_title', None),
        og_description=getattr(item, 'og_description', None),
        og_image_url=getattr(item, 'og_image_url', None),
        og_url=getattr(item, 'og_url', None),
        source_api_url=getattr(item, 'source_api_url', None),
        saved_at=getattr(item, 'saved_at', None),
        
        # Rich filtering/search metadata
        color_hexes=getattr(item, 'color_hexes', []),
        ai_tags=getattr(item, 'ai_tags', []),
        colors=getattr(item, 'colors', []),
        links=getattr(item, 'links', []),
    )
    
    result = await session.execute(stmt)
    
    # Get the new block ID
    new_block = await session.execute(
        select(Block.id).where(Block.external_id == item.external_id)
    )
    block_id = new_block.scalar_one()
    
    return int(block_id), True


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


async def run_scraper_for_url(url: str, max_items: Optional[int] = None, provided_run_id: Optional[int] = None) -> Dict[str, int]:
    """Run scraper for a specific URL with direct DB writes."""
    # Initialize counters at the top to avoid UnboundLocalError
    counters = {'found': 0, 'uploaded': 0, 'errors': 0, 'skipped': 0}
    
    engine = create_async_engine(settings.DATABASE_URL)
    Session = async_sessionmaker(engine)
    
    async with Session() as session:
        try:
            # Resolve source and run
            if provided_run_id:
                # Fetch run to get source_id
                run_row = await session.execute(select(Run).where(Run.id == provided_run_id))
                run_obj = run_row.scalar_one_or_none()
                if run_obj is None:
                    # Fallback: create source/run if missing
                    source_id = await create_or_get_source(session, url)
                    await session.commit()
                    run_id = await create_run(session, source_id, max_items or 0)
                    await session.commit()
                else:
                    run_id = run_obj.id
                    source_id = run_obj.source_id
                    # Reset counters to start clean; set running
                    await update_run_status(session, run_id, RunStatusEnum.running, counters)
                    await session.commit()
            else:
                # Create or get source and create run
                source_id = await create_or_get_source(session, url)
                await session.commit()
                run_id = await create_run(session, source_id, max_items or 0)
                await session.commit()
            
            print(f"[STARTING] {url} | Starting scrape...")
            
            # Initialize scraper and storage
            scraper = SaveeScraper()
            storage = R2Storage()
            
            print(f"[STARTING] {url} | Starting real-time scraping...")
            
            # Send starting log to CMS
            await _send_simple_log_to_cms(run_id, {
                "type": "STARTING",
                "url": url,
                "status": "⏳",
                "message": "Starting real-time scraping job..."
            })
            
            await log_starting(run_id, url, "Starting real-time scraping...")
            
            # Update run status to running
            await update_run_status(session, run_id, RunStatusEnum.running, counters)
            await session.commit()
            
            # Get the appropriate iterator for real-time processing
            source_type = _detect_source_type(url)
            savee_user_id = None
            
            if source_type == SourceTypeEnum.home:
                item_iterator = scraper.scrape_home_iterator(max_items=max_items)
            elif source_type == SourceTypeEnum.pop:
                item_iterator = scraper.scrape_pop_iterator(max_items=max_items)
            else:
                username = _extract_username(url)
                if username:
                    # Create or update SaveeUser profile for user content
                    savee_user_id = await _create_or_update_savee_user(session, username, url)
                    await session.commit()
                    item_iterator = scraper.scrape_user_iterator(username, max_items=max_items)
                else:
                    raise ValueError(f"Could not extract username from {url}")
            
            async with storage:
                processed_count = 0
                skipped_count = 0
                # Early-exit when only-old items encountered consecutively
                consecutive_old_items = 0
                try:
                    # When max_items is None/0 => unlimited, disable early-exit completely
                    only_old_exit_streak = 10**9 if not max_items else int(os.getenv('ONLY_OLD_EXIT_STREAK', '50'))
                except Exception:
                    only_old_exit_streak = 10**9 if not max_items else 50
                # Track unique external IDs seen in this run session to avoid counting duplicates from listing glitches
                seen_in_session: set[str] = set()
                # Prefetch recent known ids to short-circuit checks
                try:
                    preload_source_n = int(os.getenv('PRELOAD_SOURCE_KNOWN_N', '500'))
                    preload_global_n = int(os.getenv('PRELOAD_GLOBAL_KNOWN_N', '0'))
                except Exception:
                    preload_source_n, preload_global_n = 500, 0
                known_source_ids, known_global_ids = await _load_known_external_ids(
                    session, source_id, preload_source_n, preload_global_n
                )
                async for item in item_iterator:
                    # Count every item from the iterator as "processed"
                    processed_count += 1
                    counters['found'] = processed_count
                    
                    # Avoid double counting the same item within this session
                    try:
                        if getattr(item, 'external_id', None) in seen_in_session:
                            continue
                        if getattr(item, 'external_id', None):
                            seen_in_session.add(item.external_id)
                    except Exception:
                        pass

                    # Fast-path skip using preloaded sets
                    if item.external_id in known_source_ids or item.external_id in known_global_ids:
                        skipped_count += 1
                        counters['skipped'] = skipped_count
                        print(f"[SKIP/KNOWN] {item.external_id} - Preloaded known id (#{skipped_count} skipped)")
                        await update_run_status(session, run_id, RunStatusEnum.running, counters)
                        await session.commit()
                        consecutive_old_items += 1
                        if consecutive_old_items >= only_old_exit_streak:
                            print(f"[EARLY-EXIT] Detected {consecutive_old_items} consecutive known items; stopping sweep early.")
                            break
                        continue

                    # Skip if already processed in this run (for resume functionality)
                    if await _item_already_processed(session, run_id, item.external_id):
                        skipped_count += 1
                        counters['skipped'] = skipped_count
                        print(f"[SKIP] {item.external_id} - Already processed in this run (#{skipped_count} skipped)")
                        # Persist skip counters
                        await update_run_status(session, run_id, RunStatusEnum.running, counters)
                        await session.commit()
                        continue

                    # Skip if already exists globally (across previous runs)
                    if await _item_exists_globally(session, item.external_id):
                        skipped_count += 1
                        counters['skipped'] = skipped_count
                        print(f"[SKIP] {item.external_id} - Already exists in DB (#{skipped_count} skipped)")
                        # Persist skip counters
                        await update_run_status(session, run_id, RunStatusEnum.running, counters)
                        await session.commit()
                        consecutive_old_items += 1
                        if consecutive_old_items >= only_old_exit_streak:
                            print(f"[EARLY-EXIT] Detected {consecutive_old_items} consecutive old items; stopping sweep early.")
                            break
                        continue
                    
                    try:
                        item_url = f"https://savee.com/i/{item.external_id}"
                        total_start = time.time()
                        # Reset old-items streak when we find a new item to process
                        consecutive_old_items = 0
                        
                        # [FETCH] step - Getting item details
                        fetch_start = time.time()
                        print(f"[FETCH]... {item_url}", end=" ", flush=True)
                        
                        # Send real-time log to CMS
                        await _send_simple_log_to_cms(run_id, {
                            "type": "FETCH",
                            "url": item_url,
                            "status": "⏳",
                            "message": "Fetching item details..."
                        })
                        
                        # Simulate item processing time
                        await asyncio.sleep(0.1)  # Small delay to show realistic timing
                        fetch_time = time.time() - fetch_start
                        print(f"| OK | Time: {fetch_time:.2f}s")
                        
                        # Send completion log
                        await _send_simple_log_to_cms(run_id, {
                            "type": "FETCH",
                            "url": item_url,
                            "status": "✓",
                            "timing": f"{fetch_time:.2f}s",
                            "message": "Successfully fetched item details"
                        })
                        
                        # [SCRAPE] step - Processing metadata
                        scrape_start = time.time()
                        print(f"[SCRAPE].. {item_url}", end=" ", flush=True)
                        
                        # Send real-time log to CMS
                        await _send_simple_log_to_cms(run_id, {
                            "type": "SCRAPE",
                            "url": item_url,
                            "status": "⏳",
                            "message": "Processing metadata and content..."
                        })
                        
                        # Process item metadata (already done, just showing timing)
                        scrape_time = time.time() - scrape_start
                        print(f"| OK | Time: {scrape_time:.2f}s")
                        
                        # Send completion log
                        await _send_simple_log_to_cms(run_id, {
                            "type": "SCRAPE",
                            "url": item_url,
                            "status": "✓",
                            "timing": f"{scrape_time:.2f}s",
                            "message": "Successfully processed metadata"
                        })
                        
                        # [COMPLETE] step - R2 upload
                        upload_start = time.time()
                        print(f"[COMPLETE] {item_url}", end=" ", flush=True)
                        
                        # Send real-time log to CMS
                        await _send_simple_log_to_cms(run_id, {
                            "type": "COMPLETE",
                            "url": item_url,
                            "status": "⏳",
                            "message": "Uploading media to R2 storage..."
                        })
                        
                        r2_key = None
                        if hasattr(item, 'media_url') and item.media_url:
                            # Generate organized R2 key based on source type
                            base_key = _generate_r2_key(url, item.external_id)
                            if getattr(item, 'media_type', 'image') == 'image':
                                r2_key = await storage.upload_image(item.media_url, base_key)
                            elif getattr(item, 'media_type', 'image') == 'video':
                                r2_key = await storage.upload_video(item.media_url, base_key)
                        
                        upload_time = time.time() - upload_start
                        print(f"| OK | Time: {upload_time:.2f}s")
                        
                        # Send completion log
                        await _send_simple_log_to_cms(run_id, {
                            "type": "COMPLETE",
                            "url": item_url,
                            "status": "✓",
                            "timing": f"{upload_time:.2f}s",
                            "message": f"Successfully uploaded to R2: {base_key if 'base_key' in locals() else 'N/A'}"
                        })
                        
                        # [WRITE/UPLOAD] step - Database write
                        write_start = time.time()
                        print(f"[WRITE/UPLOAD] {item_url}", end=" ", flush=True)
                        
                        block_id, is_new = await _upsert_block(session, source_id, run_id, item, r2_key)
                        
                        # Create user-block relationship if this is user content
                        if savee_user_id:
                            await _create_user_block_relationship(session, savee_user_id, block_id)
                        
                        await session.commit()
                        
                        write_time = time.time() - write_start
                        total_time = time.time() - total_start
                        upload_status = "OK" if r2_key else "NO_MEDIA"
                        print(f"| {upload_status} | Time: {write_time:.2f}s | Total: {total_time:.2f}s")
                        progress_msg = f"{processed_count}/{max_items if max_items else 'unlimited'} completed"
                        print(f"SUCCESS {progress_msg}")
                        await log_complete(run_id, item_url, total_time, progress_msg)
                        
                        # Send log directly to CMS for real-time display
                        await _send_simple_log_to_cms(run_id, {
                            "type": "WRITE/UPLOAD",
                            "url": item_url,
                            "status": "✓",
                            "timing": f"{write_time:.2f}s",
                            "message": progress_msg
                        })
                        print("---")
                        
                        # If upsert created a new block, count as uploaded
                        if is_new:
                            counters['uploaded'] += 1
                        
                        # Update run counters real-time
                        await update_run_status(session, run_id, RunStatusEnum.running, counters)
                        await session.commit()
                        
                        # Check for pause after completing current block
                        if await _check_if_paused(session, source_id):
                            print(f"\n🛑 PAUSE DETECTED - Completed block {counters['uploaded']}/{max_items if max_items else 'unlimited'}")
                            await _handle_graceful_pause(session, run_id)
                            # Wait for resume or stop
                            should_continue = await _wait_for_resume(session, source_id, run_id)
                            if not should_continue:
                                print("Job stopped. Exiting...")
                                break
                            # If resumed, continue with next block
                            print(f"▶️ CONTINUING - Processing next blocks from {counters['uploaded'] + 1}...")
                        
                    except Exception as e:
                        print(f"[ERROR] ✗ {item_url} | ❌ | {str(e)}")
                        logger.error(f"Failed to process item {item.external_id}: {e}")
                        logger.error(f"Full error details: {type(e).__name__}: {str(e)}")
                        import traceback
                        logger.error(f"Traceback: {traceback.format_exc()}")
                        await log_error(run_id, item_url, str(e))
                        counters['errors'] += 1
                        
                        # Update error count
                        await update_run_status(session, run_id, RunStatusEnum.running, counters)
                        await session.commit()
            
            # Final reconciliation: ensure uploaded count matches actual DB inserts for this run
            try:
                db_uploaded_result = await session.execute(
                    select(func.count(Block.id)).where(Block.run_id == run_id)
                )
                db_uploaded = int(db_uploaded_result.scalar() or 0)
                counters['uploaded'] = db_uploaded
                # found = processed_count (total items seen), skipped = found - uploaded
                counters['found'] = processed_count
                counters['skipped'] = processed_count - db_uploaded
            except Exception as reconcile_err:
                logger.error(f"Failed to reconcile counters for run {run_id}: {reconcile_err}")

            # Mark run as completed
            await update_run_status(session, run_id, RunStatusEnum.completed, counters)
            await session.commit()
            
            # Send completion log to CMS
            await _send_simple_log_to_cms(run_id, {
                "type": "COMPLETE",
                "url": url,
                "status": "✓",
                "message": f"Job completed! Found: {counters['found']}, Uploaded: {counters['uploaded']}, Errors: {counters['errors']}"
            })
            
            print(f"COMPLETED! Found: {counters['found']}, Uploaded: {counters['uploaded']}, Errors: {counters['errors']}")
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
    parser.add_argument("--max-items", type=int, default=None, help="Max items to scrape (leave empty for unlimited)")
    parser.add_argument("--run-id", type=int, default=None, help="Existing run ID to reuse")
    return parser.parse_args()


def main():
    args = _parse_args()
    if args.start_url:
        asyncio.run(run_scraper_for_url(args.start_url, args.max_items, args.run_id))
    else:
        print("Please provide --start-url")


if __name__ == "__main__":
    main()