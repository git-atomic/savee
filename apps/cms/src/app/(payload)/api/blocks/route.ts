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
    const externalId = url.searchParams.get("externalId") || undefined; // allow lookup by external_id
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "50", 10) || 50,
      200
    );
    // Cursor for keyset pagination: base64({ savedAt: ISO|null, id: number })
    const cursorParam = url.searchParams.get("cursor");
    let cursorSavedAt: Date | null = null;
    let cursorId: number | null = null;
    if (cursorParam) {
      try {
        const decoded = JSON.parse(
          Buffer.from(cursorParam, "base64").toString("utf-8")
        );
        if (decoded && decoded.savedAt)
          cursorSavedAt = new Date(decoded.savedAt);
        if (decoded && (decoded.id || decoded.id === 0))
          cursorId = Number(decoded.id);
      } catch {}
    }

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
    if (externalId) {
      whereClauses.push("b.external_id = $" + (params.length + 1));
      params.push(externalId);
    }

    // Apply keyset pagination if cursor provided
    if (cursorSavedAt && cursorId) {
      params.push(cursorSavedAt);
      params.push(cursorId);
      whereClauses.push(
        `(b.saved_at < $${params.length - 1} OR (b.saved_at = $${params.length - 1} AND b.id < $${params.length}))`
      );
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
    let nextCursor: string | null = null;
    if (result.rows.length === limit) {
      const last = result.rows[result.rows.length - 1];
      if (last) {
        try {
          nextCursor = Buffer.from(
            JSON.stringify({
              savedAt: last.saved_at || last.savedAt || null,
              id: last.id,
            })
          ).toString("base64");
        } catch {}
      }
    }
    return NextResponse.json({
      success: true,
      count: result.rows.length,
      blocks: result.rows,
      nextCursor,
    });
  } catch (error) {
    console.error("Error fetching blocks by origin:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch blocks" },
      { status: 500 }
    );
  }
}
