import asyncio
import json
import os
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Set, Tuple
from urllib.parse import urlsplit, unquote

import aiohttp
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig

from ..config import settings
from ..logging_config import setup_logging
from .core import ScrapedItem

logger = setup_logging(__name__)

# --- Auth/session helpers (adapted from savee_scraper.py) ---
def _normalize_cookie_entry(entry: dict) -> Optional[dict]:
    try:
        name = entry.get('name')
        value = entry.get('value')
        domain = entry.get('domain')
        path = entry.get('path', '/') or '/'
        if not (name and value and domain):
            return None
        # expirationDate (seconds, float) -> expires (int)
        expires = entry.get('expires')
        if not expires and 'expirationDate' in entry:
            try:
                expires = int(float(entry['expirationDate']))
            except Exception:
                expires = None
        same_site = entry.get('sameSite')
        if same_site:
            s = str(same_site).lower()
            if s in ('no_restriction', 'none'):
                same_site = 'None'
            elif s in ('lax', 'lax_mode'):
                same_site = 'Lax'
            elif s in ('strict',):
                same_site = 'Strict'
            else:
                same_site = None
        cookie = {
            'name': name,
            'value': value,
            'domain': domain,
            'path': path,
            'httpOnly': bool(entry.get('httpOnly', False)),
            'secure': bool(entry.get('secure', False)),
        }
        if expires:
            cookie['expires'] = expires
        if same_site:
            cookie['sameSite'] = same_site
        return cookie
    except Exception:
        return None


def _load_cookies_from_json_text(text: str) -> Optional[list]:
    try:
        data = json.loads(text)
        if isinstance(data, dict) and 'cookies' in data:
            raw = data['cookies']
        else:
            raw = data
        if not isinstance(raw, list):
            return None
        cookies = []
        for e in raw:
            if isinstance(e, dict):
                ne = _normalize_cookie_entry(e)
                if ne and (ne['domain'].endswith('savee.com')):
                    cookies.append(ne)
        return cookies or None
    except Exception:
        return None


def load_cookies_from_env() -> Optional[list]:
    # Prefer COOKIES_JSON, then COOKIES_PATH
    cj = settings.COOKIES_JSON
    if cj:
        c = _load_cookies_from_json_text(cj)
        if c:
            return c
    cp = settings.COOKIES_PATH
    if cp and os.path.exists(cp):
        try:
            return _load_cookies_from_json_text(Path(cp).read_text(encoding='utf-8'))
        except Exception:
            return None
    return None


def load_storage_state_from_env() -> Optional[object]:
    ss_path = settings.STORAGE_STATE_PATH
    if ss_path and os.path.exists(ss_path):
        return ss_path
    return None
# --- End auth/session helpers ---

# --- JS Injection Helpers (adapted from savee_scraper.py) ---
def build_scrolling_js(steps: int, wait_ms: int, until_idle: bool, idle_rounds: int) -> str:
    steps = max(0, int(steps))
    wait_ms = max(0, int(wait_ms))
    idle_rounds = max(1, int(idle_rounds))
    js = '''
(function() {
  let maxLoops = __STEPS__;
  let wait = __WAIT__;
  let untilIdle = __UNTIL_IDLE__;
  let idleRoundsTarget = __IDLE_ROUNDS__;
  let loops = 0;
  let prevCount = 0;
  let stagnantRounds = 0;
  function collect() {
    try {
      const anchors = Array.from(document.querySelectorAll('a'))
        .map(a => a.href)
        .filter(href => typeof href === 'string' && href.includes('/i/'));
      const ids = Array.from(document.querySelectorAll('[id]'))
        .map(el => el.id)
        .filter(id => typeof id === 'string' && id.startsWith('grid-item-'))
        .map(id => id.replace('grid-item-',''));
      document.documentElement.setAttribute('data-savee-anchors', encodeURIComponent(JSON.stringify(anchors)));
      document.documentElement.setAttribute('data-savee-ids', encodeURIComponent(JSON.stringify(ids)));
    } catch (e) {}
  }
  function step() {
    window.scrollTo(0, document.body.scrollHeight);
    loops++;
    const count = document.querySelectorAll('[id^=grid-item-]').length;
    if (count <= prevCount) stagnantRounds++; else stagnantRounds = 0;
    prevCount = count;
    const reachedMax = (maxLoops > 0 && loops >= maxLoops);
    const reachedIdle = (untilIdle && stagnantRounds >= idleRoundsTarget);
    if (reachedMax || reachedIdle) {
      collect(); window.__savee_scrolled = true; return;
    }
    setTimeout(step, wait);
  }
  step();
})();
'''
    return (js
            .replace('__STEPS__', str(steps))
            .replace('__WAIT__', str(wait_ms))
            .replace('__UNTIL_IDLE__', '1' if until_idle else '0')
            .replace('__IDLE_ROUNDS__', str(idle_rounds)))


