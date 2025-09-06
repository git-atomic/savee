import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

async function isAuthorized(req: NextRequest): Promise<boolean> {
  // Check for external monitor token first (for GitHub Actions)
  const token = process.env.ENGINE_MONITOR_TOKEN;
  if (token) {
    const auth = req.headers.get("authorization") || "";
    if (auth.toLowerCase().startsWith("bearer ")) {
      const provided = auth.slice(7).trim();
      if (provided === token) return true;
    }
    try {
      const url = new URL(req.url);
      const t = url.searchParams.get("token");
      if (t && t === token) return true;
    } catch {}
  }
  
  // For admin panel access, check Payload session
  try {
    const payload = await getPayload({ config });
    const { user } = await payload.auth({ headers: req.headers });
    return !!user; // Allow any authenticated admin user
  } catch {
    return !token; // Allow unauthenticated access only if no token is set (dev mode)
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthorized(request))) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    const payload = await getPayload({ config });
    const db = (payload.db as any).pool;

    const q = async (sql: string, params: any[] = []) => {
      try {
        return await db.query(sql, params);
      } catch (e) {
        console.error("[metrics] query failed", sql, e);
        return { rows: [] } as any;
      }
    };

    const queued = await q(
      `SELECT COUNT(*)::int AS c FROM runs WHERE status = 'pending'`
    );
    const running = await q(
      `SELECT COUNT(*)::int AS c FROM runs WHERE status = 'running'`
    );
    const paused = await q(
      `SELECT COUNT(*)::int AS c FROM runs WHERE status = 'paused'`
    );
    const lastSuccess = await q(
      `SELECT MAX(completed_at) AS t FROM runs WHERE status = 'completed'`
    );
    const lastError = await q(
      `SELECT MAX(updated_at) AS t FROM runs WHERE status = 'error'`
    );

    const workerParallelism = parseInt(
      process.env.WORKER_PARALLELISM || "2",
      10
    );

    return NextResponse.json({
      success: true,
      queued: queued.rows?.[0]?.c ?? 0,
      running: running.rows?.[0]?.c ?? 0,
      paused: paused.rows?.[0]?.c ?? 0,
      lastSuccessAt: lastSuccess.rows?.[0]?.t ?? null,
      lastErrorAt: lastError.rows?.[0]?.t ?? null,
      workerParallelism: Number.isFinite(workerParallelism)
        ? workerParallelism
        : 2,
    });
  } catch (error) {
    console.error("[metrics] error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get metrics" },
      { status: 500 }
    );
  }
}
