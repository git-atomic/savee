import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";
import { spawn } from "child_process";
import path from "path";

async function getDbConnection() {
  console.log("[monitor] Getting payload instance...");
  const payload = await getPayload({ config });
  console.log("[monitor] Payload instance obtained, accessing DB pool...");
  const pool = (payload.db as any).pool;
  console.log("[monitor] DB pool accessed successfully");
  return pool;
}

async function startWorkerProcess(
  sourceId: number,
  runId: number,
  sourceUrl: string,
  maxItems: number,
  db: any
) {
  const workerPath = path.resolve(process.cwd(), "../worker");
  console.log(
    `🚀 [monitor] Starting worker for source ${sourceId}, run ${runId}`
  );

  const pythonProcess = spawn(
    "python",
    [
      "-m",
      "app.cli",
      "--start-url",
      sourceUrl,
      "--max-items",
      String(maxItems),
      "--run-id",
      String(runId),
    ],
    {
      cwd: workerPath,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      detached: false,
    }
  );

  pythonProcess.stdout?.on("data", (data) => {
    console.log(`Worker ${sourceId}/${runId} stdout: ${data}`);
  });
  pythonProcess.stderr?.on("data", (data) => {
    console.error(`Worker ${sourceId}/${runId} stderr: ${data}`);
  });

  // Mark run as running immediately
  await db.query(
    "UPDATE runs SET status = $1, started_at = COALESCE(started_at, $2), updated_at = now() WHERE id = $3",
    ["running", new Date(), runId]
  );

  pythonProcess.on("close", async (code) => {
    try {
      await db.query(
        `UPDATE runs SET status = $1, completed_at = $2, error_message = $3, updated_at = now()
         WHERE id = $4`,
        [
          code === 0 ? "completed" : "error",
          new Date(),
          code !== 0 ? `Exited ${code}` : null,
          runId,
        ]
      );
    } catch (e) {
      console.error("[monitor] Failed to finalize run status:", e);
    }
  });
}

function isAuthorized(req: NextRequest): boolean {
  const token = process.env.ENGINE_MONITOR_TOKEN;
  if (!token) return true; // no token set => allow (dev)
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  const provided = auth.slice(7).trim();
  return provided === token;
}

