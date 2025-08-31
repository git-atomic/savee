import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

async function getDbConnection() {
  const payload = await getPayload({ config });
  return (payload.db as any).pool;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { username: string } }
) {
  try {
    const db = await getDbConnection();
    const username = params.username;
    if (!username) {
      return NextResponse.json(
        { success: false, error: "username is required" },
        { status: 400 }
      );
    }

    const url = new URL(request.url);
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "50", 10) || 50,
      200
    );

    const query = `
      SELECT b.*
      FROM blocks b
      JOIN sources s ON s.id = b.source_id
      WHERE s.source_type = 'user' AND s.username = $1
      ORDER BY b.saved_at DESC NULLS LAST, b.created_at DESC NULLS LAST
      LIMIT $2
    `;
    const result = await db.query(query, [username, limit]);
    return NextResponse.json({
      success: true,
      username,
      count: result.rows.length,
      blocks: result.rows,
    });
  } catch (error) {
    console.error("Error fetching user blocks:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch user blocks" },
      { status: 500 }
    );
  }
}
