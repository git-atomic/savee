import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

export async function POST(_req: NextRequest) {
  try {
    const payload = await getPayload({ config });
    const db = (payload.db as any).pool;

    // 1) Nuke all existing relations (they may include previous test data)
    await db.query("DELETE FROM block_sources");

    // 2) Rebuild from blocks.source_id + run_id (ground truth of initial origin)
    // Cast saved_at safely in case it was stored as text
    await db.query(`
      INSERT INTO block_sources (block_id, source_id, run_id, saved_at)
      SELECT 
        b.id,
        b.source_id,
        b.run_id,
        COALESCE(
          NULLIF(b.saved_at, '')::timestamptz,
          b.created_at::timestamptz,
          NOW()
        )
      FROM blocks b
      WHERE b.source_id IS NOT NULL
      ON CONFLICT (block_id, source_id) DO NOTHING
    `);

    // 3) Ensure user sources exist for every saved user
    // Some databases may not have a unique constraint; the ON CONFLICT is best-effort
    await db.query(`
      INSERT INTO sources (source_type, username, url)
      SELECT 'user'::text, u.username, ('https://savee.com/' || u.username || '/')::text
      FROM savee_users u
      LEFT JOIN sources s
        ON s.source_type = 'user' AND s.username = u.username
      WHERE s.id IS NULL
    `);

    // 4) Add relations for user saves via user_blocks → sources(username)
    await db.query(`
      INSERT INTO block_sources (block_id, source_id, run_id, saved_at)
      SELECT ub.block_id, s.id, NULL, NULL
      FROM user_blocks ub
      JOIN savee_users u ON u.id = ub.user_id
      JOIN sources s ON s.source_type = 'user' AND s.username = u.username
      ON CONFLICT (block_id, source_id) DO NOTHING
    `);

    // 5) Return fresh counts
    const stats = await db.query(`
      SELECT s.source_type, COUNT(*)::int AS c
      FROM block_sources bs
      JOIN sources s ON s.id = bs.source_id
      GROUP BY s.source_type
      ORDER BY s.source_type
    `);

    return NextResponse.json({ success: true, counts: stats.rows });
  } catch (err: any) {
    console.error("[block-sources/reset] error", err);
    return NextResponse.json(
      { success: false, error: err?.message || "failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
