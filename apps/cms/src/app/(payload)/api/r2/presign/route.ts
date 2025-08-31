import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "Missing key" }, { status: 400 });
    }

    const { getR2Client } = await import("../../../lib/r2");
    const client = await getR2Client();
    const presigned = await client.getPresigned(key);
    // Redirect the browser <img> directly to the presigned URL (or public path)
    return NextResponse.redirect(presigned, { status: 302 });
  } catch (e) {
    return NextResponse.json({ error: "Presign failed" }, { status: 500 });
  }
}
