import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

export const runtime = "nodejs";
export const revalidate = 0;
export const dynamic = "force-dynamic";

async function getDb() {
  const payload = await getPayload({ config });
  return (payload.db as any).pool;
}

export async function GET(req: NextRequest) {
  try {
    const db = await getDb();
    const url = new URL(req.url);
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "50", 10) || 50,
      200
    );
    const q = url.searchParams.get("q") || undefined;
    const cursor = url.searchParams.get("cursor") || undefined; // base64 { savesCount:number, id:number }

    const where: string[] = [];
    const params: any[] = [];
    if (q && q.trim().length > 1) {
      const like = `%${q.trim()}%`;
      where.push(
        `(su.username ILIKE $${params.length + 1} OR su.display_name ILIKE $${params.length + 1})`
      );
      params.push(like);
    }
    if (cursor) {
      try {
        const c = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
        if (c && typeof c.savesCount === "number" && typeof c.id === "number") {
          params.push(Number(c.savesCount));
          params.push(Number(c.id));
          where.push(
            `(su.saves_count < $${params.length - 1} OR (su.saves_count = $${params.length - 1} AND su.id < $${params.length}))`
          );
        }
      } catch {}
    }
    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sql = `
      SELECT su.id, su.username, su.display_name, su.avatar_r2_key, su.profile_image_url, su.saves_count
      FROM savee_users su
      ${whereSQL}
      ORDER BY su.saves_count DESC NULLS LAST, su.id DESC
      LIMIT $${params.length + 1}
    `;
    params.push(limit);
    const res = await db.query(sql, params);

    let nextCursor: string | null = null;
    if (res.rows.length === limit) {
      const last = res.rows[res.rows.length - 1];
      if (last) {
        try {
          nextCursor = Buffer.from(
            JSON.stringify({ savesCount: last.saves_count || 0, id: last.id })
          ).toString("base64");
        } catch {}
      }
    }

    return NextResponse.json({ success: true, users: res.rows, nextCursor });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: String(e) },
      { status: 500 }
    );
  }
}


