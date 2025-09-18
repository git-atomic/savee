import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ blockId: string }> }
) {
  try {
    const payload = await getPayload({ config });
    const db = (payload.db as any).pool;

    const { blockId: blockIdParam } = await params;
    const blockId = parseInt(blockIdParam, 10);
    if (!Number.isFinite(blockId)) {
      return NextResponse.json(
        { success: false, error: "Invalid block id" },
        { status: 400 }
      );
    }

    const res = await db.query(
      `SELECT u.id, u.username
       FROM user_blocks ub
       JOIN savee_users u ON u.id = ub.user_id
       WHERE ub.block_id = $1
       ORDER BY u.username ASC`,
      [blockId]
    );

    return NextResponse.json({
      success: true,
      users: res.rows || [],
    });
  } catch (err) {
    console.error("[blocks/:id/users] error", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch users for block" },
      { status: 500 }
    );
  }
}
