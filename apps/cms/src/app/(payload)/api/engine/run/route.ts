import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";
import { parseSaveeUrl } from "../../../../../lib/url-utils";
import { spawn } from "child_process";
import path from "path";

interface SourceData {
  url: string;
  sourceType: "home" | "pop" | "user";
  status: "active" | "paused" | "completed" | "error";
  username?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { url, maxItems, force: forceBody } = await request.json();

    if (!url) {
      return NextResponse.json(
        { success: false, error: "URL is required" },
        { status: 400 }
      );
    }

    const payload = await getPayload({ config });

    // External-runner mode toggle: do not spawn Python, just enqueue run
    const m = new URL(request.url);
    const modeParam = (m.searchParams.get("mode") || "").toLowerCase();
    const externalRunner =
      modeParam === "external" ||
      String(process.env.MONITOR_MODE || "").toLowerCase() === "external" ||
      String(process.env.EXTERNAL_RUNNER || "").toLowerCase() === "true" ||
      String(process.env.VERCEL || "") === "1"; // default external on Vercel

    // Capacity guard: check R2/DB limits unless forcing
    const urlObj = new URL(request.url);
    const forceParam = (urlObj.searchParams.get("force") || "").toLowerCase();
    const force = Boolean(forceBody) || forceParam === "1" || forceParam === "true";
    try {
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

    // Parse the URL to determine type and extract username
    const parsedUrl = parseSaveeUrl(url);

    if (!parsedUrl.isValid) {
      return NextResponse.json(
        { success: false, error: "Invalid savee.it URL" },
        { status: 400 }
      );
    }

    // Create or find source by URL. If same URL exists but with missing username, update it.
    const sources = await payload.find({
      collection: "sources",
      where: {
        url: { equals: url },
      },
      limit: 1,
    });

    let sourceId: number;

    if (sources.docs.length === 0) {
      const sourceData: SourceData = {
        url,
        sourceType: parsedUrl.sourceType,
        status: "active",
      };

      if (parsedUrl.username) {
        sourceData.username = parsedUrl.username;
      }

      const newSource = await payload.create({
        collection: "sources",
        data: sourceData,
      });
      sourceId = newSource.id;
    } else {
      sourceId = sources.docs[0].id;

      // Update username if provided and missing
      if (parsedUrl.username && !sources.docs[0].username) {
        await payload.update({
          collection: "sources",
          id: sourceId,
          data: { username: parsedUrl.username },
        });
      }
    }

    // Guard: if there's already an active run, do not start another
    const pool: any = (payload.db as any).pool;
    const existingActive = await pool.query(
      `SELECT id FROM runs WHERE source_id = $1 AND status IN ('running','paused','pending') ORDER BY created_at DESC LIMIT 1`,
      [sourceId]
    );
    if (existingActive.rows.length > 0) {
      return NextResponse.json(
        { success: false, error: "Run already active for this source" },
        { status: 409 }
      );
    }

    // Try to reuse the latest completed/error run for this source to avoid duplicates
    const reuse = await pool.query(
      `SELECT id FROM runs WHERE source_id = $1 AND status IN ('completed','error')
       ORDER BY created_at DESC LIMIT 1`,
      [sourceId]
    );
    let runId: number;
    if (reuse.rows.length > 0) {
      runId = reuse.rows[0].id as number;
      await pool.query(
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
      const created = await payload.create({
        collection: "runs",
        data: {
          source: sourceId,
          kind: "manual",
          maxItems: typeof maxItems === "number" && maxItems > 0 ? maxItems : 0,
          status: externalRunner ? "pending" : "running",
          counters: { found: 0, uploaded: 0, errors: 0 },
          startedAt: new Date().toISOString(),
        },
      });
      runId = created.id as number;
    }

    // In external-runner mode, do not spawn; return run details
    if (externalRunner) {
      // Attempt to trigger GH monitor workflow so user sees action immediately
      let dispatched = false;
      const dispatchLogs: Array<{ kind: string; status: number }> = [];
      try {
        const token =
          process.env.GITHUB_ACTIONS_TOKEN || process.env.GITHUB_DISPATCH_TOKEN;
        const repo = process.env.GITHUB_REPO; // owner/repo
        const ref = process.env.GITHUB_REF || "main";
        console.log(`[add_job] token=${!!token}, repo=${repo}, ref=${ref}`);
        if (token && repo) {
          // 1) repository_dispatch
          try {
            const resp = await fetch(
              `https://api.github.com/repos/${repo}/dispatches`,
              {
                method: "POST",
                headers: {
                  Authorization: `token ${token}`,
                  Accept: "application/vnd.github+json",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  event_type: "run_monitor",
                  client_payload: { sourceId: String(sourceId) },
                }),
              }
            );
            dispatchLogs.push({
              kind: "repository_dispatch",
              status: resp.status,
            });
            dispatched ||= resp.ok;
          } catch (e) {
            console.log(`[add_job] repository_dispatch error: ${e}`);
          }
          // 2) workflow_dispatch monitor.yml
          if (!dispatched) {
            try {
              const resp2 = await fetch(
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
                    inputs: { sourceId: String(sourceId) },
                  }),
                }
              );
              dispatchLogs.push({
                kind: "workflow_dispatch:monitor.yml",
                status: resp2.status,
              });
              dispatched ||= resp2.ok;
            } catch (e) {
              console.log(
                `[add_job] workflow_dispatch monitor.yml error: ${e}`
              );
            }
          }
          // 3) workflow_dispatch manual-monitor.yml
          if (!dispatched) {
            try {
              const resp3 = await fetch(
                `https://api.github.com/repos/${repo}/actions/workflows/manual-monitor.yml/dispatches`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `token ${token}`,
                    Accept: "application/vnd.github+json",
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    ref,
                    inputs: { sourceId: String(sourceId) },
                  }),
                }
              );
              dispatchLogs.push({
                kind: "workflow_dispatch:manual-monitor.yml",
                status: resp3.status,
              });
              dispatched ||= resp3.ok;
            } catch (e) {
              console.log(
                `[add_job] workflow_dispatch manual-monitor.yml error: ${e}`
              );
            }
          }
        }
      } catch (e) {
        console.log(`[add_job] dispatch error: ${e}`);
      }
      return NextResponse.json({
        success: true,
        runId,
        sourceType: parsedUrl.sourceType,
        username: parsedUrl.username,
        mode: "external",
        dispatched,
        message: dispatched
          ? "Run enqueued and monitor dispatched"
          : "Run enqueued as pending for external runner",
        debug: {
          hasToken: !!(
            process.env.GITHUB_ACTIONS_TOKEN ||
            process.env.GITHUB_DISPATCH_TOKEN
          ),
          hasRepo: !!process.env.GITHUB_REPO,
          ref: process.env.GITHUB_REF || "main",
          dispatchLogs,
        },
      });
    }

    // Start worker process (inline mode)
    const workerPath = path.resolve(process.cwd(), "../worker");
    console.log(`🚀 Starting worker for run ${runId} with URL: ${url}`);

    try {
      const pythonProcess = spawn(
        "python",
        [
          "-m",
          "app.cli",
          "--start-url",
          url,
          "--max-items",
          (typeof maxItems === "number" && maxItems > 0
            ? maxItems
            : 0
          ).toString(),
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

      // Log worker output
      pythonProcess.stdout?.on("data", (data) => {
        console.log(`Worker stdout: ${data}`);
      });

      pythonProcess.stderr?.on("data", (data) => {
        console.error(`Worker stderr: ${data}`);
      });

      pythonProcess.on("close", async (code) => {
        console.log(`Worker process exited with code ${code}`);
        try {
          await payload.update({
            collection: "runs",
            id: runId,
            data: {
              status: code === 0 ? "completed" : "error",
              completedAt: new Date().toISOString(),
              ...(code !== 0 && {
                errorMessage: `Worker exited with code ${code}`,
              }),
            },
          });
        } catch (error) {
          console.error("Failed to update run status:", error);
        }
      });

      // Run is already marked running above
    } catch (error) {
      console.error("Failed to start worker:", error);
      try {
        await payload.update({
          collection: "runs",
          id: runId,
          data: {
            status: "error",
            errorMessage: `Failed to start worker: ${error instanceof Error ? error.message : String(error)}`,
          },
        });
      } catch {}
    }

    return NextResponse.json({
      success: true,
      runId,
      sourceType: parsedUrl.sourceType,
      username: parsedUrl.username,
      message: `Job started successfully for ${parsedUrl.sourceType} content${
        parsedUrl.username ? ` from user ${parsedUrl.username}` : ""
      }`,
    });
  } catch (error) {
    console.error("Error starting job:", error);
    return NextResponse.json(
      { success: false, error: "Failed to start job" },
      { status: 500 }
    );
  }
}
