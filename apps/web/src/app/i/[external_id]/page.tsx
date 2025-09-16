import type { Metadata } from "next";

type PageProps = { params: { external_id: string } };

async function fetchBlockById(id: string) {
  const base = process.env.NEXT_PUBLIC_CMS_URL || "";
  const url = `${base}/api/blocks?externalId=${encodeURIComponent(id)}&limit=1`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  const block = json?.blocks?.[0];
  return block || null;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const block = await fetchBlockById(params.external_id);
  const title = block?.title || block?.og_title || `Item ${params.external_id}`;
  const description = block?.og_description || "";
  return { title, description };
}

export default async function BlockPage({ params }: PageProps) {
  const block = await fetchBlockById(params.external_id);
  if (!block) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-neutral-500">Not found.</p>
      </main>
    );
  }

  const base = process.env.NEXT_PUBLIC_CMS_URL || "";
  const originalKey: string | undefined = block.r2_key || undefined;
  const poster: string | undefined =
    block.thumbnail_url || block.og_image_url || undefined;

  async function presign(key?: string): Promise<string | undefined> {
    if (!key) return undefined;
    const url = `${base}/api/r2/presign?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return undefined;
    const j: { url?: string } = await res.json();
    return j?.url;
  }

  // Build expected variant keys relative to base path
  type VariantKeys = {
    original?: string;
    thumb?: string;
    small?: string;
    medium?: string;
    large?: string;
    poster?: string;
  };

  function variantKeys(baseKey?: string): VariantKeys {
    if (!baseKey) return {};
    const slash = baseKey.lastIndexOf("/");
    const dot = baseKey.lastIndexOf(".");
    const basePath = slash >= 0 ? baseKey.slice(0, slash + 1) : "";
    let core = baseKey.slice(slash + 1, dot >= 0 ? dot : undefined);
    core = core.replace(/^original_/, "").replace(/^video_/, "");
    return {
      original: baseKey,
      thumb: `${basePath}thumb_${core}.jpg`,
      small: `${basePath}small_${core}.jpg`,
      medium: `${basePath}medium_${core}.jpg`,
      large: `${basePath}large_${core}.jpg`,
      poster: `${basePath}poster_${core}.jpg`,
    };
  }

  const keys = variantKeys(originalKey);
  const [imgLarge, imgPoster] = await Promise.all([
    presign(
      keys.large || keys.medium || keys.small || keys.thumb || keys.original
    ),
    presign(keys.poster || poster),
  ]);

  const isVideo =
    block.media_type === "video" ||
    (originalKey && originalKey.endsWith(".mp4"));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8">
          <div className="rounded-[11px] overflow-hidden border bg-neutral-50 dark:bg-neutral-900">
            {isVideo ? (
              <video
                className="w-full h-auto"
                controls
                preload="metadata"
                poster={imgPoster}
                src={await presign(keys.original)}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imgLarge}
                alt={block.title || block.og_title || ""}
                className="w-full h-auto"
              />
            )}
          </div>
        </div>
        <aside className="lg:col-span-4 space-y-4">
          <div className="rounded-[11px] border p-4">
            <h1 className="text-lg font-semibold">
              {block.title || block.og_title || "Untitled"}
            </h1>
            {block.og_description ? (
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                {block.og_description}
              </p>
            ) : null}
            {block.og_url ? (
              <a
                href={block.og_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-sm text-blue-600 hover:underline"
              >
                Source
              </a>
            ) : null}
          </div>
          {Array.isArray(block.ai_tags) && block.ai_tags.length > 0 && (
            <div className="rounded-[11px] border p-4">
              <div className="text-xs font-medium mb-2">AI Tags</div>
              <div className="flex flex-wrap gap-2">
                {block.ai_tags.slice(0, 24).map((t: string) => (
                  <span
                    key={t}
                    className="px-2 py-1 rounded-full border text-xs"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {Array.isArray(block.color_hexes) && block.color_hexes.length > 0 && (
            <div className="rounded-[11px] border p-4">
              <div className="text-xs font-medium mb-2">Palette</div>
              <div className="flex gap-2 flex-wrap">
                {block.color_hexes.slice(0, 10).map((c: string) => (
                  <div
                    key={c}
                    className="w-6 h-6 rounded"
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
