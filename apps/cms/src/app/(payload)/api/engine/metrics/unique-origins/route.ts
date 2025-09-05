import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

function isAuthorized(req: NextRequest): boolean {
  const token = process.env.ENGINE_MONITOR_TOKEN;
  if (!token) return true; // allow in dev if not set
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const provided = auth.slice(7).trim();
    if (provided === token) return true;
  }
  try {
    const url = new URL(req.url);
    const t = url.searchParams.get("token");
    if (t && t === token) return true;
  } catch {}
  return false;
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const payload = await getPayload({ config });
    const db = (payload.db as any).pool;

    const result = await db.query(`
      SELECT DISTINCT origin_text FROM blocks WHERE origin_text IS NOT NULL
      UNION
      SELECT DISTINCT username FROM sources WHERE source_type = 'user' AND username IS NOT NULL
      ORDER BY origin_text ASC
    `);

    const origins = result.rows.map((row: any) => row.origin_text);

    return NextResponse.json({ success: true, origins });
  } catch (error) {
    console.error("Error fetching unique origins:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch unique origins" },
      { status: 500 }
    );
  }
}
