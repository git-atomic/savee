export const dynamic = "force-dynamic";

type User = {
  id: number;
  username: string;
  display_name?: string;
  avatar_r2_key?: string;
  profile_image_url?: string;
  saves_count?: number;
};

async function fetchUsers(): Promise<{ users: User[]; nextCursor?: string }> {
  const base = process.env.NEXT_PUBLIC_CMS_URL || "";
  const res = await fetch(`${base}/api/users?limit=60`, { cache: "no-store" });
  if (!res.ok) return { users: [], nextCursor: undefined };
  const j = await res.json();
  return { users: j?.users || [], nextCursor: j?.nextCursor };
}

function avatarVariant(key?: string) {
  if (!key) return undefined;
  const slash = key.lastIndexOf("/");
  const basePath = slash >= 0 ? key.slice(0, slash + 1) : "";
  const core = key
    .slice(slash + 1)
    .replace(/^original_/, "")
    .replace(/\.[a-z0-9]+$/i, "");
  return `${basePath}small_${core}.jpg`;
}

export default async function UsersPage() {
  const base = process.env.NEXT_PUBLIC_CMS_URL || "";
  const { users } = await fetchUsers();

  async function presign(key?: string): Promise<string | undefined> {
    if (!key) return undefined;
    const r = await fetch(
      `${base}/api/r2/presign?key=${encodeURIComponent(key)}`,
      { cache: "no-store" }
    );
    if (!r.ok) return undefined;
    const j: { url?: string } = await r.json();
    return j?.url;
  }

  const cards = await Promise.all(
    users.map(async (u) => ({
      username: u.username,
      name: u.display_name || u.username,
      avatar: await presign(avatarVariant(u.avatar_r2_key)),
      count: u.saves_count || 0,
    }))
  );

  return (
    <main className="min-h-screen px-4 py-6">
      <div className="mx-auto max-w-6xl grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {cards.map((c) => (
          <a
            key={c.username}
            href={`/users/${c.username}`}
            className="rounded-[11px] border p-3 flex flex-col items-center text-center hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={c.avatar}
              alt={c.name}
              className="w-16 h-16 rounded-full object-cover border"
            />
            <div className="mt-2 text-sm font-medium">{c.name}</div>
            <div className="text-xs text-neutral-500">{c.count} saves</div>
          </a>
        ))}
      </div>
    </main>
  );
}


