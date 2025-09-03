import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

async function getDbConnection() {
  const payload = await getPayload({ config });
  return (payload.db as any).pool;
}

function isAuthorized(req: NextRequest): boolean {
  const token = process.env.ENGINE_MONITOR_TOKEN;
  if (!token) return true; // allow in dev if not set
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  const provided = auth.slice(7).trim();
  return provided === token;
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const db = await getDbConnection();
    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(20, parseInt(url.searchParams.get("limit") || "4", 10)));

    const res = await db.query(
      `SELECT r.id as run_id, r.max_items, s.url, s.id as source_id
       FROM runs r
       JOIN sources s ON r.source_id = s.id
       WHERE r.status = 'pending'
       ORDER BY r.created_at ASC
       LIMIT $1`,
      [limit]
    );

    const pending = res.rows.map((row: any) => ({
      sourceId: Number(row.source_id),
      runId: Number(row.run_id),
      url: String(row.url),
      maxItems: row.max_items === null ? null : Number(row.max_items),
    }));

    return NextResponse.json({ success: true, pending });
  } catch (error) {
    console.error("[pending] Error:", error);
    return NextResponse.json({ success: false, error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // alias to GET for convenience
  return GET(request);
}


