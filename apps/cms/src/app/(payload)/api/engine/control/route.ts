import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";
import { spawn, spawnSync, ChildProcess } from "child_process";
import path from "path";

// Process tracking for pause/resume functionality
const runningProcesses = new Map<string, ChildProcess>();

// Database connection for direct SQL queries
async function getDbConnection() {
  const payload = await getPayload({ config });
  return (payload.db as any).pool; // Access the underlying database pool
}

// Helper function to start worker process with tracking
async function startWorkerProcess(
  jobId: string,
  runId: number,
  sourceUrl: string,
  maxItems: number,
  db: any
) {
  const workerPath = path.resolve(process.cwd(), "../worker");
  console.log(`🚀 Starting worker for run ${runId} with URL: ${sourceUrl}`);

  try {
    // Resolve a python executable robustly across platforms
    const candidates = [
      process.env.PYTHON,
      process.platform === "win32" ? "py" : undefined,
      "python",
      "python3",
    ].filter(Boolean) as string[];

    let pythonCmd = "python";
    for (const c of candidates) {
      try {
        const v = spawnSync(c, ["--version"], { stdio: "ignore" });
        if (v.status === 0 || v.signal === null) {
          pythonCmd = c;
          break;
        }
      } catch {}
    }
    console.log(`[engine] using Python executable: ${pythonCmd}`);

    const pythonProcess = spawn(
      pythonCmd,
      [
        "-m",
        "app.cli",
        "--start-url",
        sourceUrl,
        "--max-items",
        maxItems.toString(),
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

    // Track the process for pause/resume functionality
    runningProcesses.set(jobId, pythonProcess);

    // Log worker output
    pythonProcess.stdout?.on("data", (data) => {
      console.log(`Worker ${jobId} stdout: ${data}`);
    });

    pythonProcess.stderr?.on("data", (data) => {
      console.error(`Worker ${jobId} stderr: ${data}`);
    });

    // Handle spawn errors (e.g., python not found)
    pythonProcess.on("error", async (err) => {
      console.error(`Worker ${jobId} failed to start:`, err);
      runningProcesses.delete(jobId);
      try {
        await db.query(
          "UPDATE runs SET status = $1, error_message = $2, updated_at = now() WHERE id = $3",
          [
            "error",
            `Spawn error: ${err instanceof Error ? err.message : String(err)}`,
            runId,
          ]
        );
      } catch {}
    });

    pythonProcess.on("close", async (code) => {
      console.log(`Worker process for job ${jobId} exited with code ${code}`);

      // Remove from tracking
      runningProcesses.delete(jobId);

      try {
        // Update run status directly in database
        await db.query(
          `UPDATE runs SET status = $1, completed_at = $2, error_message = $3, updated_at = now() 
           WHERE id = $4`,
          [
            code === 0 ? "completed" : "error",
            new Date(),
            code !== 0 ? `Worker exited with code ${code}` : null,
            runId,
          ]
        );
      } catch (error) {
        console.error("Failed to update run status:", error);
      }
    });

    // Update run status to running
    await db.query(
      "UPDATE runs SET status = $1, started_at = $2, updated_at = now() WHERE id = $3",
      ["running", new Date(), runId]
    );

    return true;
  } catch (error) {
    console.error("Failed to start worker:", error);

    // Remove from tracking on failure
    runningProcesses.delete(jobId);

    // Update run status to error directly in database
    await db.query(
      "UPDATE runs SET status = $1, error_message = $2, updated_at = now() WHERE id = $3",
      [
        "error",
        `Failed to start worker: ${error instanceof Error ? error.message : String(error)}`,
        runId,
      ]
    );

    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}) as any);
    const jobId = (body as any)?.jobId;
    const action = (body as any)?.action;
    const newUrl = (body as any)?.newUrl;
    const newMaxItemsRaw = (body as any)?.newMaxItems;
    const force = Boolean((body as any)?.force);

    // Accept number, numeric string, or empty string (clear)
    let maxProvided = false;
    let newMaxItems: number | null = null;
    if (typeof newMaxItemsRaw === "number" && isFinite(newMaxItemsRaw)) {
      newMaxItems = Math.max(0, Math.floor(newMaxItemsRaw));
      maxProvided = true;
    } else if (typeof newMaxItemsRaw === "string") {
      const s = newMaxItemsRaw.trim();
      if (s === "") {
        newMaxItems = null;
        maxProvided = true;
      } else if (!Number.isNaN(Number(s))) {
        newMaxItems = Math.max(0, Math.floor(Number(s)));
        maxProvided = true;
      }
    }

    if (!jobId || !action) {
      return NextResponse.json(
        { success: false, error: "Job ID and action are required" },
        { status: 400 }
      );
    }

    // Get database connection for direct updates
    const db = await getDbConnection();

    // Helper: trigger GitHub Actions monitor workflow
    async function triggerGithubMonitor(sourceId?: string): Promise<boolean> {
      try {
        const token =
          process.env.GITHUB_ACTIONS_TOKEN || process.env.GITHUB_DISPATCH_TOKEN;
        const repo = process.env.GITHUB_REPO; // e.g., "git-atomic/savee"
        const ref = process.env.GITHUB_REF || "main";
        if (!token || !repo) return false;
        // Prefer repository_dispatch to avoid workflow file name mismatch
        const url = `https://api.github.com/repos/${repo}/dispatches`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            event_type: "run_monitor",
            client_payload: { sourceId: sourceId || jobId },
          }),
        });
        if (res.ok) return true;
        // Fallback: workflow_dispatch
        const wd = await fetch(
          `https://api.github.com/repos/${repo}/actions/workflows/monitor.yml/dispatches`,
          {
            method: "POST",
            headers: {
              Authorization: `token ${token}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ref,
              inputs: { sourceId: String(sourceId || jobId) },
            }),
          }
        );
        return wd.ok;
      } catch {
        return false;
      }
    }

    switch (action) {
      case "stop": {
        const sourceId = parseInt(jobId);
        // Attempt to kill any tracked worker process
        try {
          const proc = runningProcesses.get(jobId);
          if (proc && !proc.killed) {
            try {
              proc.kill("SIGTERM");
            } catch {}
            runningProcesses.delete(jobId);
          }
        } catch {}

        // Mark latest active run as completed with stop reason
        try {
          const active = await db.query(
            `SELECT id FROM runs WHERE source_id = $1 AND status IN ('running','paused','pending')
             ORDER BY created_at DESC LIMIT 1`,
            [sourceId]
          );
          if (active.rows.length > 0) {
            const rid = active.rows[0].id as number;
            await db.query(
              `UPDATE runs SET status = 'completed', completed_at = now(), error_message = $1, updated_at = now() WHERE id = $2`,
              ["Stopped by user", rid]
            );
          }
        } catch (e) {
          console.warn("stop: failed to mark run completed", e);
        }

        // Update source status to stopped so UI reflects stopped
        try {
          await db.query(
            "UPDATE sources SET status = $1, updated_at = now() WHERE id = $2",
            ["stopped", sourceId]
          );
        } catch {}

        return NextResponse.json({ success: true, jobId, message: "Job stopped" });
      }
      case "pause":
        // Immediate UI feedback: mark latest running run paused
        await db.query(
          `UPDATE runs SET status = 'paused', updated_at = now()
           WHERE id = (
             SELECT id FROM runs WHERE source_id = $1 AND status = 'running'
             ORDER BY created_at DESC LIMIT 1
           )`,
          [parseInt(jobId)]
        );

        // Update source status to paused so worker will gracefully stop after current block
        await db.query(
          "UPDATE sources SET status = $1, updated_at = now() WHERE id = $2",
          ["paused", parseInt(jobId)]
        );

        console.log(
          `🛑 Pause requested for job ${jobId} - UI paused immediately; worker will finish current block`
        );
        break;

      case "resume":
        // Update source status directly in database - the paused worker will detect this and continue
        await db.query(
          "UPDATE sources SET status = $1, updated_at = now() WHERE id = $2",
          ["active", parseInt(jobId)]
        );

        // Flip latest paused run back to running so UI updates instantly
        await db.query(
          `UPDATE runs SET status = 'running', updated_at = now()
           WHERE id = (
             SELECT id FROM runs WHERE source_id = $1 AND status = 'paused'
             ORDER BY created_at DESC LIMIT 1
           )`,
          [parseInt(jobId)]
        );

        console.log(
          `▶️ Resume requested for job ${jobId} - paused worker will continue from next block`
        );
        break;

      case "run_now": {
        const sourceId = parseInt(jobId);
        let runId: number | undefined;
        // Get source details directly from database
        const sourceResult = await db.query(
          "SELECT id, url, source_type, username, status FROM sources WHERE id = $1",
          [sourceId]
        );

        if (sourceResult.rows.length === 0) {
          return NextResponse.json(
            { success: false, error: "Source not found" },
            { status: 404 }
          );
        }

        const source = sourceResult.rows[0];

        // Reconstruct a workable URL if missing, and normalize
        let effectiveUrl: string | null = (source.url as string) || null;
        if (!effectiveUrl) {
          const st = String(source.source_type || "").toLowerCase();
          const un = source.username as string | null;
          if (st === "home") effectiveUrl = "https://savee.com/";
          else if (st === "pop") effectiveUrl = "https://savee.com/pop/";
          else if (st === "user" && un)
            effectiveUrl = `https://savee.com/${un}/`;
        }
        if (effectiveUrl) {
          // Prepend scheme if missing
          if (!/^https?:\/\//i.test(effectiveUrl)) {
            effectiveUrl = `https://${effectiveUrl.replace(/^\/+/, "")}`;
          }
        }
        if (source.status === "disabled") {
          return NextResponse.json(
            { success: false, error: "Source is disabled" },
            { status: 400 }
          );
        }
        if (!effectiveUrl) {
          return NextResponse.json(
            { success: false, error: "No usable URL for this source" },
            { status: 400 }
          );
        }
        // Log but do not block on strict validation; worker can handle
        try {
          const u = String(effectiveUrl).trim();
          if (!/savee\.(?:it|com)\//i.test(u)) {
            console.warn(
              `[run_now] non-standard URL for source ${sourceId}: ${u}`
            );
          }
        } catch {}

        // Check if there's already a running/paused/pending run in DB
        const activeRun = await db.query(
          `SELECT id, status FROM runs WHERE source_id = $1 AND status IN ('running','paused','pending')
             ORDER BY created_at DESC LIMIT 1`,
          [sourceId]
        );
        if (activeRun.rows.length > 0) {
          const existing = activeRun.rows[0];
          const existingStatus = existing.status as string;
          console.log(
            `[run_now] found existing ${existingStatus} run for source ${sourceId}`
          );
          // Reuse pending; if running/paused and not forcing, return idempotent success
          if (existingStatus === "pending") {
            console.log(
              `[run_now] reusing existing pending run ${existing.id}`
            );
            runId = existing.id;
          } else if (
            (existingStatus === "running" || existingStatus === "paused") &&
            !force
          ) {
            return NextResponse.json(
              {
                success: true,
                jobId,
                runId: existing.id,
                status: existingStatus,
                message: `Run already ${existingStatus} for this source`,
              },
              { status: 200 }
            );
          } else if (force) {
            // Best-effort cancel of current run to allow a fresh start
            try {
              const proc = runningProcesses.get(jobId);
              if (proc && !proc.killed) {
                try {
                  proc.kill("SIGTERM");
                } catch {}
                runningProcesses.delete(jobId);
              }
              await db.query(
                `UPDATE runs SET status = 'completed', completed_at = now(), error_message = $1, updated_at = now()
                 WHERE id = $2`,
                ["Force run requested - previous run cancelled", existing.id]
              );
            } catch (e) {
              console.warn("force-cancel failed", e);
            }
          }
        }
        // Also check tracked processes (best-effort)
        if (runningProcesses.has(jobId)) {
          return NextResponse.json(
            {
              success: true,
              jobId,
              status: "running",
              message: "Job is already running",
              processInfo: {
                pid: runningProcesses.get(jobId)?.pid,
                killed: runningProcesses.get(jobId)?.killed,
              },
            },
            { status: 200 }
          );
        }

        // Capacity guard: check R2/DB limits unless forcing
        try {
          // Build absolute origin for server-side fetch to avoid relative URL issues
          const reqUrl = new URL(request.url);
          const origin = `${reqUrl.protocol}//${reqUrl.host}`;
          const limitsRes = await fetch(`${origin}/api/engine/limits`, {
            cache: "no-store",
          });
          if (limitsRes.ok) {
            const limits = await limitsRes.json();
            const nearR2 = !!limits?.r2?.nearLimit;
            const nearDb = !!limits?.db?.nearLimit;
            if ((nearR2 || nearDb) && !force) {
              return NextResponse.json(
                {
                  success: false,
                  error: "Capacity near limits",
                  details: { r2: limits?.r2, db: limits?.db },
                  hint: "Pass force:true to override",
                },
                { status: 429 }
              );
            }
          }
        } catch {}

        // Attempt to start without advisory locks; we already guard on run status
        // and tracked processes. This avoids sticky 423s when connections die.
        try {
          // Get latest run to derive maxItems
          const runsResult = await db.query(
            "SELECT max_items FROM runs WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1",
            [sourceId]
          );
          const maxItemsRaw = runsResult.rows[0]?.max_items ?? null;
          const maxItems = maxItemsRaw == null ? 0 : Number(maxItemsRaw);

          // Only create new run if we don't have a pending one already
          if (!runId) {
            // Reuse latest completed/error run if possible
            const reuse = await db.query(
              `SELECT id FROM runs WHERE source_id = $1 AND status IN ('completed','error')
                   ORDER BY created_at DESC LIMIT 1`,
              [sourceId]
            );
            const externalRunner =
              String(process.env.MONITOR_MODE || "").toLowerCase() ===
                "external" ||
              String(process.env.EXTERNAL_RUNNER || "").toLowerCase() ===
                "true" ||
              String(process.env.VERCEL || "") === "1";

            if (reuse.rows.length > 0) {
              runId = reuse.rows[0].id as number;
              await db.query(
                `UPDATE runs SET status = $1, counters = $2, started_at = $3, completed_at = NULL, error_message = NULL, updated_at = now()
                     WHERE id = $4`,
                [
                  externalRunner ? "pending" : "running",
                  JSON.stringify({ found: 0, uploaded: 0, errors: 0 }),
                  new Date(),
                  runId,
                ]
              );
            } else {
              const runResult = await db.query(
                `INSERT INTO runs (source_id, kind, max_items, status, counters, started_at)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     RETURNING id`,
                [
                  sourceId,
                  "manual",
                  maxItems,
                  externalRunner ? "pending" : "running",
                  JSON.stringify({ found: 0, uploaded: 0, errors: 0 }),
                  new Date(),
                ]
              );
              runId = runResult.rows[0].id as number;
            }
          }

          const externalRunner =
            String(process.env.MONITOR_MODE || "").toLowerCase() ===
              "external" ||
            String(process.env.EXTERNAL_RUNNER || "").toLowerCase() ===
              "true" ||
            String(process.env.VERCEL || "") === "1";

          if (externalRunner) {
            // Do not spawn; return run details for external runner
            const dispatched = await triggerGithubMonitor(String(sourceId));
            const hasToken = !!(
              process.env.GITHUB_ACTIONS_TOKEN ||
              process.env.GITHUB_DISPATCH_TOKEN
            );
            const repoName = process.env.GITHUB_REPO || "";
            const refName = process.env.GITHUB_REF || "main";
            console.log(
              `[run_now] dispatched=${dispatched}, token=${hasToken}, repo=${!!repoName}`
            );
            return NextResponse.json({
              success: true,
              jobId,
              runId,
              mode: "external",
              dispatched,
              message: dispatched
                ? "Run enqueued and monitor dispatched"
                : "Run enqueued as pending for external runner",
              debug: { hasToken, hasRepo: !!repoName, ref: refName },
            });
          }

          // Start worker process using helper function (inline mode)
          const started = await startWorkerProcess(
            jobId,
            runId,
            effectiveUrl,
            maxItems ?? 0,
            db
          );

          if (!started) {
            return NextResponse.json(
              { success: false, error: "Failed to start worker process" },
              { status: 500 }
            );
          }
        } finally {
          // no-op
        }
        break;
      }

      case "status":
        // Get process status for debugging
        const isRunning = runningProcesses.has(jobId);
        const processInfo = isRunning
          ? {
              pid: runningProcesses.get(jobId)?.pid,
              killed: runningProcesses.get(jobId)?.killed,
            }
          : null;

        return NextResponse.json({
          success: true,
          jobId,
          isRunning,
          processInfo,
          totalRunningProcesses: runningProcesses.size,
          message: `Job ${jobId} process status retrieved`,
        });

      case "edit": {
        const normalizedUrl = (newUrl || "").trim();
        const onlyUpdateMax = !normalizedUrl && maxProvided;
        if (!normalizedUrl && !onlyUpdateMax) {
          return NextResponse.json(
            { success: false, error: "Provide newUrl or newMaxItems" },
            { status: 400 }
          );
        }

        // Detect type of the edited URL (home | pop | user)
        const srcType = (() => {
          try {
            const m = normalizedUrl
              .toLowerCase()
              .match(/savee\.(?:it|com)\/(.+)/);
            const seg = m?.[1] || "";
            if (!seg || seg === "" || seg === "/") return "home";
            if (seg.startsWith("pop")) return "pop";
            return "user";
          } catch {
            return "user";
          }
        })();

        let targetSourceId = parseInt(jobId);
        if (!onlyUpdateMax) {
          // Freeze the old source so its runs/blocks remain unchanged
          await db.query(
            "UPDATE sources SET status = 'completed', updated_at = now() WHERE id = $1",
            [parseInt(jobId)]
          );

          // Create a new source for the edited URL/type
          const newUsername =
            srcType === "user"
              ? normalizedUrl.split("/").filter(Boolean).slice(-1)[0]
              : null;
          const newSourceRes = await db.query(
            `INSERT INTO sources (url, source_type, username, status, created_at, updated_at)
             VALUES ($1, $2, $3, 'active', now(), now()) RETURNING id`,
            [normalizedUrl, srcType, newUsername]
          );
          targetSourceId = newSourceRes.rows[0].id as number;
        }

        // Attempt to kill any running process to avoid overlap
        const proc = runningProcesses.get(jobId);
        if (proc && !proc.killed) {
          try {
            proc.kill("SIGTERM");
          } catch {}
          runningProcesses.delete(jobId);
        }

        // Mark any running/paused run as completed for clean restart
        await db.query(
          `UPDATE runs SET status = 'completed', completed_at = now(), updated_at = now()
           WHERE source_id = $1 AND status IN ('running','paused')`,
          [parseInt(jobId)]
        );

        // Create a fresh run using the most recent max_items (default 50)
        const runsResult2 = await db.query(
          "SELECT max_items FROM runs WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1",
          [onlyUpdateMax ? parseInt(jobId) : targetSourceId]
        );
        const baseMax = runsResult2.rows[0]?.max_items ?? null;
        const maxItems2 = maxProvided ? newMaxItems : baseMax;
        const normalizedMaxItems = maxItems2 == null ? 0 : Number(maxItems2);

        const runResult2 = await db.query(
          `INSERT INTO runs (source_id, kind, max_items, status, counters, started_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            targetSourceId,
            "manual",
            normalizedMaxItems,
            "pending",
            JSON.stringify({ found: 0, uploaded: 0, errors: 0 }),
            new Date(),
          ]
        );

        const runId2 = runResult2.rows[0].id;

        // Start worker with the updated URL
        const started2 = await startWorkerProcess(
          String(targetSourceId),
          runId2,
          onlyUpdateMax
            ? await (async () => {
                const res = await db.query(
                  "SELECT url FROM sources WHERE id = $1",
                  [targetSourceId]
                );
                return res.rows[0]?.url as string;
              })()
            : normalizedUrl,
          normalizedMaxItems,
          db
        );
        if (!started2) {
          return NextResponse.json(
            { success: false, error: "Failed to start worker process" },
            { status: 500 }
          );
        }
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: "Invalid action" },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      message: `Job ${action} executed successfully`,
    });
  } catch (error) {
    console.error("Error controlling job:", error);
    return NextResponse.json(
      { success: false, error: "Failed to control job" },
      { status: 500 }
    );
  }
}
