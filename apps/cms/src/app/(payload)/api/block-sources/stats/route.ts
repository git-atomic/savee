import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

async function getDb() {
  const payload = await getPayload({ config });
  return (payload.db as any).pool;
}

export async function GET(_req: NextRequest) {
  try {
    const db = await getDb();
    const counts = await db.query(
      `SELECT s.source_type, COUNT(*)::int AS c
       FROM block_sources bs
       JOIN sources s ON s.id = bs.source_id
       GROUP BY s.source_type
       ORDER BY s.source_type`
    );
    const recent = await db.query(
      `SELECT b.external_id, s.source_type, bs.saved_at
       FROM block_sources bs
       JOIN blocks b ON b.id = bs.block_id
       JOIN sources s ON s.id = bs.source_id
       ORDER BY bs.saved_at DESC NULLS LAST
       LIMIT 10`
    );
    return NextResponse.json({ success: true, counts: counts.rows, recent: recent.rows });
  } catch (e) {
    console.error("[bs:stats]", e);
    return NextResponse.json({ success: false, error: "Failed" }, { status: 500 });
  }
}




