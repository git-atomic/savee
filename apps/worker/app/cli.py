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

from sqlalchemy import select, update, or_
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
import json

logger = setup_logging(__name__)


def _load_savee_auth_token() -> Optional[str]:
    """Load auth_token from savee_cookies.json if available."""
    try:
        base_dir = os.path.dirname(__file__)
        cookies_path = os.path.abspath(os.path.join(base_dir, '..', 'savee_cookies.json'))
        with open(cookies_path, 'r', encoding='utf-8') as f:
            cookies = json.load(f)
        for c in cookies:
            if c.get('name') == 'auth_token' and c.get('value'):
                return c['value']
    except Exception as e:
        logger.debug(f"Auth cookie not loaded: {e}")
    return None


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
    # Ensure session is usable after long waits
    try:
        await session.rollback()
    except Exception:
        pass
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
        cms_url = getattr(settings, 'CMS_URL', None) or os.getenv('CMS_URL') or ""
        if not cms_url:
            return
        token = getattr(settings, 'ENGINE_MONITOR_TOKEN', None) or os.getenv('ENGINE_MONITOR_TOKEN')
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.post(
                f"{cms_url.rstrip('/')}/api/engine/logs",
                json={
                    "jobId": str(run_id),
                    "log": log_data,
                },
                timeout=aiohttp.ClientTimeout(total=10)
            ) as _:
                pass
    except Exception:
        # Fail silently if CMS is unavailable
        pass

