import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

export async function GET(_req: NextRequest) {
  try {
    const payload = await getPayload({ config });
    // Simple DB ping
    const db: any = (payload.db as any).pool;
    let dbOk = false;
    try {
      const res = await db.query("SELECT 1 AS ok");
      dbOk = Boolean(res?.rows?.[0]?.ok === 1);
    } catch (e) {
      return NextResponse.json({ ok: false, error: `DB: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, db: dbOk, env: { vercel: Boolean(process.env.VERCEL) } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}


