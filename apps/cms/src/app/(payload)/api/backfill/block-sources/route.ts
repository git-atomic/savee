import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

async function isAllowed(req: NextRequest): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true;
  const token = process.env.ENGINE_MONITOR_TOKEN || process.env.BACKFILL_TOKEN;
  if (!token) return false;
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    if (auth.slice(7).trim() === token) return true;
  }
  try {
    const url = new URL(req.url);
    const t = url.searchParams.get("token");
    if (t && t === token) return true;
  } catch {}
  return false;
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isAllowed(req))) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    const payload = await getPayload({ config });
    const db = (payload.db as any).pool;

    // Ensure table exists (idempotent)
    await db.query(`
      CREATE TABLE IF NOT EXISTS block_sources (
        id SERIAL PRIMARY KEY,
        block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
        source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        run_id INTEGER NULL REFERENCES runs(id) ON DELETE SET NULL,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        saved_at TIMESTAMPTZ NULL,
        CONSTRAINT uq_block_source UNIQUE (block_id, source_id)
      );
      CREATE INDEX IF NOT EXISTS idx_block_sources_block ON block_sources(block_id);
      CREATE INDEX IF NOT EXISTS idx_block_sources_source ON block_sources(source_id);
      CREATE INDEX IF NOT EXISTS idx_block_sources_run ON block_sources(run_id);
    `);

    // Count before
    const before = await db.query(
      `SELECT COUNT(*)::int AS c FROM block_sources`
    );
    const beforeCount: number = before?.rows?.[0]?.c ?? 0;

    // Backfill from existing blocks where missing
    // saved_at = COALESCE(b.saved_at, b.created_at, NOW()) for better chronology
    await db.query(`
      INSERT INTO block_sources (block_id, source_id, run_id, saved_at)
      SELECT b.id, b.source_id, b.run_id, COALESCE(NULLIF(b.saved_at, '' )::timestamptz, b.created_at, NOW())
      FROM blocks b
      LEFT JOIN block_sources bs
        ON bs.block_id = b.id AND bs.source_id = b.source_id
      WHERE bs.id IS NULL;
    `);

    const after = await db.query(
      `SELECT COUNT(*)::int AS c FROM block_sources`
    );
    const afterCount: number = after?.rows?.[0]?.c ?? 0;

    // Repair origin_text on existing blocks where missing or incorrect
    try {
      await db.query(`
        UPDATE blocks b SET origin_text = sub.val
        FROM (
          SELECT b2.id,
            CASE 
              WHEN BOOL_OR(s.source_type = 'pop') THEN 'pop'
              WHEN BOOL_OR(s.source_type = 'home') THEN 'home'
              ELSE MIN(COALESCE(s.username,'user'))
            END AS val
          FROM blocks b2
          JOIN block_sources bs ON bs.block_id = b2.id
          JOIN sources s ON s.id = bs.source_id
          GROUP BY b2.id
        ) AS sub
        WHERE sub.id = b.id AND (b.origin_text IS NULL OR b.origin_text = '' OR b.origin_text = 'i');
      `);
    } catch {}

    return NextResponse.json({
      success: true,
      created: afterCount - beforeCount,
      total: afterCount,
    });
  } catch (e) {
    console.error("[backfill:block-sources] error", e);
    return NextResponse.json(
      { success: false, error: "Failed to backfill relations" },
      { status: 500 }
    );
  }
}

// Convenience alias in dev and for browser-trigger: GET delegates to POST
export async function GET(req: NextRequest) {
  return POST(req);
}
