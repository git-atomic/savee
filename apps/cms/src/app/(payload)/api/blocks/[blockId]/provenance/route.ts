import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ blockId: string }> }
) {
  try {
    const payload = await getPayload({ config });
    const db = (payload.db as any).pool;
    const { blockId: blockIdParam } = await params;
    const blockId = parseInt(blockIdParam, 10);
    if (!Number.isFinite(blockId)) {
      return NextResponse.json(
        { success: false, error: "Invalid block id" },
        { status: 400 }
      );
    }

    const res = await db.query(
      `WITH users_union AS (
         SELECT s.username AS uname
         FROM block_sources bs_u
         JOIN sources s ON s.id = bs_u.source_id
         WHERE bs_u.block_id = $1 AND s.source_type::text = 'user' AND s.username IS NOT NULL
         UNION
         SELECT u.username AS uname
         FROM user_blocks ub
         JOIN savee_users u ON u.id = ub.user_id
         WHERE ub.block_id = $1
       )
       SELECT 
         COALESCE((
           SELECT BOOL_OR(s1.source_type::text = 'home')
           FROM block_sources bs1 JOIN sources s1 ON s1.id = bs1.source_id
           WHERE bs1.block_id = $1
         ), false) AS home,
         COALESCE((
           SELECT BOOL_OR(s2.source_type::text = 'pop')
           FROM block_sources bs2 JOIN sources s2 ON s2.id = bs2.source_id
           WHERE bs2.block_id = $1
         ), false) AS pop,
         COALESCE((
           SELECT jsonb_agg(DISTINCT uname) FROM users_union
         ), '[]'::jsonb) AS users,
         COALESCE((
           SELECT COUNT(DISTINCT uname)::int FROM users_union
         ), 0) AS users_count,
         COALESCE((
           SELECT jsonb_agg(DISTINCT tag)
           FROM (
             SELECT CASE WHEN s3.source_type::text = 'user' THEN s3.username ELSE s3.source_type::text END AS tag
             FROM block_sources bs3 JOIN sources s3 ON s3.id = bs3.source_id WHERE bs3.block_id = $1
             UNION
             SELECT uname AS tag FROM users_union
           ) t
         ), '[]'::jsonb) AS tags`,
      [blockId]
    );

    const row = res.rows?.[0] || {
      home: false,
      pop: false,
      users: [],
      users_count: 0,
      tags: [],
    };
    return NextResponse.json({ success: true, origin_map: row });
  } catch (err) {
    console.error("[blocks/:id/provenance] error", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch provenance" },
      { status: 500 }
    );
  }
}