def _generate_r2_key(url: str, external_id: str) -> str:
    """Generate organized R2 key for blocks based on source type and URL.
    Blocks must be stored under:
      - user:    {username}/blocks/{external_id}
      - home:    home/blocks/{external_id}
      - pop:     pop/blocks/{external_id}
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
        return f"unknown/blocks/{external_id}"
    return f"misc/blocks/{external_id}"

async def _create_or_update_savee_user(session: AsyncSession, username: str, url: str) -> int:
    """Create or update SaveeUser profile with scraped data"""
    from sqlalchemy import select, text
    from datetime import datetime, timezone
    import re
    
    # Ensure schema column exists BEFORE any ORM SELECT to avoid UndefinedColumnError
    try:
        await session.execute(text("ALTER TABLE savee_users ADD COLUMN IF NOT EXISTS avatar_r2_key VARCHAR(500)"))
    except Exception:
        pass

    # Check if user already exists (retry once on failure and rollback aborted tx)
    try:
        result = await session.execute(
            select(SaveeUser).where(SaveeUser.username == username)
        )
        existing_user = result.scalar_one_or_none()
    except Exception:
        try:
            await session.rollback()
        except Exception:
            pass
        try:
            await session.execute(text("ALTER TABLE savee_users ADD COLUMN IF NOT EXISTS avatar_r2_key VARCHAR(500)"))
        except Exception:
            pass
        result = await session.execute(
            select(SaveeUser).where(SaveeUser.username == username)
        )
        existing_user = result.scalar_one_or_none()
    
    # Scrape user profile data
    try:
        # Attach auth cookie if available to ensure we can fetch avatar for private or cached content
        auth_token = _load_savee_auth_token()
        headers = {}
        cookies = {}
        if auth_token:
            cookies = {"auth_token": auth_token}
        async with aiohttp.ClientSession(cookies=cookies, headers=headers) as scrape_session:
            async with scrape_session.get(url) as response:
                if response.status == 200:
                    html_content = await response.text()
                    
                    # Extract profile data from HTML
                    profile_data = _extract_user_profile_data(html_content, username, url)

                    # Ensure avatar_r2_key column exists (idempotent)
                    try:
                        await session.execute(text("ALTER TABLE savee_users ADD COLUMN IF NOT EXISTS avatar_r2_key VARCHAR(500)"))
                    except Exception:
                        pass
                    # Attempt avatar upload to R2 when image available
                    try:
                        avatar_url = profile_data.get('profile_image_url')
                        if avatar_url:
                            from app.storage.r2 import get_storage
                            storage = await get_storage()
                            avatar_key = await storage.upload_avatar(username, avatar_url)
                            # Keep original url for preview; also store R2 key for CMS usage
                            profile_data['profile_image_url'] = avatar_url
                            profile_data['avatar_r2_key'] = avatar_key
                    except Exception as _avatar_err:
                        logger.debug(f"Avatar upload skipped for {username}: {_avatar_err}")
                    
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
        # Helper to parse counts like "12,187", "12 187", "12.1k", "1.2M"
        def parse_count_string(raw: str) -> Optional[int]:
            try:
                s = raw.strip().lower()
                # Normalize unicode spaces
                s = re.sub(r"[\u00A0\u202F]", " ", s)
                # Extract number with optional suffix
                m = re.match(r"([\d.,\s]+)\s*([km]?)", s)
                if not m:
                    digits = re.sub(r"[^\d]", "", s)
                    return int(digits) if digits else None
                num_str, suffix = m.groups()
                # Remove spaces and thousand separators, keep decimal point
                num_str = num_str.replace(" ", "").replace(",", "")
                val = float(num_str)
                if suffix == "k":
                    val *= 1000
                elif suffix == "m":
                    val *= 1000000
                return int(round(val))
            except Exception:
                return None
        # Try to extract display name from title or meta tags
        display_name_match = re.search(r'<title>([^<]+)', html_content, re.IGNORECASE)
        if display_name_match:
            title = display_name_match.group(1).strip()
            # Remove "- Savee" suffix if present
            if " - Savee" in title:
                profile_data['display_name'] = title.replace(" - Savee", "").strip()
        
        # Extract profile image URL - capture both custom and default avatars
        # Prefer 'dr.savee-cdn.com/avatars' first (custom avatars), then st.savee-cdn.com/img (defaults)
        avatar_dr = re.search(r'https?://dr\.savee-cdn\.com/avatars/[^"\']+', html_content, re.IGNORECASE)
        avatar_default = re.search(r'https?://st\.savee-cdn\.com/img/default-avatar-\d+\.jpg', html_content, re.IGNORECASE)
        avatar_cdn = re.search(r'https?://[^"\']*savee-cdn\.com/(?:img/)?avatars/[^"\']+', html_content, re.IGNORECASE)
        
        if avatar_dr:
            # Custom avatar from dr.savee-cdn.com/avatars
            profile_data['profile_image_url'] = avatar_dr.group(0)
        elif avatar_default:
            # Default avatar from st.savee-cdn.com/img/default-avatar-N.jpg
            profile_data['profile_image_url'] = avatar_default.group(0)
        elif avatar_cdn:
            # Fallback to any other savee-cdn avatar
            profile_data['profile_image_url'] = avatar_cdn.group(0)
        else:
            # No avatar found; leave unset for neutral placeholder
            pass

        # Prefer DOM counters in the header toolbar (title="2,133 Saves", etc.)
        # These appear accurate and should override JSON when present
        # Saves
        dom_saves = re.search(r'title=["\']([\d][\d,\.\s\u00A0\u202F]*)\s*Saves["\']', html_content, re.IGNORECASE)
        if dom_saves:
            parsed = parse_count_string(dom_saves.group(1))
            if parsed is not None:
                profile_data['saves_count'] = parsed
        # Boards -> collections_count
        dom_boards = re.search(r'title=["\']([\d][\d,\.\s\u00A0\u202F]*)\s*Boards["\']', html_content, re.IGNORECASE)
        if dom_boards:
            parsed = parse_count_string(dom_boards.group(1))
            if parsed is not None:
                profile_data['collections_count'] = parsed
        # Following
        dom_following = re.search(r'title=["\']([\d][\d,\.\s\u00A0\u202F]*)\s*Following["\']', html_content, re.IGNORECASE)
        if dom_following:
            parsed = parse_count_string(dom_following.group(1))
            if parsed is not None:
                profile_data['following_count'] = parsed
        # Followers
        dom_followers = re.search(r'title=["\']([\d][\d,\.\s\u00A0\u202F]*)\s*Followers["\']', html_content, re.IGNORECASE)
        if dom_followers:
            parsed = parse_count_string(dom_followers.group(1))
            if parsed is not None:
                profile_data['follower_count'] = parsed
        
        # Extract bio/description
        description_match = re.search(r'<meta property="og:description" content="([^"]+)"', html_content)
        if description_match:
            profile_data['bio'] = description_match.group(1)
        
        # Try to extract stats from JSON data in script tags
        json_data_match = re.search(r'window\.__INITIAL_STATE__\s*=\s*({.+?});', html_content, re.DOTALL)
        if json_data_match:
            try:
                initial_state = json.loads(json_data_match.group(1))

                def coerce_count(v):
                    if isinstance(v, (int, float)):
                        return int(v)
                    if isinstance(v, str):
                        parsed = parse_count_string(v)
                        return parsed if parsed is not None else None
                    return None

                # Navigate through likely structures to find stats
                user_nodes = []
                if isinstance(initial_state, dict):
                    if 'user' in initial_state and isinstance(initial_state['user'], dict):
                        user_nodes.append(initial_state['user'])
                    # Some apps embed under data or profile
                    for k in ('data', 'profile', 'currentUser', 'viewer'):
                        node = initial_state.get(k)
                        if isinstance(node, dict):
                            if 'user' in node and isinstance(node['user'], dict):
                                user_nodes.append(node['user'])
                            else:
                                user_nodes.append(node)

                def try_fill_counts(src: dict):
                    nonlocal profile_data
                    stats_candidates = [src]
                    for key in ('stats', 'statistics', 'profile', 'meta'):
                        if isinstance(src.get(key), dict):
                            stats_candidates.append(src[key])
                    for cand in stats_candidates:
                        if not isinstance(cand, dict):
                            continue
                        if 'followers_count' in cand and 'follower_count' not in profile_data:
                            v = coerce_count(cand.get('followers_count'))
                            if v is not None:
                                profile_data['follower_count'] = v
                        if 'following_count' in cand and 'following_count' not in profile_data:
                            v = coerce_count(cand.get('following_count'))
                            if v is not None:
                                profile_data['following_count'] = v
                        for saves_key in ('saves_count', 'savesCount', 'saves', 'totalSaves', 'num_saves'):
                            if saves_key in cand and 'saves_count' not in profile_data:
                                v = coerce_count(cand.get(saves_key))
                                if v is not None:
                                    profile_data['saves_count'] = v
                                    break
                        for coll_key in ('collections_count', 'collectionsCount', 'collections', 'totalCollections'):
                            if coll_key in cand and 'collections_count' not in profile_data:
                                v = coerce_count(cand.get(coll_key))
                                if v is not None:
                                    profile_data['collections_count'] = v
                                    break

                for node in user_nodes:
                    try_fill_counts(node)

            except (json.JSONDecodeError, KeyError) as e:
                print(f"Could not parse user JSON data: {e}")
        
        # Try to extract stats from HTML elements (fallback)
        if 'follower_count' not in profile_data:
            # Look for follower count patterns in HTML (with separators/suffix)
            followers_match = re.search(r'([\d][\d,\.\s\u00A0\u202F]*)\s*(?:followers?)', html_content, re.IGNORECASE)
            if followers_match:
                parsed = parse_count_string(followers_match.group(1))
                if parsed is not None:
                    profile_data['follower_count'] = parsed
        
        if 'following_count' not in profile_data:
            # Look for following count patterns in HTML
            following_match = re.search(r'([\d][\d,\.\s\u00A0\u202F]*)\s*(?:following)', html_content, re.IGNORECASE)
            if following_match:
                parsed = parse_count_string(following_match.group(1))
                if parsed is not None:
                    profile_data['following_count'] = parsed
        
        if 'saves_count' not in profile_data:
            # Look for saves count in inline JSON first: "saves_count": "12,187" or numbers
            inline_json_match = re.search(r'"saves[_-]?count"\s*:\s*"?([\d\.,\s\u00A0\u202F]+)"?', html_content, re.IGNORECASE)
            if inline_json_match:
                parsed = parse_count_string(inline_json_match.group(1))
                if parsed is not None:
                    profile_data['saves_count'] = parsed
            else:
                # Fallback to visible text pattern
                saves_match = re.search(r'([\d][\d,\.\s\u00A0\u202F]*)\s*(?:saves?)', html_content, re.IGNORECASE)
                if saves_match:
                    parsed = parse_count_string(saves_match.group(1))
                    if parsed is not None:
                        profile_data['saves_count'] = parsed

        if 'collections_count' not in profile_data:
            collections_match = re.search(r'([\d][\d,\.\s\u00A0\u202F]*)\s*(?:collections?)', html_content, re.IGNORECASE)
            if collections_match:
                parsed = parse_count_string(collections_match.group(1))
                if parsed is not None:
                    profile_data['collections_count'] = parsed
        
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
) -> int:
    """Upsert a block with enhanced metadata from the scraper."""
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
            return int(existing_block_id)

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
                return int(fuzzy_id)
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
    
    # Create the upsert statement with comprehensive metadata
    # Compute origin_text string deterministically from URL or username
    try:
        page_like_url = getattr(item, 'page_url', '') or getattr(item, 'og_url', '') or ''
        src_type_enum = _detect_source_type(page_like_url)
        username_guess = getattr(item, 'username', None) or _extract_username(page_like_url or '')
        origin_text_value = (username_guess if src_type_enum == SourceTypeEnum.user else src_type_enum.value)
    except Exception:
        origin_text_value = None

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
        # Persisted origin and saved-by fields for CMS filters
        origin_text=origin_text_value,
        saved_by_usernames=','.join([u for u in getattr(item, 'saved_by', []) if isinstance(u, str)]) if isinstance(getattr(item, 'saved_by', None), list) else None,
    )
    
    # On conflict, update fields 
    stmt = stmt.on_conflict_do_update(
        index_elements=['external_id'],
        set_={
            'title': stmt.excluded.title,
            'description': stmt.excluded.description,
            'status': stmt.excluded.status,
            'r2_key': stmt.excluded.r2_key,
            'og_title': stmt.excluded.og_title,
            'og_description': stmt.excluded.og_description,
            'og_image_url': stmt.excluded.og_image_url,
            'og_url': stmt.excluded.og_url,
            'source_api_url': stmt.excluded.source_api_url,
            'saved_at': stmt.excluded.saved_at,
            'color_hexes': stmt.excluded.color_hexes,
            'ai_tags': stmt.excluded.ai_tags,
            'colors': stmt.excluded.colors,
            'links': stmt.excluded.links,
            'metadata': stmt.excluded.metadata,
            'updated_at': func.now(),
            'origin_text': stmt.excluded.origin_text,
            'saved_by_usernames': stmt.excluded.saved_by_usernames,
        }
    )
    
    result = await session.execute(stmt)
    
    # Get the block ID (either newly inserted or updated)
    block_result = await session.execute(
        select(Block.id).where(Block.external_id == item.external_id)
    )
    block_id = block_result.scalar_one()
    
    return block_id


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
    
    engine = create_async_engine(settings.async_database_url, connect_args=settings.asyncpg_connect_args)
    Session = async_sessionmaker(engine)
    
    async with Session() as session:
        try:
            # Ensure new filterable columns exist on blocks table for workers that
            # may run before the CMS onInit hook executes (serverless cold starts)
            try:
                from sqlalchemy import text as _sql_text
                await session.execute(_sql_text("ALTER TABLE blocks ADD COLUMN IF NOT EXISTS origin_text TEXT"))
                await session.execute(_sql_text("ALTER TABLE blocks ADD COLUMN IF NOT EXISTS saved_by_usernames TEXT"))
                await session.commit()
            except Exception as _ensure_cols_err:
                # Non-fatal: if another process is altering simultaneously or the
                # table already has the columns, continue gracefully
                logger.debug(f"Ensure blocks columns exist: {_ensure_cols_err}")

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
            
            # Configure early-exit policy for monitor sweeps
            stop_on_first_old: bool = False
            min_new_before_break: int = 1
            try:
                # Determine run kind if available (scheduled/backfill/manual)
                run_kind = run_obj.kind if 'run_obj' in locals() and run_obj is not None else RunKindEnum.manual
            except Exception:
                run_kind = RunKindEnum.manual
            # Enable stop-on-first-old for scheduled (monitor) runs by default
            try:
                env_flag = os.getenv('STOP_ON_FIRST_OLD', 'true').strip().lower()
                stop_on_first_old = (run_kind == RunKindEnum.scheduled) and env_flag in ('1','true','yes')
                min_new_before_break = int(os.getenv('MIN_NEW_BEFORE_BREAK', '1'))
            except Exception:
                pass

            async with storage:
                processed_count = 0
                skipped_count = 0
                # Early-exit when only-old items encountered consecutively
                consecutive_old_items = 0
                try:
                    # Stop quickly when seeing only old items; lower default so we don't re-scan full feed
                    only_old_exit_streak = int(os.getenv('ONLY_OLD_EXIT_STREAK', '8'))
                    # Probe at least this many items per sweep before declaring "only old"
                    probe_min_items = int(os.getenv('PROBE_MIN_ITEMS', '48'))
                except Exception:
                    only_old_exit_streak = 8
                    probe_min_items = 48
                # Track unique external IDs seen in this run session to avoid counting duplicates from listing glitches
                seen_in_session: set[str] = set()
                async for item in item_iterator:
                    processed_count += 1
                    
                    # Avoid double counting the same item within this session
                    try:
                        if getattr(item, 'external_id', None) in seen_in_session:
                            continue
                        if getattr(item, 'external_id', None):
                            seen_in_session.add(item.external_id)
                    except Exception:
                        pass

                    # Skip if already processed in this run (for resume functionality)
                    if await _item_already_processed(session, run_id, item.external_id):
                        skipped_count += 1
                        counters['skipped'] = skipped_count
                        # Keep 'found' aligned with processed_count in real-time
                        counters['found'] = processed_count
                        print(f"[SKIP] {item.external_id} - Already processed in this run (#{skipped_count} skipped)")
                        # Persist skip counters
                        await update_run_status(session, run_id, RunStatusEnum.running, counters)
                        await session.commit()
                        continue

                    # Skip if already exists globally (across previous runs)
                    if await _item_exists_globally(session, item.external_id):
                        skipped_count += 1
                        counters['skipped'] = skipped_count
                        # Keep 'found' aligned with processed_count in real-time
                        counters['found'] = processed_count
                        print(f"[SKIP] {item.external_id} - Already exists in DB (#{skipped_count} skipped)")
                        # Persist skip counters
                        await update_run_status(session, run_id, RunStatusEnum.running, counters)
                        await session.commit()
                        consecutive_old_items += 1
                        # For scheduled monitor sweeps: stop as soon as we encounter the first old
                        # after having seen at least N new items this run (default 1)
                        try:
                            if (
                                stop_on_first_old
                                and counters.get('uploaded', 0) >= min_new_before_break
                                and processed_count >= probe_min_items
                            ):
                                print(
                                    f"[EARLY-EXIT] First old item after {counters.get('uploaded',0)} new; scanned {processed_count} items ≥ probe; stopping sweep."
                                )
                                break
                        except Exception:
                            pass
                        if (
                            consecutive_old_items >= only_old_exit_streak
                            and processed_count >= probe_min_items
                        ):
                            print(
                                f"[EARLY-EXIT] Detected {consecutive_old_items} consecutive old items and scanned {processed_count} items ≥ probe; stopping sweep."
                            )
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
                                # Try to pass a poster candidate so CMS can preview from R2
                                poster_candidate = getattr(item, 'thumbnail_url', None) or getattr(item, 'og_image_url', None) or getattr(item, 'image_url', None)
                                r2_key = await storage.upload_video(item.media_url, base_key, poster_candidate)
                        
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
                        
                        block_id = await _upsert_block(session, source_id, run_id, item, r2_key)
                        
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
                        
                        # If upsert returned an existing block id (dedup), treat as skipped instead of uploaded
                        try:
                            # For now, detect dedup by querying if the block already existed for a different run
                            # A safer approach is to have _upsert_block return an is_new flag
                            same_run = await session.execute(
                                select(func.count(Block.id)).where((Block.id == block_id) & (Block.run_id == run_id))
                            )
                            is_current_run = int(same_run.scalar() or 0) > 0
                        except Exception:
                            is_current_run = True

                        if is_current_run:
                            counters['uploaded'] = counters.get('uploaded', 0) + 1
                        else:
                            skipped_count += 1
                            counters['skipped'] = skipped_count

                        # Keep 'found' aligned with processed_count in real-time
                        counters['found'] = processed_count

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
            
            # Reconcile counters deterministically just before completion
            try:
                db_uploaded_result = await session.execute(
                    select(func.count(Block.id)).where(Block.run_id == run_id)
                )
                db_uploaded = int(db_uploaded_result.scalar() or 0)
                counters['uploaded'] = db_uploaded
                # processed (found) = exact iterator count
                counters['found'] = processed_count
                # skipped = processed - uploaded
                counters['skipped'] = max(0, processed_count - db_uploaded)
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