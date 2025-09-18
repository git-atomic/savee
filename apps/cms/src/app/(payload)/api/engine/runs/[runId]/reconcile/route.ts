import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId: runIdParam } = await params;
    const runId = parseInt(runIdParam, 10);
    if (!Number.isFinite(runId)) {
      return NextResponse.json(
        { success: false, error: "Invalid run id" },
        { status: 400 }
      );
    }

    const payload = await getPayload({ config });
    const db = (payload.db as any).pool;

    // If run is still marked running but stale, reconcile counters and mark completed
    const runRes = await db.query(
      `SELECT id, status, updated_at FROM runs WHERE id = $1`,
      [runId]
    );
    const run = runRes.rows?.[0];
    if (!run) {
      return NextResponse.json(
        { success: false, error: "Run not found" },
        { status: 404 }
      );
    }

    // Count uploaded from blocks table
    const up = await db.query(
      `SELECT COUNT(*)::int AS c FROM blocks WHERE run_id = $1`,
      [runId]
    );
    const uploaded = up.rows?.[0]?.c ?? 0;

    // Compute processed (found) via blocks + skipped if available; here we set found=uploaded conservatively
    const counters = { found: uploaded, uploaded, errors: 0 };

    await db.query(
      `UPDATE runs SET status = 'completed', counters = $1::jsonb, completed_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(counters), runId]
    );

    return NextResponse.json({ success: true, counters });
  } catch (e) {
    console.error("[reconcile] error", e);
    return NextResponse.json(
      { success: false, error: "Failed to reconcile" },
      { status: 500 }
    );
  }
}
