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
      SELECT DISTINCT username FROM savee_users WHERE username IS NOT NULL ORDER BY username ASC
    `);

    const users = result.rows.map((row: any) => row.username);

    return NextResponse.json({ success: true, users });
  } catch (error) {
    console.error("Error fetching unique users:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch unique users" }, { status: 500 });
  }
}
