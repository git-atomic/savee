import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";
import { isAuthorized } from "../../../../../lib/auth";

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json({ success: false, error: "Failed to fetch unique origins" }, { status: 500 });
  }
}