def build_item_collect_js() -> str:
    return r'''
(function() {
  function getInfoButton() {
    const selectors = [
      'button[title^="Info" i]',
      'button[title*="Info" i]',
      'button:has(> span > span.hidden:text("Info"))',
      'button:has(svg)'
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && ((el.getAttribute('title')||'').toLowerCase().includes('info') || (el.innerText||'').toLowerCase().includes('info'))) return el;
      } catch(e) {}
    }
    // fallback: any button whose title contains Info
    const btns = Array.from(document.querySelectorAll('button'));
    const found = btns.find(b => ((b.getAttribute('title')||'').toLowerCase().includes('info') || (b.innerText||'').toLowerCase().includes('info')));
    return found || null;
  }

  function openInfoAndWait(maxTries = 8, stepMs = 250) {
    return new Promise(resolve => {
      let tries = 0;
      function attempt() {
        const panel = document.querySelector('#infoSideBar');
        if (panel) return resolve(true);
        const btn = getInfoButton();
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
      const container = document.querySelector('[data-testid="image-container"]');
      const imgEl = container ? container.querySelector('[data-testid="image-original"]') : null;
      const videoEl = container ? (container.querySelector('video[slot="media"]') || container.querySelector('video')) : null;
      const imageOriginalSrc = imgEl ? (imgEl.src || imgEl.getAttribute('src') || imgEl.getAttribute('data-src')) : null;
      const videoSrc = videoEl ? (videoEl.src || videoEl.getAttribute('src')) : null;
      const videoPosterSrc = videoEl ? (videoEl.poster || videoEl.getAttribute('poster')) : null;

      await openInfoAndWait(10, 300);
      const sidebarRoot = document.querySelector('#infoSideBar .space-y-8.px-6') || document.querySelector('#infoSideBar') || null;
      const info = {};
      let sourceApiUrl = null;
      let colorHexes = [];
      let aiTags = [];
      let sidebarTitle = null;

      if (sidebarRoot) {
        // title: try specific overflow/heading, else first large text
        const titleCand = sidebarRoot.querySelector('.text-overflow, .text-lg');
        sidebarTitle = titleCand ? (titleCand.textContent||'').trim() : null;

        const allAnchors = Array.from(sidebarRoot.querySelectorAll('a'));
        const links = allAnchors.map(a => ({ href: a.href, text: (a.textContent||'').trim(), title: (a.title||'') }));
        const texts = Array.from(sidebarRoot.querySelectorAll('p,li,div')).map(n => (n.textContent||'').trim()).filter(Boolean).slice(0, 800);
        const tags = allAnchors.map(a => (a.textContent||'').trim()).filter(t => t.startsWith('#'));
        // AI tags are anchors under /search/?q= that are not color hashtags
        aiTags = allAnchors
          .filter(a => (a.getAttribute('href')||'').includes('/search/?q='))
          .map(a => (a.textContent||'').trim())
          .filter(t => t && !t.startsWith('#'));
        const colorAnchors = allAnchors.filter(a => (a.title||'').startsWith('Search by #'));
        colorHexes = Array.from(new Set(colorAnchors.map(a => (a.title||'').replace('Search by ', '').trim()).filter(t => /^#[0-9A-Fa-f]{3,8}$/.test(t))));
        const colorEls = Array.from(sidebarRoot.querySelectorAll('[style*="background"]'));
        const colors = colorEls.map(el => { const s = el.getAttribute('style') || ''; const m = s.match(/background(?:-color)?:\s*([^;]+)/i); return m ? m[1].trim() : null; }).filter(Boolean);
        const srcLink = allAnchors.find(a => /\/api\/items\/[^/]+\/source\/?$/i.test(a.href));
        sourceApiUrl = srcLink ? srcLink.href : null;
        info.links = links; info.texts = texts; info.tags = Array.from(new Set(tags)); info.colors = Array.from(new Set(colors)); info.colorHexes = Array.from(new Set(colorHexes)); info.aiTags = Array.from(new Set(aiTags)); info.sidebarTitle = sidebarTitle;
      }

      document.documentElement.setAttribute('data-savee-item', encodeURIComponent(JSON.stringify({ imageOriginalSrc, videoSrc, videoPosterSrc, sourceApiUrl, info })));
    } catch (e) {
      document.documentElement.setAttribute('data-savee-item', encodeURIComponent(JSON.stringify({ imageOriginalSrc: null, videoSrc: null, videoPosterSrc: null, sourceApiUrl: null, info: {} })));
    }
  }

  setTimeout(() => { collect(); }, 400);
})();
'''


