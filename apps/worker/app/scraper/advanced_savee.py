"""
Advanced Savee scraper with full metadata extraction
Integrated from savee_scraper.py with production improvements
"""
import asyncio
import json
import os
import re
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Set, Tuple, Dict, Any
from urllib.parse import urlsplit
import aiohttp
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig


@dataclass
class ScrapedBlock:
    """Enhanced block data structure with all metadata"""
    external_id: str
    url: str
    title: Optional[str] = None
    description: Optional[str] = None
    media_type: Optional[str] = None  # 'image', 'video', 'gif'
    image_url: Optional[str] = None
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    original_source_url: Optional[str] = None
    source_api_url: Optional[str] = None
    
    # Enhanced metadata
    tags: List[str] = None
    ai_tags: List[Dict[str, Any]] = None  # [{"tag": "nature", "confidence": 0.95}]
    color_palette: List[Dict[str, Any]] = None  # [{"hex": "#ff0000", "percentage": 25}]
    sidebar_info: Dict[str, Any] = None
    
    # Processing metadata
    scraped_at: str = None
    error_message: Optional[str] = None
    
    def __post_init__(self):
        if not self.scraped_at:
            self.scraped_at = datetime.now(timezone.utc).isoformat()
        if self.tags is None:
            self.tags = []
        if self.ai_tags is None:
            self.ai_tags = []
        if self.color_palette is None:
            self.color_palette = []


