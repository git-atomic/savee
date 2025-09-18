import Feed, { type BlockItem } from "@/components/Feed";

export const dynamic = "force-dynamic";

async function fetchUserBlocks(username: string): Promise<BlockItem[]> {
  const base = process.env.NEXT_PUBLIC_CMS_URL || "";
  const url = new URL(`${base}/api/blocks`);
  url.searchParams.set("origin", "user");
  url.searchParams.set("username", username);
  url.searchParams.set("limit", "30");
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return [] as BlockItem[];
  const j = await res.json();
  return (j?.blocks || []) as BlockItem[];
}

export default async function UserPage({
  params,
}: {
  params: { username: string };
}) {
  const items = await fetchUserBlocks(params.username);
  const q = `origin=user&username=${encodeURIComponent(
    params.username
  )}&limit=30`;
  return (
    <main className="min-h-screen px-4 py-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 text-sm text-neutral-500">@{params.username}</div>
        <Feed initial={items} nextCursor={undefined} query={q} />
      </div>
    </main>
  );
}
