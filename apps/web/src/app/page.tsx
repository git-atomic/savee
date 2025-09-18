export const dynamic = "force-dynamic";

type Block = {
  external_id: string;
  media_type: string;
  r2_key?: string;
  title?: string;
  og_title?: string;
};

async function fetchBlocks(): Promise<Block[]> {
  const base = process.env.NEXT_PUBLIC_CMS_URL || "";
  const res = await fetch(`${base}/api/blocks?origin=home&limit=30`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  const j = await res.json();
  return j?.blocks || [];
}

function smallVariant(_key?: string) {
  const key = _key;
  if (!key) return undefined;
  if (!key) return undefined;
  const slash = key.lastIndexOf("/");
  const dot = key.lastIndexOf(".");
  const basePath = slash >= 0 ? key.slice(0, slash + 1) : "";
  let core = key.slice(slash + 1, dot >= 0 ? dot : undefined);
  core = core.replace(/^original_/, "").replace(/^video_/, "");
  return `${basePath}small_${core}.jpg`;
}

import Feed, { type BlockItem } from "@/components/Feed";

export default async function Home() {
  const blocks = await fetchBlocks();
  return (
    <main className="min-h-screen px-4 py-6">
      <div className="mx-auto max-w-7xl">
        <Feed
          initial={blocks as unknown as BlockItem[]}
          nextCursor={undefined}
          query="origin=home&limit=30"
        />
      </div>
    </main>
  );
}