def build_item_collect_js() -> str:
    """
    Comprehensive item data collection JavaScript from savee_scraper.py
    This extracts colors, AI tags, source URLs, and detailed sidebar information
    """
    return r'''
(function() {
  function getInfoButton() {
    const selectors = [
      'button[title^="Info" i]',
      'button[title*="Info" i]',
      'button:has(> span > span.hidden:text("Info"))',
      'button:has(svg)'
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && ((el.getAttribute('title')||'').toLowerCase().includes('info') || (el.innerText||'').toLowerCase().includes('info'))) return el;
      } catch(e) {}
    }
    // fallback: any button whose title contains Info
    const btns = Array.from(document.querySelectorAll('button'));
    const found = btns.find(b => ((b.getAttribute('title')||'').toLowerCase().includes('info') || (b.innerText||'').toLowerCase().includes('info')));
    return found || null;
  }

  function openInfoAndWait(maxTries = 8, stepMs = 250) {
    return new Promise(resolve => {
      let tries = 0;
      function attempt() {
        const panel = document.querySelector('#infoSideBar');
        if (panel) return resolve(true);
        const btn = getInfoButton();
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
      const container = document.querySelector('[data-testid="image-container"]');
      const imgEl = container ? container.querySelector('[data-testid="image-original"]') : null;
      const videoEl = container ? (container.querySelector('video[slot="media"]') || container.querySelector('video')) : null;
      const imageOriginalSrc = imgEl ? (imgEl.src || imgEl.getAttribute('src') || imgEl.getAttribute('data-src')) : null;
      const videoSrc = videoEl ? (videoEl.src || videoEl.getAttribute('src')) : null;
      const videoPosterSrc = videoEl ? (videoEl.poster || videoEl.getAttribute('poster')) : null;

      await openInfoAndWait(10, 300);
      const sidebarRoot = document.querySelector('#infoSideBar .space-y-8.px-6') || document.querySelector('#infoSideBar') || null;
      const info = {};
      let sourceApiUrl = null;
      let colorHexes = [];
      let aiTags = [];
      let sidebarTitle = null;

      if (sidebarRoot) {
        // title: try specific overflow/heading, else first large text
        const titleCand = sidebarRoot.querySelector('.text-overflow, .text-lg');
        sidebarTitle = titleCand ? (titleCand.textContent||'').trim() : null;

        const allAnchors = Array.from(sidebarRoot.querySelectorAll('a'));
        const links = allAnchors.map(a => ({ href: a.href, text: (a.textContent||'').trim(), title: (a.title||'') }));
        const texts = Array.from(sidebarRoot.querySelectorAll('p,li,div')).map(n => (n.textContent||'').trim()).filter(Boolean).slice(0, 800);
        const tags = allAnchors.map(a => (a.textContent||'').trim()).filter(t => t.startsWith('#'));
        // AI tags are anchors under /search/?q= that are not color hashtags
        aiTags = allAnchors
          .filter(a => (a.getAttribute('href')||'').includes('/search/?q='))
          .map(a => (a.textContent||'').trim())
          .filter(t => t && !t.startsWith('#'));
        const colorAnchors = allAnchors.filter(a => (a.title||'').startsWith('Search by #'));
        colorHexes = Array.from(new Set(colorAnchors.map(a => (a.title||'').replace('Search by ', '').trim()).filter(t => /^#[0-9A-Fa-f]{3,8}$/.test(t))));
        const colorEls = Array.from(sidebarRoot.querySelectorAll('[style*="background"]'));
        const colors = colorEls.map(el => { const s = el.getAttribute('style') || ''; const m = s.match(/background(?:-color)?:\s*([^;]+)/i); return m ? m[1].trim() : null; }).filter(Boolean);
        const srcLink = allAnchors.find(a => /\/api\/items\/[^/]+\/source\/?$/i.test(a.href));
        sourceApiUrl = srcLink ? srcLink.href : null;
        info.links = links; info.texts = texts; info.tags = Array.from(new Set(tags)); info.colors = Array.from(new Set(colors)); info.colorHexes = Array.from(new Set(colorHexes)); info.aiTags = Array.from(new Set(aiTags)); info.sidebarTitle = sidebarTitle;
      }

      document.documentElement.setAttribute('data-savee-item', encodeURIComponent(JSON.stringify({ imageOriginalSrc, videoSrc, videoPosterSrc, sourceApiUrl, info })));
    } catch (e) {
      document.documentElement.setAttribute('data-savee-item', encodeURIComponent(JSON.stringify({ imageOriginalSrc: null, videoSrc: null, videoPosterSrc: null, sourceApiUrl: null, info: {} })));
    }
  }

  setTimeout(() => { collect(); }, 400);
})();
'''


