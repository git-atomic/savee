import { NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

interface JobData {
  id: string;
  runId?: string; // Run ID for fetching logs
  url: string;
  sourceType: "home" | "pop" | "user";
  username?: string;
  maxItems: number;
  status: "active" | "running" | "paused" | "error" | "completed";
  counters: {
    found: number;
    uploaded: number;
    errors: number;
    skipped?: number;
  };
  lastRun?: string;
  nextRun?: string;
  error?: string;
}

export async function GET() {
  try {
    const payload = await getPayload({ config });

    // Get sources with their latest runs
    const sources = await payload.find({
      collection: "sources",
      limit: 100,
      sort: "-createdAt",
    });

    const jobs: JobData[] = await Promise.all(
      sources.docs.map(async (source) => {
        // Get latest run for this source
        const runs = await payload.find({
          collection: "runs",
          where: {
            source: { equals: source.id },
          },
          limit: 1,
          sort: "-createdAt",
        });

        const latestRun = runs.docs[0];

        return {
          id: source.id.toString(),
          runId: latestRun?.id?.toString(), // Add run ID for logs
          url: source.url,
          sourceType: source.sourceType as "home" | "pop" | "user",
          username: source.username || undefined,
          maxItems: (typeof latestRun?.maxItems === "number"
            ? latestRun?.maxItems
            : null) as any,
          origin: (source.sourceType === "user"
            ? source.username || "user"
            : source.sourceType) as string,
          status:
            latestRun?.status === "running"
              ? "running"
              : (source.status as
                    | "active"
                    | "running"
                    | "paused"
                    | "error"
                    | "completed") === "paused"
                ? "paused"
                : latestRun?.status === "error"
                  ? "error"
                  : latestRun?.status === "completed"
                    ? "active"
                    : (source.status as
                        | "active"
                        | "running"
                        | "paused"
                        | "error"
                        | "completed"),
          runStatus: latestRun?.status as string, // Add separate run status for pause badge
          counters: (() => {
            // Show the exact counters from the latest run without modification
            const raw =
              typeof latestRun?.counters === "string"
                ? JSON.parse(latestRun.counters)
                : latestRun?.counters || {
                    found: 0,
                    uploaded: 0,
                    errors: 0,
                    skipped: 0,
                  };
            return {
              found: Number(raw.found || 0),
              uploaded: Number(raw.uploaded || 0),
              errors: Number(raw.errors || 0),
              skipped: Number(raw.skipped || 0),
            };
          })(),
          lastRun: latestRun?.completedAt || latestRun?.startedAt || undefined,
          nextRun: (() => {
            const minIntervalSec = parseInt(
              process.env.MONITOR_MIN_INTERVAL_SECONDS || "60",
              10
            );
            const maxIntervalSec = parseInt(
              process.env.MONITOR_MAX_INTERVAL_SECONDS || "900",
              10
            );
            const completed = latestRun?.completedAt
              ? new Date(latestRun.completedAt).getTime()
              : undefined;
            if (!completed) return undefined;
            // Backoff using recent runs
            const now = Date.now();
            const base = completed + minIntervalSec * 1000;
            const next = new Date(
              Math.min(
                base + 0,
                now + minIntervalSec * 1000,
                completed + maxIntervalSec * 1000
              )
            );
            return next.toISOString();
          })(),
          error: latestRun?.errorMessage || undefined,
        };
      })
    );

    return NextResponse.json({ success: true, jobs });
  } catch (error) {
    console.error("Error fetching jobs:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}
