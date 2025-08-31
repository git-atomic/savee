import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const payload = await getPayload({ config });
    const doc = await payload.findByID({
      collection: "sources",
      id,
    });
    return NextResponse.json({ success: true, doc });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Not found" },
      { status: 404 }
    );
  }
}
