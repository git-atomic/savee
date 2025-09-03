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

export function validateSaveeUrl(url: string): boolean {
  return parseSaveeUrl(url).isValid;
}
