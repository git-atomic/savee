export const dynamic = "force-dynamic";

import Feed, { type BlockItem } from "@/components/Feed";

async function fetchBlocks(): Promise<BlockItem[]> {
  const base = process.env.NEXT_PUBLIC_CMS_URL || "";
  const res = await fetch(`${base}/api/blocks?origin=pop&limit=60`, {
    cache: "no-store",
  });
  if (!res.ok) return [] as BlockItem[];
  const j = await res.json();
  return (j?.blocks || []) as BlockItem[];
}

export default async function PopPage() {
  const items = await fetchBlocks();
  return (
    <main className="min-h-screen px-4 py-6">
      <div className="mx-auto max-w-7xl">
        <Feed initial={items} nextCursor={undefined} query="origin=pop&limit=60" />
      </div>
    </main>
  );
}


