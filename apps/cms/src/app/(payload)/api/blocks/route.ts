import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

async function getDbConnection() {
  const payload = await getPayload({ config });
  return (payload.db as any).pool;
}

export async function GET(request: NextRequest) {
  try {
    const db = await getDbConnection();
    const url = new URL(request.url);

    const origin = (url.searchParams.get("origin") || "").toLowerCase(); // home|pop|user
    const username = url.searchParams.get("username") || undefined;
    const sourceId = url.searchParams.get("sourceId") || undefined;
    const runId = url.searchParams.get("runId") || undefined;
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "50", 10) || 50,
      200
    );

    const params: any[] = [];
    const whereClauses: string[] = [];

    if (origin === "home" || origin === "pop" || origin === "user") {
      whereClauses.push("s.source_type = $" + (params.length + 1));
      params.push(origin);
    }
    if (origin === "user" && username) {
      whereClauses.push("s.username = $" + (params.length + 1));
      params.push(username);
    }
    if (sourceId) {
      whereClauses.push("b.source_id = $" + (params.length + 1));
      params.push(parseInt(sourceId));
    }
    if (runId) {
      whereClauses.push("b.run_id = $" + (params.length + 1));
      params.push(parseInt(runId));
    }

    const whereSQL = whereClauses.length
      ? `WHERE ${whereClauses.join(" AND ")}`
      : "";

    const query = `
      SELECT 
        b.*, 
        s.source_type as origin, 
        s.username as source_username
      FROM blocks b
      JOIN sources s ON s.id = b.source_id
      ${whereSQL}
      ORDER BY b.saved_at DESC NULLS LAST, b.created_at DESC NULLS LAST
      LIMIT $${params.length + 1}
    `;
    params.push(limit);

    const result = await db.query(query, params);
    return NextResponse.json({
      success: true,
      count: result.rows.length,
      blocks: result.rows,
    });
  } catch (error) {
    console.error("Error fetching blocks by origin:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch blocks" },
      { status: 500 }
    );
  }
}
