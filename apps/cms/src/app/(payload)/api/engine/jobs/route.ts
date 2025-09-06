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
  runStatus?: string;
  counters: {
    found: number;
    uploaded: number;
    errors: number;
    skipped?: number;
  };
  lastRun?: string;
  nextRun?: string;
  error?: string;
  origin?: string;
  intervalSeconds?: number; // explicit override stored on source
  disableBackoff?: boolean; // explicit setting stored on source
  effectiveIntervalSeconds?: number; // computed: override or global
  backoffMultiplier?: number; // computed from recent run outcomes
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

        // Backfill persisted filter fields on existing blocks (best-effort, lightweight)
        try {
          const db = (payload.db as any).pool;
          await db.query(
            `UPDATE blocks b
             SET origin_text = COALESCE(origin_text,
               CASE WHEN s.source_type = 'user' THEN s.username ELSE s.source_type END),
               saved_by_usernames = COALESCE(saved_by_usernames, sub.usernames)
             FROM sources s
             LEFT JOIN (
               SELECT ub.block_id, string_agg(u.username, ',') AS usernames
               FROM user_blocks ub
               JOIN savee_users u ON u.id = ub.user_id
               GROUP BY ub.block_id
             ) AS sub ON sub.block_id = b.id
             WHERE b.source_id = s.id AND b.source_id = $1`,
            [source.id]
          );
        } catch {}

        // Compute backoff multiplier similar to monitor
        let backoffMultiplier = 1;
        try {
          const recent = await payload.find({
            collection: "runs",
            where: { source: { equals: source.id } },
            limit: 3,
            sort: "-createdAt",
          });
          let errorCount = 0;
          let zeroUploadCount = 0;
          for (const r of recent.docs) {
            const st = String((r as any).status || "").toLowerCase();
            if (st === "error") errorCount += 1;
            try {
              const c =
                typeof (r as any).counters === "string"
                  ? JSON.parse((r as any).counters)
                  : (r as any).counters;
              if (c && Number(c.uploaded) === 0) zeroUploadCount += 1;
            } catch {}
          }
          backoffMultiplier = Math.max(
            1,
            Math.pow(2, errorCount) * (1 + zeroUploadCount)
          );
        } catch {}

        // Compute nextRun using source overrides when possible
        const envMin = parseInt(
          process.env.MONITOR_MIN_INTERVAL_SECONDS || String(1 * 60 * 60),
          10
        );
        const overrideInterval =
          typeof (source as any).intervalSeconds === "number"
            ? Math.max(10, (source as any).intervalSeconds)
            : null;
        const baseInterval = overrideInterval ?? envMin;
        const completedAtMs = latestRun?.completedAt
          ? new Date(latestRun.completedAt).getTime()
          : undefined;
        const nextRunIso = completedAtMs
          ? new Date(
              Math.max(completedAtMs + baseInterval * 1000, Date.now())
            ).toISOString()
          : undefined;

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
          counters:
            typeof latestRun?.counters === "string"
              ? (JSON.parse(latestRun.counters) as {
                  found: number;
                  uploaded: number;
                  errors: number;
                })
              : (latestRun?.counters as {
                  found: number;
                  uploaded: number;
                  errors: number;
                }) || { found: 0, uploaded: 0, errors: 0 },
          lastRun: latestRun?.completedAt || latestRun?.startedAt || undefined,
          nextRun: nextRunIso,
          // Echo schedule so UI can show/edit current values
          intervalSeconds: (source as any).intervalSeconds ?? undefined,
          disableBackoff: (source as any).disableBackoff ?? undefined,
          effectiveIntervalSeconds: baseInterval,
          backoffMultiplier,
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
