import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function extractAvatarFromHtml(html: string): Promise<string | null> {
  const dr = html.match(/https?:\/\/[^"']*savee-cdn\.com\/avatars\/[^"']+/i)?.[0];
  if (dr) return dr;
  const full = html.match(/https?:\/\/[^"']*default-avatar-\d+\.jpg/i)?.[0];
  if (full) return full;
  const file = html.match(/default-avatar-\d+\.jpg/i)?.[0];
  if (file) return `https://st.savee-cdn.com/img/${file}`;
  const any = html.match(/https?:\/\/[^"']*savee-cdn\.com\/(?:img\/)?avatars\/[^"']+/i)?.[0];
  return any || null;
}

async function uploadToR2(bytes: Uint8Array, key: string): Promise<void> {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT_URL,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  const bucket = process.env.R2_BUCKET_NAME!;
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: "image/jpeg" })
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;
    const payload = await getPayload({ config });

    const found = await payload.find({
      collection: "savee_users",
      where: { username: { equals: username } },
      limit: 1,
    });
    const doc = found.docs?.[0];

    // If we already have R2 key, return proxy URL
    const existingKey = doc?.avatar_r2_key || (doc as any)?.avatarR2Key;
    if (existingKey) {
      return NextResponse.json({
        src: `/api/r2/presign?mode=proxy&key=${encodeURIComponent(existingKey)}`,
      });
    }

    // Fetch Savee profile and extract avatar
    const profileUrl = `https://savee.com/${encodeURIComponent(username)}/`;
    const resp = await fetch(profileUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36",
      },
      cache: "no-store",
    });
    const html = await resp.text();
    const avatarUrl = await extractAvatarFromHtml(html);
    if (!avatarUrl) {
      return NextResponse.json({ src: null }, { status: 200 });
    }

    // Try to mirror to R2
    let r2Key: string | null = null;
    try {
      const imgResp = await fetch(avatarUrl, {
        headers: {
          Referer: "https://savee.com/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });
      const arr = new Uint8Array(await imgResp.arrayBuffer());
      // Stable key on content hash
      const { createHash } = await import("crypto");
      const hash = createHash("sha256").update(arr).digest("hex").slice(0, 16);
      const base = `users/${username}/avatar`;
      r2Key = `${base}/original_${hash}.jpg`;
      await uploadToR2(arr, r2Key);
    } catch (_) {
      r2Key = null; // fall back to direct URL
    }

    // Persist to DB when possible
    if (doc) {
      try {
        await payload.update({
          collection: "savee_users",
          id: doc.id,
          data: {
            profile_image_url: avatarUrl,
            avatar_r2_key: r2Key || undefined,
          },
        });
      } catch {}
    }

    return NextResponse.json({
      src: r2Key
        ? `/api/r2/presign?mode=proxy&key=${encodeURIComponent(r2Key)}`
        : avatarUrl,
    });
  } catch (e) {
    return NextResponse.json({ src: null }, { status: 200 });
  }
}


