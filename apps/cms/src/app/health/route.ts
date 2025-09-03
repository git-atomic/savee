import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest) {
  return NextResponse.json({ ok: true, uptime: process.uptime?.() ?? null });
}

export async function POST(req: NextRequest) {
  return GET(req);
}


