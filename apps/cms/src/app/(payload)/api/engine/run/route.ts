import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";
import { parseSaveeUrl } from "@/lib/url-utils";
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
    const { url, maxItems } = await request.json();

    if (!url) {
      return NextResponse.json(
        { success: false, error: "URL is required" },
        { status: 400 }
      );
    }

    const payload = await getPayload({ config });

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
        `UPDATE runs SET status = 'running', counters = $1, started_at = $2, completed_at = NULL, error_message = NULL, updated_at = now()
         WHERE id = $3`,
        [
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
          status: "running",
          counters: { found: 0, uploaded: 0, errors: 0 },
          startedAt: new Date().toISOString(),
        },
      });
      runId = created.id as number;
    }

    // Start worker process
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