def build_login_js(email: str, password: str) -> str:
    # Best-effort generic login filler
    js = (
        "(function()\n"
        "{\n"
        "  const EMAIL='" + email.replace("'", "\'") + "';\n"
        "  const PASSWORD='" + password.replace("'", "\'") + "';\n"
        "  function tryFill() {\n"
        "    try {\n"
        "      const emailSel = ['input[type=email]','input[name=email]','input#email'];\n"
        "      const passSel = ['input[type=password]','input[name=password]','input#password'];\n"
        "      let e=null,p=null;\n"
        "      for (const s of emailSel) { const n=document.querySelector(s); if(n){e=n; break;} }\n"
        "      for (const s of passSel) { const n=document.querySelector(s); if(n){p=n; break;} }\n"
        "      if (e) { e.focus(); e.value=EMAIL; e.dispatchEvent(new Event('input',{bubbles:true})); }\n"
        "      if (p) { p.focus(); p.value=PASSWORD; p.dispatchEvent(new Event('input',{bubbles:true})); }\n"
        "      const submit = document.querySelector('button[type=submit],button:not([disabled])');\n"
        "      if (submit) submit.click();\n"
        "      window.__savee_login_clicked = true;\n"
        "    } catch (err) { window.__savee_login_error = String(err); }\n"
        "  }\n"
        "  setTimeout(tryFill, 300);\n"
        "})();\n"
    )
    return js
# --- End JS Injection Helpers ---

# --- HTML Parsing Helpers (adapted from savee_scraper.py) ---
def _parse_links_from_data_attribute(html: str) -> Optional[List[str]]:
    m = re.search(r"data-savee-anchors=['\"]([^'\"]+)['\"]", html)
    if not m:
        return None
    try:
        json_text = unquote(m.group(1))
        data = json.loads(json_text)
        if isinstance(data, list):
            return [str(x) for x in data if isinstance(x, str)]
    except Exception:
        return None
    return None


def _parse_ids_from_data_attribute(html: str) -> Optional[List[str]]:
    m = re.search(r"data-savee-ids=['\"]([^'\"]+)['\"]", html)
    if not m:
        return None
    try:
        json_text = unquote(m.group(1))
        data = json.loads(json_text)
        if isinstance(data, list):
            ids = [str(x) for x in data if isinstance(x, str) and is_valid_item_id(str(x))]
            return ids
    except Exception:
        return None
    return None


def _parse_item_data_from_attr(html: str) -> Optional[dict]:
    m = re.search(r"data-savee-item=['\"]([^'\"]+)['\"]", html)
    if not m:
        return None
    try:
        json_text = unquote(m.group(1))
        data = json.loads(json_text)
        if isinstance(data, dict):
            return data
    except Exception:
        return None
    return None


def extract_meta_from_html(html: str) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
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
# --- End HTML Parsing Helpers ---


def is_valid_item_id(item_id: str) -> bool:
    if not isinstance(item_id, str):
        return False
    if item_id in {"undefined", "null", "None", ""}:
        return False
    return re.fullmatch(r"[A-Za-z0-9_-]{5,24}", item_id) is not None


def extract_item_id_from_url(url: str) -> Optional[str]:
    m = re.search(r"/i/([A-Za-z0-9_-]+)/?", url)
    if not m:
        return None
    item_id = m.group(1)
    return item_id if is_valid_item_id(item_id) else None


