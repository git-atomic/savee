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

    // Create or find source
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

    // Create run (maxItems belongs here now)
    const run = await payload.create({
      collection: "runs",
      data: {
        source: sourceId,
        kind: "manual",
        maxItems: maxItems || 50,
        status: "pending",
        counters: { found: 0, uploaded: 0, errors: 0 },
        startedAt: new Date().toISOString(),
      },
    });

    // Start worker process
    const workerPath = path.resolve(process.cwd(), "../worker");
    console.log(`🚀 Starting worker for run ${run.id} with URL: ${url}`);

    try {
      const pythonProcess = spawn(
        "python",
        [
          "-m",
          "app.cli",
          "--start-url",
          url,
          "--max-items",
          (maxItems || 50).toString(),
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
            id: run.id,
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

      // Update run status to running
      await payload.update({
        collection: "runs",
        id: run.id,
        data: {
          status: "running",
          startedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Failed to start worker:", error);
      await payload.update({
        collection: "runs",
        id: run.id,
        data: {
          status: "error",
          errorMessage: `Failed to start worker: ${error.message}`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      runId: run.id,
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
