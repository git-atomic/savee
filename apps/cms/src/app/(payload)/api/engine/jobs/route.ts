import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

interface JobData {
  id: string;
  url: string;
  sourceType: "home" | "pop" | "user";
  username?: string;
  maxItems: number;
  status: "active" | "running" | "paused" | "error" | "completed";
  counters: {
    found: number;
    uploaded: number;
    errors: number;
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
          url: source.url,
          sourceType: source.sourceType as "home" | "pop" | "user",
          username: source.username || undefined,
          maxItems: latestRun?.maxItems || 50,
          status:
            latestRun?.status === "running"
              ? "running"
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
          counters: latestRun?.counters || { found: 0, uploaded: 0, errors: 0 },
          lastRun: latestRun?.completedAt || latestRun?.startedAt,
          nextRun: undefined, // TODO: Implement scheduling
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

// Delete job (source)
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const jobId = url.pathname.split("/").pop();

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: "Job ID required" },
        { status: 400 }
      );
    }

    const payload = await getPayload({ config });

    await payload.delete({
      collection: "sources",
      id: jobId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting job:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete job" },
      { status: 500 }
    );
  }
}
