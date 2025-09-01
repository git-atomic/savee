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
    // If client returned a full URL, redirect. If it returned a key again, send JSON
    if (typeof presigned === 'string' && presigned.startsWith('http')) {
      return NextResponse.redirect(presigned, { status: 302 });
    }
    return NextResponse.json({ url: presigned });
  } catch (e) {
    return NextResponse.json({ error: "Presign failed" }, { status: 500 });
  }
}