class AdvancedSaveeScraper:
    """Production-ready Savee scraper with full metadata extraction"""
    
    def __init__(self, headless: bool = True, page_timeout: int = 60000):
        self.headless = headless
        self.page_timeout = page_timeout
        self.browser_config = BrowserConfig(
            headless=headless,
            verbose=False,
        )
    
    async def __aenter__(self):
        self.crawler = AsyncWebCrawler(config=self.browser_config)
        await self.crawler.__aenter__()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if hasattr(self, 'crawler'):
            await self.crawler.__aexit__(exc_type, exc_val, exc_tb)
    
    def _build_scrolling_js(self, steps: int = 5, wait_ms: int = 800, idle_rounds: int = 3) -> str:
        """JavaScript to scroll and collect item links"""
        return f'''
(function() {{
  let maxLoops = {steps};
  let wait = {wait_ms};
  let idleRounds = {idle_rounds};
  let loops = 0;
  let prevCount = 0;
  let stagnantRounds = 0;
  
  function collect() {{
    try {{
      const anchors = Array.from(document.querySelectorAll('a'))
        .map(a => a.href)
        .filter(href => typeof href === 'string' && href.includes('/i/'));
      const ids = Array.from(document.querySelectorAll('[id]'))
        .map(el => el.id)
        .filter(id => typeof id === 'string' && id.startsWith('grid-item-'))
        .map(id => id.replace('grid-item-',''));
      document.documentElement.setAttribute('data-savee-anchors', 
        encodeURIComponent(JSON.stringify(anchors)));
      document.documentElement.setAttribute('data-savee-ids', 
        encodeURIComponent(JSON.stringify(ids)));
    }} catch (e) {{}}
  }}
  
  function step() {{
    window.scrollTo(0, document.body.scrollHeight);
    loops++;
    const count = document.querySelectorAll('[id^=grid-item-]').length;
    if (count <= prevCount) stagnantRounds++; else stagnantRounds = 0;
    prevCount = count;
    
    const reachedMax = (maxLoops > 0 && loops >= maxLoops);
    const reachedIdle = (stagnantRounds >= idleRounds);
    if (reachedMax || reachedIdle) {{
      collect(); 
      window.__savee_scrolled = true; 
      return;
    }}
    setTimeout(step, wait);
  }}
  step();
}})();
'''
    
    def _build_item_collect_js(self) -> str:
        """JavaScript to extract comprehensive item metadata"""
        return '''
(function() {
  async function openInfoAndWait(maxTries = 10, stepMs = 300) {
    return new Promise(resolve => {
      let tries = 0;
      function attempt() {
        const panel = document.querySelector('#infoSideBar');
        if (panel) return resolve(true);
        
        // Try various selectors for info button
        const selectors = [
          'button[title*="Info" i]',
          'button:has(> span > span.hidden:text("Info"))',
          'button:has(svg)'
        ];
        
        let btn = null;
        for (const sel of selectors) {
          try {
            const el = document.querySelector(sel);
            if (el && (el.getAttribute('title')||'').toLowerCase().includes('info')) {
              btn = el;
              break;
            }
          } catch(e) {}
        }
        
        if (btn) {
          try { btn.click(); } catch(e) {}
        }
        
        tries += 1;
        if (tries >= maxTries) return resolve(false);
        setTimeout(attempt, stepMs);
      }
      attempt();
    });
  }

  async function collect() {
    try {
      // Extract main media
      const container = document.querySelector('[data-testid="image-container"]');
      const imgEl = container ? container.querySelector('[data-testid="image-original"]') : null;
      const videoEl = container ? (container.querySelector('video[slot="media"]') || container.querySelector('video')) : null;
      
      const imageOriginalSrc = imgEl ? (imgEl.src || imgEl.getAttribute('src') || imgEl.getAttribute('data-src')) : null;
      const videoSrc = videoEl ? (videoEl.src || videoEl.getAttribute('src')) : null;
      const videoPosterSrc = videoEl ? (videoEl.poster || videoEl.getAttribute('poster')) : null;

      // Open sidebar and extract metadata
      await openInfoAndWait(15, 400);
      const sidebarRoot = document.querySelector('#infoSideBar .space-y-8.px-6') || document.querySelector('#infoSideBar');
      
      const info = {};
      let sourceApiUrl = null;
      let colorHexes = [];
      let aiTags = [];
      let sidebarTitle = null;
      let tags = [];
      let originalSourceUrl = null;

      if (sidebarRoot) {
        // Extract title
        const titleCand = sidebarRoot.querySelector('.text-overflow, .text-lg, h1, h2');
        sidebarTitle = titleCand ? (titleCand.textContent||'').trim() : null;

        // Extract all links and categorize them
        const allAnchors = Array.from(sidebarRoot.querySelectorAll('a'));
        const links = allAnchors.map(a => ({ 
          href: a.href, 
          text: (a.textContent||'').trim(), 
          title: (a.title||'') 
        }));
        
        // Extract regular tags (hashtags)
        tags = allAnchors
          .map(a => (a.textContent||'').trim())
          .filter(t => t.startsWith('#'));
        
        // Extract AI tags (search links that aren't color hashtags)
        aiTags = allAnchors
          .filter(a => (a.getAttribute('href')||'').includes('/search/?q='))
          .map(a => (a.textContent||'').trim())
          .filter(t => t && !t.startsWith('#'));
        
        // Extract color palette
        const colorAnchors = allAnchors.filter(a => (a.title||'').startsWith('Search by #'));
        colorHexes = Array.from(new Set(
          colorAnchors
            .map(a => (a.title||'').replace('Search by ', '').trim())
            .filter(t => /^#[0-9A-Fa-f]{3,8}$/.test(t))
        ));
        
        // Find source API URL
        const srcLink = allAnchors.find(a => /\\/api\\/items\\/[^/]+\\/source\\/?$/i.test(a.href));
        sourceApiUrl = srcLink ? srcLink.href : null;
        
        // Extract additional metadata
        const texts = Array.from(sidebarRoot.querySelectorAll('p,li,div'))
          .map(n => (n.textContent||'').trim())
          .filter(Boolean)
          .slice(0, 50); // Limit to prevent bloat
        
        info.links = links;
        info.texts = texts;
        info.tags = Array.from(new Set(tags));
        info.aiTags = Array.from(new Set(aiTags));
        info.colorHexes = Array.from(new Set(colorHexes));
        info.sidebarTitle = sidebarTitle;
      }

      // Try to resolve original source URL if API available
      if (sourceApiUrl) {
        try {
          const response = await fetch(sourceApiUrl);
          if (response.ok) {
            originalSourceUrl = response.url;
          }
        } catch(e) {}
      }

      const result = {
        imageOriginalSrc,
        videoSrc,
        videoPosterSrc,
        sourceApiUrl,
        originalSourceUrl,
        info,
        metadata: {
          title: sidebarTitle,
          tags: Array.from(new Set(tags)),
          aiTags: Array.from(new Set(aiTags)),
          colorHexes: Array.from(new Set(colorHexes))
        }
      };

      document.documentElement.setAttribute('data-savee-item', 
        encodeURIComponent(JSON.stringify(result)));
    } catch (e) {
      document.documentElement.setAttribute('data-savee-item', 
        encodeURIComponent(JSON.stringify({ 
          error: e.message,
          imageOriginalSrc: null, 
          videoSrc: null, 
          videoPosterSrc: null 
        })));
    }
  }

  setTimeout(() => { collect(); }, 500);
})();
'''
    
    def _extract_item_id_from_url(self, url: str) -> Optional[str]:
        """Extract item ID from URL"""
        m = re.search(r"/i/([A-Za-z0-9_-]+)/?", url)
        if not m:
            return None
        item_id = m.group(1)
        return item_id if self._is_valid_item_id(item_id) else None
    
    def _is_valid_item_id(self, item_id: str) -> bool:
        """Validate item ID format"""
        if not isinstance(item_id, str):
            return False
        if item_id in {"undefined", "null", "None", ""}:
            return False
        return re.fullmatch(r"[A-Za-z0-9_-]{5,24}", item_id) is not None
    
    def _parse_data_attribute(self, html: str, attr_name: str) -> Optional[Any]:
        """Parse JSON data from HTML attribute"""
        pattern = f"{attr_name}=['\"]([^'\"]+)['\"]"
        m = re.search(pattern, html)
        if not m:
            return None
        try:
            from urllib.parse import unquote
            json_text = unquote(m.group(1))
            return json.loads(json_text)
        except Exception:
            return None
    
    def _find_item_links_in_html(self, html: str, base_url: str) -> List[str]:
        """Extract all item links from listing page HTML"""
        seen_ids: Set[str] = set()
        ordered_ids: List[str] = []

        # 1) IDs from JS attribute (DOM order)
        ids_data = self._parse_data_attribute(html, "data-savee-ids")
        if ids_data and isinstance(ids_data, list):
            for item_id in ids_data:
                if self._is_valid_item_id(item_id) and item_id not in seen_ids:
                    seen_ids.add(item_id)
                    ordered_ids.append(item_id)

        # 2) Anchors from JS attribute
        anchors_data = self._parse_data_attribute(html, "data-savee-anchors")
        if anchors_data and isinstance(anchors_data, list):
            for href in anchors_data:
                maybe = self._extract_item_id_from_url(href)
                if maybe and maybe not in seen_ids:
                    seen_ids.add(maybe)
                    ordered_ids.append(maybe)

        # 3) DOM id="grid-item-<ID>" patterns
        for m in re.finditer(r"id=['\"]grid-item-([A-Za-z0-9_-]+)['\"]", html):
            item_id = m.group(1)
            if self._is_valid_item_id(item_id) and item_id not in seen_ids:
                seen_ids.add(item_id)
                ordered_ids.append(item_id)

        # 4) Href patterns
        for m in re.finditer(r"href=\"(/i/[A-Za-z0-9_-]+[^\"]*)\"|href='(/i/[A-Za-z0-9_-]+[^']*)'", html):
            rel = m.group(1) or m.group(2)
            maybe = self._extract_item_id_from_url(rel)
            if maybe and maybe not in seen_ids:
                seen_ids.add(maybe)
                ordered_ids.append(maybe)

        # Build final URLs
        return [f"{base_url}/i/{item_id}" for item_id in ordered_ids]
    
    def _extract_meta_from_html(self, html: str) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
        """Extract OpenGraph metadata from HTML"""
        def find_meta_value(key_name: str) -> Optional[str]:
            for m in re.finditer(r"<meta[^>]+>", html, flags=re.IGNORECASE):
                tag = m.group(0)
                key_match = re.search(r"(?:property|name)=['\"]([^'\"]+)['\"]", tag, flags=re.IGNORECASE)
                if not key_match:
                    continue
                if key_match.group(1).strip().lower() != key_name.lower():
                    continue
                content_match = re.search(r"content=['\"]([^'\"]+)['\"]", tag, flags=re.IGNORECASE)
                if content_match:
                    return content_match.group(1)
            return None

        title = find_meta_value("og:title")
        description = find_meta_value("og:description")
        image_url = (
            find_meta_value("og:image")
            or find_meta_value("og:image:secure_url")
            or find_meta_value("twitter:image")
        )
        og_url = find_meta_value("og:url")
        return title, description, image_url, og_url

    async def discover_items(self, source_url: str, max_items: int = 50) -> List[str]:
        """Discover item URLs from a source page"""
        try:
            cfg = CrawlerRunConfig(
                js_code=self._build_scrolling_js(),
                wait_for=(
                    "js:() => window.__savee_scrolled === true "
                    "|| document.querySelector('[id^=grid-item-]') != null "
                    "|| Array.from(document.querySelectorAll('a')).some(a => (a.href||'').includes('/i/'))"
                ),
                page_timeout=self.page_timeout,
            )
            
            result = await self.crawler.arun(url=source_url, config=cfg)
            if not getattr(result, "success", False):
                raise Exception(f"Failed to fetch listing: {getattr(result, 'error_message', 'unknown error')}")
            
            html = getattr(result, "html", "")
            sp = urlsplit(source_url)
            base_url = f"{sp.scheme}://{sp.netloc}"
            
            links = self._find_item_links_in_html(html, base_url)
            return links[:max_items] if max_items > 0 else links
            
        except Exception as e:
            raise Exception(f"Failed to discover items: {str(e)}")
    
    async def scrape_item(self, item_url: str) -> ScrapedBlock:
        """Scrape a single item with full metadata"""
        try:
            item_id = self._extract_item_id_from_url(item_url)
            if not item_id:
                raise Exception(f"Invalid item URL: {item_url}")
            
            # First try with collection JS, fallback to basic scraping
            cfg = CrawlerRunConfig(
                js_code=self._build_item_collect_js(),
                wait_for=(
                    "js:() => document.readyState === 'complete' && "
                    "(document.documentElement.getAttribute('data-savee-item') != null)"
                ),
                page_timeout=self.page_timeout,
            )
            
            result = await self.crawler.arun(url=item_url, config=cfg)
            if not getattr(result, "success", False):
                raise Exception(f"Failed to fetch item: {getattr(result, 'error_message', 'unknown error')}")
            
            html = getattr(result, "html", "")
            
            # Parse collected data
            item_data = self._parse_data_attribute(html, "data-savee-item") or {}
            
            # Extract OpenGraph metadata as fallback
            og_title, og_description, og_image_url, og_url = self._extract_meta_from_html(html)
            
            # Determine media type and URLs
            image_url = item_data.get('imageOriginalSrc') or og_image_url
            video_url = item_data.get('videoSrc')
            thumbnail_url = item_data.get('videoPosterSrc')
            
            media_type = 'video' if video_url else 'image'
            if not image_url and not video_url:
                media_type = 'unknown'
            
            # Extract enhanced metadata
            metadata = item_data.get('metadata', {})
            info = item_data.get('info', {})
            
            # Process tags and colors
            tags = metadata.get('tags', []) or info.get('tags', [])
            ai_tags_raw = metadata.get('aiTags', []) or info.get('aiTags', [])
            ai_tags = [{"tag": tag, "confidence": 0.8} for tag in ai_tags_raw]
            
            color_hexes = metadata.get('colorHexes', []) or info.get('colorHexes', [])
            color_palette = [{"hex": hex_code, "percentage": 100 // len(color_hexes) if color_hexes else 0} 
                           for hex_code in color_hexes]
            
            # Create block
            block = ScrapedBlock(
                external_id=item_id,
                url=item_url,
                title=metadata.get('title') or info.get('sidebarTitle') or og_title,
                description=og_description,
                media_type=media_type,
                image_url=image_url,
                video_url=video_url,
                thumbnail_url=thumbnail_url,
                original_source_url=item_data.get('originalSourceUrl'),
                source_api_url=item_data.get('sourceApiUrl'),
                tags=tags,
                ai_tags=ai_tags,
                color_palette=color_palette,
                sidebar_info=info
            )
            
            return block
            
        except Exception as e:
            # Return error block
            return ScrapedBlock(
                external_id=item_id or "unknown",
                url=item_url,
                error_message=str(e)
            )
