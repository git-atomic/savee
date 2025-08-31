import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

async function getDbConnection() {
  const payload = await getPayload({ config });
  return (payload.db as any).pool;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ blockId: string }> }
) {
  try {
    const { blockId } = await ctx.params;
    const db = await getDbConnection();
    const res = await db.query(
      `SELECT su.id, su.username
       FROM user_blocks ub
       JOIN savee_users su ON su.id = ub.user_id
       WHERE ub.block_id = $1
       ORDER BY su.username ASC`,
      [parseInt(blockId)]
    );

    return NextResponse.json({
      success: true,
      count: res.rows.length,
      users: res.rows,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed" },
      { status: 500 }
    );
  }
}
