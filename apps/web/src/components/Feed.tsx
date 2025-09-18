"use client";

import * as React from "react";

export type BlockItem = {
  external_id: string;
  media_type: string;
  r2_key?: string;
  title?: string;
  og_title?: string;
};

function smallVariant(key?: string) {
  if (!key) return undefined;
  const slash = key.lastIndexOf("/");
  const dot = key.lastIndexOf(".");
  const basePath = slash >= 0 ? key.slice(0, slash + 1) : "";
  let core = key.slice(slash + 1, dot >= 0 ? dot : undefined);
  core = core.replace(/^original_/, "").replace(/^video_/, "");
  return `${basePath}small_${core}.jpg`;
}

async function presign(
  base: string,
  key?: string
): Promise<string | undefined> {
  if (!key) return undefined;
  try {
    const r = await fetch(
      `${base}/api/r2/presign?key=${encodeURIComponent(key)}`
    );
    if (!r.ok) return undefined;
    const j: { url?: string } = await r.json();
    return j?.url;
  } catch {
    return undefined;
  }
}

type FeedProps = {
  initial: BlockItem[];
  nextCursor?: string;
  query: string; // query string after /api/blocks e.g. origin=home or origin=user&username=xxx
};

export default function Feed({ initial, nextCursor, query }: FeedProps) {
  const cmsBase = process.env.NEXT_PUBLIC_CMS_URL || "";
  const [items, setItems] = React.useState<
    Array<{ id: string; href: string; src?: string; title: string }>
  >([]);
  const [cursor, setCursor] = React.useState<string | undefined>(nextCursor);
  const [loading, setLoading] = React.useState(false);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const [booting, setBooting] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    async function mapInitial() {
      const mapped = await Promise.all(
        initial.map(async (b) => ({
          id: b.external_id,
          href: `/i/${b.external_id}`,
          src: await presign(cmsBase, smallVariant(b.r2_key)),
          title: b.title || b.og_title || "",
        }))
      );
      if (!cancelled) {
        setItems(mapped.filter((m) => m.src));
        setBooting(false);
      }
    }
    mapInitial();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!sentinelRef.current) return;
    const el = sentinelRef.current;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) void loadMore();
      });
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  async function loadMore() {
    if (loading || !cursor) return;
    setLoading(true);
    try {
      const url = new URL(`${cmsBase}/api/blocks`);
      query.split("&").forEach((kv) => {
        const [k, v] = kv.split("=");
        if (k && v !== undefined) url.searchParams.set(k, v);
      });
      url.searchParams.set("cursor", cursor);
      const r = await fetch(url.toString(), { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      const mapped = await Promise.all(
        (j?.blocks || []).map(async (b: BlockItem) => ({
          id: b.external_id,
          href: `/i/${b.external_id}`,
          src: await presign(cmsBase, smallVariant(b.r2_key)),
          title: b.title || b.og_title || "",
        }))
      );
      setItems((prev) => prev.concat(mapped.filter((m) => m.src)));
      setCursor(j?.nextCursor || undefined);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="columns-2 md:columns-3 lg:columns-4 gap-3 [column-fill:_balance]">
        {items.map((i) => (
          <a
            key={i.id}
            href={i.href}
            className="mb-3 block break-inside-avoid rounded-[11px] overflow-hidden border bg-neutral-50 dark:bg-neutral-900"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={i.src} alt={i.title} className="w-full h-auto" />
          </a>
        ))}
        {booting &&
          Array.from({ length: 16 }).map((_, idx) => (
            <div
              key={`s-${idx}`}
              className="mb-3 block break-inside-avoid rounded-[11px] overflow-hidden border"
            >
              <div className="w-full aspect-[4/5] animate-pulse bg-neutral-200 dark:bg-neutral-800" />
            </div>
          ))}
      </div>
      <div ref={sentinelRef} className="h-8" />
    </div>
  );
}


