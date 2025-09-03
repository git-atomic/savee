import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

export const runtime = "nodejs";
export const revalidate = 0;
export const dynamic = "force-dynamic";

interface LogEntry {
  id?: number;
  timestamp: string;
  type: "STARTING" | "FETCH" | "SCRAPE" | "COMPLETE" | "WRITE/UPLOAD" | "ERROR";
  url?: string;
  status?: "✓" | "❌" | "⏳";
  timing?: string;
  message?: string;
}

async function getDbConnection() {
  const payload = await getPayload({ config });
  return (payload.db as any).pool;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("jobId") || searchParams.get("runId");

    if (!runId) {
      return NextResponse.json(
        { success: false, error: "Run ID required" },
        { status: 400 }
      );
    }

    const db = await getDbConnection();

    const runCheck = await db.query(
      `SELECT id FROM runs WHERE id = $1`,
      [parseInt(runId)]
    );
    if (runCheck.rows.length === 0) {
      return NextResponse.json({ success: true, logs: [], message: `Run ${runId} not found or no logs yet` });
    }

    const result = await db.query(
      `SELECT id, log_type as type, url, status, message, timing, timestamp 
       FROM job_logs 
       WHERE run_id = $1 
       ORDER BY timestamp ASC`,
      [parseInt(runId)]
    );

    const logs: LogEntry[] = result.rows.map((row: any) => ({
      id: row.id,
      type: row.type,
      url: row.url,
      status: row.status,
      message: row.message,
      timing: row.timing,
      timestamp: row.timestamp?.toISOString?.() || new Date(row.timestamp).toISOString(),
    }));

    return NextResponse.json({ success: true, logs });
  } catch (error) {
    console.error("[logs] GET error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch logs" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text().catch(() => "");
    const trimmed = raw?.trim() ?? "";
    if (!trimmed) return new Response(null, { status: 204 });
    let body: any;
    try { body = JSON.parse(trimmed); } catch { return new Response(null, { status: 204 }); }

    const runId = body?.jobId || body?.runId;
    const { log } = body ?? {};
    if (!runId || !log) return new Response(null, { status: 204 });

    const db = await getDbConnection();
    await db.query(
      `INSERT INTO job_logs (run_id, log_type, url, status, message, timing, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        parseInt(String(runId)),
        log.type,
        log.url || null,
        log.status || null,
        log.message || null,
        log.timing || null,
        log.timestamp ? new Date(log.timestamp) : new Date(),
      ]
    );

    return NextResponse.json({ success: true });
  } catch {
    return new Response(null, { status: 204 });
  }
}


