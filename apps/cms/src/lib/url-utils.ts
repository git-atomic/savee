export type SourceType = "home" | "pop" | "user";

export interface ParsedSaveeUrl {
  isValid: boolean;
  sourceType: SourceType;
  username?: string;
  href?: string;
}

const RESERVED_SEGMENTS = new Set([
  "pop",
  "popular",
  "trending",
  "boards",
  "followers",
  "following",
  "i",
]);

function safeUrl(input: string): URL | null {
  try {
    // Prepend protocol if missing
    const normalized = /^(https?:)?\/\//i.test(input)
      ? input
      : `https://${input}`;
    return new URL(normalized);
  } catch {
    return null;
  }
}

export function parseSaveeUrl(input: string): ParsedSaveeUrl {
  const url = safeUrl(String(input || "").trim());
  if (!url) return { isValid: false, sourceType: "user" };

  const host = url.hostname.toLowerCase();
  const isSavee = host.endsWith("savee.it") || host.endsWith("savee.com");
  if (!isSavee) return { isValid: false, sourceType: "user" };

  // Normalize path
  const path = url.pathname.replace(/\/+$/g, "");
  const segs = path.split("/").filter(Boolean);

  // Home page
  if (segs.length === 0) {
    return { isValid: true, sourceType: "home", href: url.href };
  }

  // Pop / Trending
  if (segs.length >= 1) {
    const s0 = segs[0].toLowerCase();
    if (s0 === "pop" || s0 === "popular" || s0 === "trending") {
      return { isValid: true, sourceType: "pop", href: url.href };
    }
  }

  // Otherwise treat first segment as username unless it is reserved
  const candidate = segs[0]?.toLowerCase();
  if (candidate && !RESERVED_SEGMENTS.has(candidate)) {
    return {
      isValid: true,
      sourceType: "user",
      username: candidate,
      href: url.href,
    };
  }

  // Fallback: still valid savee URL but unknown segment — default to home
  return { isValid: true, sourceType: "home", href: url.href };
}

/**
 * URL parsing utilities for Savee.it URLs
 */

export interface ParsedSaveeUrl {
  isValid: boolean;
  sourceType: "home" | "pop" | "user";
  username?: string;
  originalUrl: string;
}

export function parseSaveeUrl(url: string): ParsedSaveeUrl {
  const result: ParsedSaveeUrl = {
    isValid: false,
    sourceType: "home",
    originalUrl: url,
  };

  if (!url || typeof url !== "string") {
    return result;
  }

  const cleanUrl = url.trim().toLowerCase();

  // Check if it's a valid savee URL (savee.com or savee.it)
  if (!cleanUrl.includes("savee.com") && !cleanUrl.includes("savee.it")) {
    return result;
  }

  // Normalize URL format
  let normalizedUrl = cleanUrl;
  if (!normalizedUrl.startsWith("http")) {
    normalizedUrl = "https://" + normalizedUrl;
  }

  try {
    const urlObj = new URL(normalizedUrl);

    if (
      !urlObj.hostname.includes("savee.com") &&
      !urlObj.hostname.includes("savee.it")
    ) {
      return result;
    }

    const pathname = urlObj.pathname;

    // Home page
    if (pathname === "/" || pathname === "") {
      result.isValid = true;
      result.sourceType = "home";
      return result;
    }

    // Popular/trending pages
    if (
      pathname.includes("/pop") ||
      pathname.includes("/popular") ||
      pathname.includes("/trending")
    ) {
      result.isValid = true;
      result.sourceType = "pop";
      return result;
    }

    // User profile pages
    const userMatch = pathname.match(/^\/([^\/\?]+)/);
    if (userMatch && userMatch[1]) {
      const username = userMatch[1];

      // Skip common non-user paths
      const nonUserPaths = [
        "i",
        "api",
        "login",
        "register",
        "about",
        "terms",
        "privacy",
        "help",
      ];
      if (!nonUserPaths.includes(username)) {
        result.isValid = true;
        result.sourceType = "user";
        result.username = username;
        return result;
      }
    }

    return result;
  } catch {
    return result;
  }
}

export function validateSaveeUrl(url: string): boolean {
  return parseSaveeUrl(url).isValid;
}
