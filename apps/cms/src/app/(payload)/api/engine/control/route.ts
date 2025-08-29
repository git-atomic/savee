import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";
import { spawn } from "child_process";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const { jobId, action } = await request.json();

    if (!jobId || !action) {
      return NextResponse.json(
        { success: false, error: "Job ID and action are required" },
        { status: 400 }
      );
    }

    const payload = await getPayload({ config });

    switch (action) {
      case "pause":
        await payload.update({
          collection: "sources",
          id: jobId,
          data: { status: "paused" },
        });
        break;

      case "resume":
        await payload.update({
          collection: "sources",
          id: jobId,
          data: { status: "active" },
        });
        break;

      case "run_now":
        // Get source details
        const source = await payload.findByID({
          collection: "sources",
          id: jobId,
        });

        if (!source) {
          return NextResponse.json(
            { success: false, error: "Source not found" },
            { status: 404 }
          );
        }

        // Get latest run to get maxItems
        const runs = await payload.find({
          collection: "runs",
          where: { source: { equals: jobId } },
          limit: 1,
          sort: "-createdAt",
        });

        const maxItems = runs.docs[0]?.maxItems || 50;

        // Create new run
        const run = await payload.create({
          collection: "runs",
          data: {
            source: jobId,
            kind: "manual",
            maxItems,
            status: "pending",
            counters: { found: 0, uploaded: 0, errors: 0 },
            startedAt: new Date().toISOString(),
          },
        });

        // Start worker process
        const workerPath = path.resolve(process.cwd(), "../worker");
        console.log(
          `🚀 Starting worker for run ${run.id} with URL: ${source.url}`
        );

        try {
          const pythonProcess = spawn(
            "python",
            [
              "-m",
              "app.cli",
              "--start-url",
              source.url,
              "--max-items",
              maxItems.toString(),
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
        break;

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
