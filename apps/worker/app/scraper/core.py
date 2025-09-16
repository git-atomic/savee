"""
Core scraping functionality for Savee.com
"""
import asyncio
import json
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urljoin, urlparse

import aiohttp
from playwright.async_api import async_playwright, Browser, Page
from pydantic import BaseModel, Field

from ..logging_config import setup_logging
from ..config import settings

logger = setup_logging(__name__)


class ScrapedItem(BaseModel):
    """Scraped item data structure with comprehensive metadata"""
    external_id: str
    title: Optional[str] = None
    description: Optional[str] = None
    media_type: str  # 'image' or 'video'
    media_url: str
    thumbnail_url: Optional[str] = None
    source_url: str
    author: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    width: Optional[int] = None
    height: Optional[int] = None
    file_size: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    # Comprehensive metadata fields (matching savee_scraper.py format)
    page_url: Optional[str] = None
    og_title: Optional[str] = None
    og_description: Optional[str] = None
    og_image_url: Optional[str] = None
    og_url: Optional[str] = None
    saved_at: Optional[str] = None
    image_url: Optional[str] = None
    video_url: Optional[str] = None
    video_poster_url: Optional[str] = None
    source_api_url: Optional[str] = None
    source_original_url: Optional[str] = None
    
    # Rich sidebar metadata
    sidebar_info: Optional[Dict] = Field(default_factory=dict)
    color_hexes: List[str] = Field(default_factory=list)
    ai_tags: List[str] = Field(default_factory=list)
    colors: List[str] = Field(default_factory=list)
    links: List[Dict] = Field(default_factory=list)


class SaveeSession:
    """Manages Savee.com session with cookies and authentication"""
    
    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
        self.browser: Optional[Browser] = None
        self.context = None
        self.page: Optional[Page] = None
        # Prefer runtime-provided cookies
        self.cookies = {}
        
    async def __aenter__(self):
        await self.start()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
        
    async def start(self):
        """Initialize session with browser and HTTP client"""
        # Start Playwright browser
        self.playwright = await async_playwright().start()
        launch_args = [
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
        ]
        if sys.platform != 'win32':
            launch_args.extend(['--no-sandbox', '--disable-setuid-sandbox'])

        self.browser = await self.playwright.chromium.launch(
            headless=True,
            args=launch_args,
        )

        # Create context (set UA here) and add cookies before opening a page
        self.context = await self.browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        )
        
        # Load cookies from env (COOKIES_JSON or COOKIES_PATH) if available
        cookies_loaded = False
        if settings.COOKIES_JSON:
            try:
                data = json.loads(settings.COOKIES_JSON)
                # Accept both Chrome-exported list and simple name/value mapping
                if isinstance(data, list):
                    for c in data:
                        if 'name' in c and 'value' in c:
                            domain = c.get('domain', '.savee.com')
                            if domain.startswith('.'):  # playwright expects domain without leading dot
                                domain = domain[1:]
                            await self.context.add_cookies([{
                                'name': c['name'],
                                'value': c['value'],
                                'domain': domain,
                                'path': c.get('path', '/'),
                                'httpOnly': c.get('httpOnly', False),
                                'secure': c.get('secure', True),
                            }])
                    cookies_loaded = True
                elif isinstance(data, dict):
                    for name, value in data.items():
                        await self.context.add_cookies([{
                            'name': name,
                            'value': value,
                            'domain': 'savee.com',
                            'path': '/',
                            'secure': True,
                        }])
                    cookies_loaded = True
            except Exception:
                pass

        if not cookies_loaded and settings.COOKIES_PATH:
            try:
                with open(settings.COOKIES_PATH, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if isinstance(data, list):
                    for c in data:
                        if 'name' in c and 'value' in c:
                            domain = c.get('domain', '.savee.com')
                            if domain.startswith('.'):  # playwright expects domain without leading dot
                                domain = domain[1:]
                            await self.context.add_cookies([{
                                'name': c['name'],
                                'value': c['value'],
                                'domain': domain,
                                'path': c.get('path', '/'),
                                'httpOnly': c.get('httpOnly', False),
                                'secure': c.get('secure', True),
                            }])
                    cookies_loaded = True
                elif isinstance(data, dict):
                    for name, value in data.items():
                        await self.context.add_cookies([{
                            'name': name,
                            'value': value,
                            'domain': 'savee.com',
                            'path': '/',
                            'secure': True,
                        }])
                    cookies_loaded = True
            except Exception:
                pass

        # Final fallback: repo default cookies file
        if not cookies_loaded:
            try:
                import os
                from pathlib import Path as _Path
                default_cookie_file = _Path(__file__).resolve().parents[2] / 'savee_cookies.json'
                if default_cookie_file.exists():
                    data = json.loads(default_cookie_file.read_text(encoding='utf-8'))
                    if isinstance(data, list):
                        for c in data:
                            if 'name' in c and 'value' in c:
                                domain = c.get('domain', '.savee.com')
                                if domain.startswith('.'):  # playwright expects domain without leading dot
                                    domain = domain[1:]
                                await self.context.add_cookies([{
                                    'name': c['name'],
                                    'value': c['value'],
                                    'domain': domain,
                                    'path': c.get('path', '/'),
                                    'httpOnly': c.get('httpOnly', False),
                                    'secure': c.get('secure', True),
                                }])
                        cookies_loaded = True
            except Exception:
                pass

        # Fallback to any hardcoded cookies (discouraged)
        if self.cookies:
            for name, value in self.cookies.items():
                await self.context.add_cookies([{
                    'name': name,
                    'value': value,
                    'domain': 'savee.com',
                    'path': '/',
                }])

        # Create page after cookies have been added to the context
        self.page = await self.context.new_page()
            
        # Create HTTP session
        self.session = aiohttp.ClientSession(
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'keep-alive',
            },
            cookies=self.cookies
        )
        
        logger.info("Savee session initialized")
        
    async def close(self):
        """Clean up resources"""
        if self.session:
            await self.session.close()
        if self.page:
            await self.page.close()
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.close()
        if hasattr(self, 'playwright'):
            await self.playwright.stop()
            
        logger.info("Savee session closed")