export async function POST(request: NextRequest) {
  console.log("[monitor] POST request received");
  try {
    if (!isAuthorized(request)) {
      console.log("[monitor] Authorization failed");
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    console.log("[monitor] Authorization passed");

    console.log("[monitor] Getting DB connection...");
    const db = await getDbConnection();
    console.log("[monitor] DB connection established");
    // Ensure per-source scheduling columns exist (no-op if present)
    try {
      await db.query(
        `ALTER TABLE sources 
         ADD COLUMN IF NOT EXISTS interval_seconds INTEGER,
         ADD COLUMN IF NOT EXISTS disable_backoff BOOLEAN DEFAULT FALSE`
      );
    } catch (e) {
      console.warn(
        "[monitor] Could not ensure schedule columns on sources:",
        e
      );
    }
    const requestedSourceId = (() => {
      try {
        const u = new URL(request.url);
        const sid = u.searchParams.get("sourceId");
        return sid ? parseInt(sid) : undefined;
      } catch {
        return undefined;
      }
    })();

    // Monitor options
    const url = new URL(request.url);
    const backfill = url.searchParams.get("backfill") === "true";
    // External-runner mode: when true, monitor will not spawn Python.
    // It will enqueue runs as 'pending' and return details in the response.
    const modeParam = (url.searchParams.get("mode") || "").toLowerCase();
    const externalRunner =
      modeParam === "external" ||
      String(process.env.MONITOR_MODE || "").toLowerCase() === "external" ||
      String(process.env.EXTERNAL_RUNNER || "").toLowerCase() === "true" ||
      String(process.env.VERCEL || "") === "1"; // default external on Vercel
    const body = await (async () => {
      try {
        return await request.json();
      } catch {
        return {} as any;
      }
    })();
    const bodyBackfill = (body as any)?.backfill === true;

    const minIntervalSec = parseInt(
      process.env.MONITOR_MIN_INTERVAL_SECONDS || String(3 * 60 * 60),
      10
    );
    const maxParallel = parseInt(process.env.MONITOR_MAX_PARALLEL || "4", 10);
    const maxIntervalSec = parseInt(
      process.env.MONITOR_MAX_INTERVAL_SECONDS || String(6 * 60 * 60),
      10
    );

    // Find all active sources (exclude 'blocks' as they are strictly one-off)
    const sourcesRes = await db.query(
      requestedSourceId
        ? `SELECT id, url, interval_seconds, disable_backoff FROM sources WHERE id = $1 AND status = 'active'`
        : `SELECT id, url, interval_seconds, disable_backoff FROM sources WHERE status = 'active' AND source_type != 'blocks' ORDER BY updated_at DESC LIMIT 200`,
      requestedSourceId ? [requestedSourceId] : []
    );

    const started: Array<{ sourceId: number; runId: number }> = [];
    const startedDetails: Array<{
      sourceId: number;
      runId: number;
      url: string;
      maxItems: number | null;
    }> = [];
    const skipped: Array<{ sourceId: number; reason: string }> = [];
    let startedCount = 0;

    for (const row of sourcesRes.rows as Array<{
      id: number;
      url: string;
      interval_seconds?: number | null;
      disable_backoff?: boolean;
    }>) {
      const sourceId = row.id;
      const url = row.url;
      const overrideIntervalSec =
        typeof row.interval_seconds === "number" &&
        !Number.isNaN(row.interval_seconds)
          ? Math.max(10, row.interval_seconds as number)
          : null;
      const backoffDisabled = Boolean(row.disable_backoff);

      // Skip if currently running/paused (cast enum to text; avoid LOWER on enum)
      const activeRun = await db.query(
        `SELECT id FROM runs WHERE source_id = $1 AND status IN ('running','paused','pending')
         ORDER BY created_at DESC LIMIT 1`,
        [sourceId]
      );
      if (activeRun.rows.length > 0) {
        skipped.push({ sourceId, reason: "already running/paused" });
        continue;
      }

      // Enforce dynamic interval since last completed run
      const lastCompleted = await db.query(
        `SELECT completed_at FROM runs 
         WHERE source_id = $1 AND completed_at IS NOT NULL
         ORDER BY completed_at DESC LIMIT 1`,
        [sourceId]
      );
      const lastCompletedAt: Date | null =
        lastCompleted.rows[0]?.completed_at || null;
      // Look at 3 most recent runs to compute error/zero-upload backoff
      const recentRuns = await db.query(
        `SELECT status, counters FROM runs 
         WHERE source_id = $1
         ORDER BY created_at DESC
         LIMIT 3`,
        [sourceId]
      );
      let errorCount = 0;
      let zeroUploadCount = 0;
      for (const r of recentRuns.rows as Array<{
        status: string;
        counters: any;
      }>) {
        if (String(r.status).toLowerCase() === "error") errorCount += 1;
        try {
          const c =
            typeof r.counters === "string"
              ? JSON.parse(r.counters)
              : r.counters;
          if (c && Number(c.uploaded) === 0) zeroUploadCount += 1;
        } catch {}
      }
      const baseIntervalSec = overrideIntervalSec ?? minIntervalSec;
      const backoffMult = backoffDisabled
        ? 1
        : Math.pow(2, errorCount) * (1 + zeroUploadCount);
      let dynamicIntervalSec = Math.min(
        maxIntervalSec,
        Math.max(baseIntervalSec, Math.floor(baseIntervalSec * backoffMult))
      );
      if (lastCompletedAt && !(backfill || bodyBackfill)) {
        const elapsedSec =
          (Date.now() - new Date(lastCompletedAt).getTime()) / 1000;
        if (elapsedSec < dynamicIntervalSec) {
          skipped.push({
            sourceId,
            reason: `interval ${Math.ceil(dynamicIntervalSec - elapsedSec)}s`,
          });
          continue;
        }
      }

      // Respect parallel cap per monitor tick
      if (startedCount >= maxParallel) {
        skipped.push({ sourceId, reason: "parallel cap" });
        continue;
      }

      // Determine max_items from last run
      const lastRun = await db.query(
        `SELECT max_items FROM runs WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [sourceId]
      );
      let maxItems = lastRun.rows[0]?.max_items ?? null;

      // Acquire short advisory lock to prevent duplicate starts for this source
      const lock = await db.query(
        `SELECT pg_try_advisory_lock($1, $2) AS got`,
        [424242, sourceId]
      );
      const got = Boolean(lock.rows?.[0]?.got);
      if (!got) {
        skipped.push({ sourceId, reason: "locked" });
        continue;
      }
      try {
        // Always create a fresh run per sweep to avoid counter reuse/mutations
        const kind = backfill || bodyBackfill ? "backfill" : "scheduled";
        const initialStatus = externalRunner ? "pending" : "running";
        const runIns = await db.query(
          `INSERT INTO runs (source_id, kind, max_items, status, counters, started_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            sourceId,
            kind,
            maxItems,
            initialStatus,
            JSON.stringify({ found: 0, uploaded: 0, errors: 0 }),
            new Date(),
          ]
        );
        const runId: number = runIns.rows[0].id as number;
        if (externalRunner) {
          // Do not spawn a worker here. Return details for an external runner to execute.
          started.push({ sourceId, runId });
          startedDetails.push({ sourceId, runId, url, maxItems });
          startedCount += 1;
        } else {
          await startWorkerProcess(sourceId, runId, url, maxItems ?? 0, db);
          started.push({ sourceId, runId });
          startedCount += 1;
        }
      } finally {
        // Always release the advisory lock
        await db.query(`SELECT pg_advisory_unlock($1, $2)`, [424242, sourceId]);
      }
    }

    return NextResponse.json({
      success: true,
      started,
      startedDetails,
      skipped,
      backfill: backfill || bodyBackfill,
      mode: externalRunner ? "external" : "inline",
    });
  } catch (error) {
    console.error("[monitor] Caught error:", error);
    console.error("[monitor] Error type:", typeof error);
    console.error("[monitor] Error constructor:", error?.constructor?.name);

    let message: string;
    if (error instanceof Error) {
      message = `${error.name}: ${error.message}`;
      if (error.stack) {
        console.error("[monitor] Stack trace:", error.stack);
      }
    } else {
      message = `Unknown error: ${String(error)}`;
    }

    console.error("[monitor] Returning error response:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
