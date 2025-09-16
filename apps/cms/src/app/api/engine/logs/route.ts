import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";
import { publish } from "@/lib/sse";

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

async function ensureLogsTable(db: any) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS job_logs (
      id SERIAL PRIMARY KEY,
      run_id INTEGER NOT NULL,
      log_type VARCHAR(32) NOT NULL,
      url TEXT NULL,
      status VARCHAR(8) NULL,
      message TEXT NULL,
      timing VARCHAR(32) NULL,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS job_logs_run_id_idx ON job_logs(run_id)`
  );
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

    await ensureLogsTable(db);

    const runCheck = await db.query(`SELECT id FROM runs WHERE id = $1`, [
      parseInt(runId),
    ]);
    if (runCheck.rows.length === 0) {
      return NextResponse.json({
        success: true,
        logs: [],
        message: `Run ${runId} not found or no logs yet`,
      });
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
      timestamp:
        row.timestamp?.toISOString?.() || new Date(row.timestamp).toISOString(),
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
    try {
      body = JSON.parse(trimmed);
    } catch {
      return new Response(null, { status: 204 });
    }

    const runId = body?.jobId || body?.runId;
    const { log } = body ?? {};
    if (!runId || !log) return new Response(null, { status: 204 });

    const db = await getDbConnection();
    await ensureLogsTable(db);
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

    // Broadcast to SSE subscribers for instant UI updates
    try {
      publish(String(runId), "log", {
        timestamp: log.timestamp || new Date().toISOString(),
        type: log.type,
        url: log.url,
        status: log.status,
        timing: log.timing,
        message: log.message,
      });
    } catch {}

    return NextResponse.json({ success: true });
  } catch {
    return new Response(null, { status: 204 });
  }
}