class SaveeScraper:
    """Production-ready Savee.com scraper using Crawl4AI"""
    
    def _is_valid_item_id(self, item_id: str) -> bool:
        return is_valid_item_id(item_id)

    def _extract_item_id_from_url(self, url: str) -> Optional[str]:
        return extract_item_id_from_url(url)

    async def _fetch_html(self, crawler: AsyncWebCrawler, url: str, page_timeout_ms: int = 45000) -> Optional[str]:
        cfg = CrawlerRunConfig(
            wait_for="js:() => document.readyState === 'complete'",
            page_timeout=page_timeout_ms,
        )
        result = await crawler.arun(url=url, config=cfg)
        if not getattr(result, "success", False):
            logger.warning(f"[item] failed {url}: {getattr(result, 'error_message', 'unknown error')}")
            return None
        return getattr(result, "html", None)

    async def _fetch_listing_html(self, crawler: AsyncWebCrawler, url: str, scroll_steps: int, scroll_wait_ms: int, until_idle: bool, idle_rounds: int, page_timeout_ms: int = 60000) -> Optional[str]:
        cfg = CrawlerRunConfig(
            js_code=build_scrolling_js(scroll_steps, scroll_wait_ms, until_idle, idle_rounds) if scroll_steps > 0 or until_idle else None,
            wait_for=(
                "js:() => window.__savee_scrolled === true "
                "|| document.querySelector('[id^=grid-item-]') != null "
                "|| Array.from(document.querySelectorAll('a')).some(a => (a.href||'').includes('/i/'))"
            ),
            page_timeout=page_timeout_ms,
        )
        result = await crawler.arun(url=url, config=cfg)
        if not getattr(result, "success", False):
            logger.warning(f"[listing] failed: {getattr(result, 'error_message', 'unknown error')}")
            return None
        return getattr(result, "html", None)

    async def _fetch_item_with_collect(self, crawler: AsyncWebCrawler, url: str, page_timeout_ms: int = 60000) -> Optional[str]:
        cfg = CrawlerRunConfig(
            js_code=build_item_collect_js(),
            wait_for=(
                "js:() => document.readyState === 'complete' && "
                "(document.documentElement.getAttribute('data-savee-item') != null)"
            ),
            page_timeout=page_timeout_ms,
        )
        result = await crawler.arun(url=url, config=cfg)
        if not getattr(result, 'success', False):
            logger.warning(f"[item+collect] failed {url}: {getattr(result, 'error_message', 'unknown error')}")
            return None
        return getattr(result, 'html', None)

    def _find_item_links_in_html(self, html: str, item_base_url: str) -> List[str]:
        # Maintain DOM order while de-duping
        seen_ids: Set[str] = set()
        ordered_ids: List[str] = []

        # 1) IDs from JS attribute (already in DOM order)
        for item_id in _parse_ids_from_data_attribute(html) or []:
            if is_valid_item_id(item_id) and item_id not in seen_ids:
                seen_ids.add(item_id)
                ordered_ids.append(item_id)

        # 2) Anchors captured via JS attribute (DOM order); extract ids
        for href in _parse_links_from_data_attribute(html) or []:
            maybe = extract_item_id_from_url(href)
            if maybe and maybe not in seen_ids:
                seen_ids.add(maybe)
                ordered_ids.append(maybe)

        # 3) DOM id="grid-item-<ID>" in appearance order
        for m in re.finditer(r"id=['\"]grid-item-([A-Za-z0-9_-]+)['\"]", html):
            item_id = m.group(1)
            if is_valid_item_id(item_id) and item_id not in seen_ids:
                seen_ids.add(item_id)
                ordered_ids.append(item_id)

        # 4) Href-based discovery in appearance order
        for m in re.finditer(r"href=\"(/i/[A-Za-z0-9_-]+[^\"]*)\"|href='(/i/[A-Za-z0-9_-]+[^']*)'", html):
            rel = m.group(1) or m.group(2)
            maybe = extract_item_id_from_url(rel)
            if maybe and maybe not in seen_ids:
                seen_ids.add(maybe)
                ordered_ids.append(maybe)

        # 5) Raw text fallback /i/<ID> in appearance order
        for m in re.finditer(r"/i/([A-Za-z0-9_-]+)", html):
            item_id = m.group(1)
            if is_valid_item_id(item_id) and item_id not in seen_ids:
                seen_ids.add(item_id)
                ordered_ids.append(item_id)

        # Build final URLs in discovered order
        links: List[str] = [f"{item_base_url}/i/{item_id}/" for item_id in ordered_ids]
        return links

    async def _ensure_login(self, crawler: AsyncWebCrawler, base_url: str, email: str, password: str) -> None:
        if not email or not password:
            return
        # Try common login paths
        for path in ("/login", "/auth/login", "/signin"):
            login_url = f"{base_url}{path}"
            cfg = CrawlerRunConfig(
                js_code=build_login_js(email, password),
                wait_for="js:() => document.readyState === 'complete'",
                page_timeout=60000,
            )
            result = await crawler.arun(url=login_url, config=cfg)
            if getattr(result, 'success', False):
                # If this path exists and didn't 404, break
                break

    async def scrape_listing(self, url: str, max_items: Optional[int] = None) -> List[ScrapedItem]:
        items: List[ScrapedItem] = []
        seen_ids: set[str] = set()
        
        # Build browser config with persisted session if provided
        storage_state = load_storage_state_from_env()
        cookies = load_cookies_from_env()
        browser_cfg = BrowserConfig(
            headless=True,
            verbose=False,
            storage_state=storage_state,
            cookies=cookies,
        )

        async with AsyncWebCrawler(config=browser_cfg) as crawler:
            # Login only if no storage_state/cookies provided and credentials are set
            if not storage_state and not cookies and settings.SAVE_EMAIL and settings.SAVE_PASSWORD:
                sp0 = urlsplit(url)
                base_url0 = f"{sp0.scheme}://{sp0.netloc}"
                await self._ensure_login(crawler, base_url0, settings.SAVE_EMAIL, settings.SAVE_PASSWORD)

            # Allow environment to control shallow/fast listings
            try:
                scroll_steps = int(os.getenv('LISTING_SCROLL_STEPS', '20'))
            except Exception:
                scroll_steps = 20
            listing_html = await self._fetch_listing_html(crawler, url, scroll_steps=scroll_steps, scroll_wait_ms=800, until_idle=True, idle_rounds=5)
            if not listing_html:
                return items

            links = self._find_item_links_in_html(listing_html, item_base_url="https://savee.com")
            if not links:
                logger.info("No item links discovered.")
                return items

            for link in links:
                if max_items is not None and len(items) >= max_items:
                    break
                item_id = self._extract_item_id_from_url(link)
                if not item_id or item_id in seen_ids:
                    continue
                
                # Scrape item details
                item = await self._scrape_item_details(crawler, link)
                if item:
                    items.append(item)
                    seen_ids.add(item_id)

        return items

    async def scrape_home(self, max_items: Optional[int] = None) -> List[ScrapedItem]:
        return await self.scrape_listing("https://savee.com/", max_items=max_items)

    async def scrape_trending(self, max_items: Optional[int] = None) -> List[ScrapedItem]:
        return await self.scrape_listing("https://savee.com/pop", max_items=max_items)
    
    async def scrape_pop(self, max_items: Optional[int] = None) -> List[ScrapedItem]:
        """Scrape popular/trending content"""
        return await self.scrape_listing("https://savee.com/pop", max_items=max_items)
    
    async def scrape_user(self, username: str, max_items: Optional[int] = None) -> List[ScrapedItem]:
        """Scrape user profile content"""
        return await self.scrape_listing(f"https://savee.com/{username}", max_items=max_items)

    # Iterator versions for real-time processing
    async def scrape_home_iterator(self, max_items: Optional[int] = None):
        """Async iterator that yields items one by one for real-time processing"""
        async for item in self._scrape_listing_iterator("https://savee.com/", max_items):
            yield item
    
    async def scrape_pop_iterator(self, max_items: Optional[int] = None):
        """Async iterator that yields items one by one for real-time processing"""
        async for item in self._scrape_listing_iterator("https://savee.com/pop", max_items):
            yield item
    
    async def scrape_user_iterator(self, username: str, max_items: Optional[int] = None):
        """Async iterator that yields items one by one for real-time processing"""
        async for item in self._scrape_listing_iterator(f"https://savee.com/{username}", max_items):
            yield item

    async def _scrape_listing_iterator(self, url: str, max_items: Optional[int] = None):
        """
        Async iterator version of scrape_listing that yields items one by one
        This enables true real-time processing: scrape1→upload1→scrape2→upload2
        """
        try:
            seen_ids: set[str] = set()
            
            # Build browser config with persisted session if provided (same as working method)
            storage_state = load_storage_state_from_env()
            cookies = load_cookies_from_env()
            browser_cfg = BrowserConfig(
                headless=True,
                verbose=False,
                storage_state=storage_state,
                cookies=cookies,
            )

            count = 0
            async with AsyncWebCrawler(config=browser_cfg) as crawler:
                # Login only if no storage_state/cookies provided and credentials are set
                if not storage_state and not cookies and settings.SAVE_EMAIL and settings.SAVE_PASSWORD:
                    sp0 = urlsplit(url)
                    base_url0 = f"{sp0.scheme}://{sp0.netloc}"
                    await self._ensure_login(crawler, base_url0, settings.SAVE_EMAIL, settings.SAVE_PASSWORD)

                logger.info(f"Starting real-time scraping: {url}")
                try:
                    scroll_steps = int(os.getenv('LISTING_SCROLL_STEPS', '20'))
                except Exception:
                    scroll_steps = 20
                listing_html = await self._fetch_listing_html(crawler, url, scroll_steps=scroll_steps, scroll_wait_ms=800, until_idle=True, idle_rounds=5)
                if not listing_html:
                    logger.warning(f"No HTML content retrieved from {url}")
                    return

                # Extract item links from the page
                item_links = self._find_item_links_in_html(listing_html, item_base_url="https://savee.com")
                if not item_links:
                    logger.info("No item links discovered.")
                    return

                # Limit item links to max_items if specified
                if max_items:
                    item_links = item_links[:max_items]
                
                logger.info(f"Found {len(item_links)} items to process on {url}")

                # Process each item one by one (real-time)
                new_seen_in_batch = 0
                for item_link in item_links:
                    if max_items and count >= max_items:
                        break
                    
                    item_id = self._extract_item_id_from_url(item_link)
                    if not item_id or item_id in seen_ids:
                        continue
                    
                    try:
                        # Scrape individual item details
                        item = await self._scrape_item_details(crawler, item_link)
                        if item:
                            seen_ids.add(item_id)
                            count += 1
                            new_seen_in_batch += 1
                            logger.info(f"Scraped item {count}: {item.external_id}")
                            yield item  # Yield immediately for real-time processing
                        else:
                            logger.warning(f"Failed to scrape item: {item_link}")
                    except Exception as e:
                        logger.error(f"Error scraping item {item_link}: {e}")
                        continue

                # If we didn't see any new IDs in this listing pass, return early to avoid rescanning from the top
                if new_seen_in_batch == 0:
                    logger.info("No new items discovered in listing; stopping iterator early")
                    return

                logger.info(f"Completed real-time scraping: {count} items processed")

        except Exception as e:
            logger.error(f"Failed to scrape listing {url}: {e}")
            return

    async def _scrape_item_details(self, crawler: AsyncWebCrawler, item_url: str) -> Optional[ScrapedItem]:
        """Scrape individual item details with comprehensive metadata extraction."""
        html = await self._fetch_item_with_collect(crawler, item_url) or await self._fetch_html(crawler, item_url)
        if not html:
            return None

        item_id = self._extract_item_id_from_url(item_url)
        if not item_id:
            return None

        # Extract JavaScript-collected data
        item_data = _parse_item_data_from_attr(html) or {}
        hd_image = item_data.get("imageOriginalSrc")
        video_src = item_data.get("videoSrc")
        video_poster = item_data.get("videoPosterSrc")
        source_api_url = item_data.get("sourceApiUrl")
        sidebar_info = item_data.get('info') if isinstance(item_data.get('info'), dict) else {}

        # Extract OpenGraph meta tags
        og_title, og_description, og_image_url, og_url = extract_meta_from_html(html)

        # Determine media type and URLs
        media_type = "video" if video_src else "image"
        # Always keep both when available
        primary_image = hd_image or og_image_url
        media_url = video_src or primary_image
        if not media_url:
            return None

        # Extract comprehensive data from sidebar info OR fallback to HTML parsing
        color_hexes = []
        ai_tags = []
        colors = []
        links = []
        
        if sidebar_info:
            # Extract AI-generated tags
            ai_tags = sidebar_info.get('aiTags', [])
            # Extract color hex codes
            color_hexes = sidebar_info.get('colorHexes', [])
            # Extract RGB colors
            colors = sidebar_info.get('colors', [])
            # Extract links
            links = sidebar_info.get('links', [])
        else:
            # Fallback: Extract comprehensive metadata from HTML when sidebar fails
            logger.warning(f"Sidebar info empty for {item_id}, using enhanced HTML extraction")
            
            # Try to extract from raw HTML if JavaScript failed
            _, color_hexes, ai_tags, colors, links = self._extract_metadata_from_html(html, item_url)

        # Add source URL to links if available
        if source_api_url:
            try:
                final_url = await self._fetch_source_final_url(crawler, source_api_url)
                if final_url and final_url != source_api_url:
                    # Add the resolved source URL to links
                    links.append({"href": final_url, "text": "original source"})
            except Exception as e:
                logger.warning(f"Failed to resolve source URL for {item_id}: {e}")

        # Use comprehensive title extraction
        title = og_title or sidebar_info.get('sidebarTitle') or f"Item {item_id}"

        # Format timestamps in ISO format
        from datetime import datetime, timezone
        saved_at = datetime.now(timezone.utc).isoformat()

        return ScrapedItem(
            external_id=item_id,
            title=title,
            description=og_description,
            media_type=media_type,
            media_url=media_url,
            thumbnail_url=video_poster if media_type == "video" else None,
            source_url=item_url,
            
            # Comprehensive metadata (matching savee_scraper.py format)
            page_url=item_url,
            og_title=og_title,
            og_description=og_description,
            og_image_url=og_image_url,
            og_url=og_url,
            saved_at=saved_at,
            image_url=primary_image,
            video_url=video_src,
            video_poster_url=video_poster,
            source_api_url=source_api_url,
            
            # Rich sidebar metadata
            sidebar_info=sidebar_info,
            color_hexes=color_hexes,
            ai_tags=ai_tags,
            colors=colors,
            links=links
        )

    def _extract_metadata_from_html(self, html: str, item_url: str) -> tuple:
        """Enhanced HTML metadata extraction using regex patterns from savee_scraper.py"""
        import re
        
        tags = []
        color_hexes = []
        ai_tags = []
        colors = []
        links = []
        
        try:
            # Look for AI tags in search links - pattern: /search/?q=TERM
            ai_tag_pattern = r'href="[^"]*\/search\/\?q=([^"&]+)"[^>]*>([^<]+)<'
            ai_matches = re.findall(ai_tag_pattern, html)
            for match in ai_matches:
                term = match[1].strip()
                if term and not term.startswith('#') and len(term) < 20:
                    ai_tags.append(term)
            
            # Look for color hex codes in links - pattern: Search by #HEXCODE
            color_pattern = r'title="Search by (#[0-9A-Fa-f]{3,8})"'
            color_matches = re.findall(color_pattern, html)
            color_hexes.extend(color_matches)
            
            # Look for hashtags in links
            hashtag_pattern = r'href="[^"]*"[^>]*>(#\w+)<'
            hashtag_matches = re.findall(hashtag_pattern, html)
            tags.extend(hashtag_matches)
            
            # Look for background color styles to extract RGB colors
            bg_color_pattern = r'style="[^"]*background(?:-color)?:\s*([^;"]+)'
            bg_matches = re.findall(bg_color_pattern, html)
            colors.extend([match.strip() for match in bg_matches if match.strip()])
            
            # Extract links from the page
            link_pattern = r'href="([^"]+)"[^>]*>([^<]+)<'
            link_matches = re.findall(link_pattern, html)
            for href, text in link_matches:
                if href.startswith('http') and text.strip():
                    links.append({"href": href, "text": text.strip()})
            
            # Remove duplicates
            tags = list(set(tags))
            color_hexes = list(set(color_hexes))
            ai_tags = list(set(ai_tags))
            colors = list(set(colors))
            
            logger.info(f"HTML extraction found: {len(ai_tags)} AI tags, {len(color_hexes)} colors, {len(tags)} hashtags")
            
        except Exception as e:
            logger.warning(f"HTML metadata extraction failed: {e}")
        
        return tags, color_hexes, ai_tags, colors, links

    async def _fetch_source_final_url(self, crawler: AsyncWebCrawler, api_url: str) -> Optional[str]:
        """Fetch the final URL from the source API endpoint."""
        try:
            from crawl4ai import CrawlerRunConfig
            cfg = CrawlerRunConfig(
                wait_for="js:() => true",
                page_timeout=20000,
            )
            result = await crawler.arun(url=api_url, config=cfg)
            if getattr(result, 'success', False):
                return getattr(result, 'url', None)
        except Exception as e:
            logger.error(f"Failed to fetch source final URL {api_url}: {e}")
        return None

    # Compatibility shim for queue consumer (if it still exists and calls _scrape_item)
    async def _scrape_item(self, session, item_url: str) -> Optional[ScrapedItem]:
        # This shim now directly calls the Crawl4AI-based _scrape_item_details
        # The 'session' argument is ignored as Crawl4AI manages its own browser context
        storage_state = load_storage_state_from_env()
        cookies = load_cookies_from_env()
        browser_cfg = BrowserConfig(
            headless=True,
            verbose=False,
            storage_state=storage_state,
            cookies=cookies,
        )
        async with AsyncWebCrawler(config=browser_cfg) as crawler:
            return await self._scrape_item_details(crawler, item_url)