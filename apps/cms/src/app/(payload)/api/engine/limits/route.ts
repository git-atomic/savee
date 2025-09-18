import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getPayload } from "payload";
import config from "@payload-config";

export const runtime = "nodejs";
export const revalidate = 0;
export const dynamic = "force-dynamic";

async function getDbStats() {
  const payload = await getPayload({ config });
  const db = (payload.db as any).pool;
  const q = async (sql: string, params: any[] = []) => {
    try {
      return await db.query(sql, params);
    } catch (e) {
      console.error("[limits] DB query failed", sql, e);
      return { rows: [] } as any;
    }
  };
  const blocks = await q("SELECT COUNT(*)::int AS c FROM blocks");
  const sources = await q("SELECT COUNT(*)::int AS c FROM sources");
  const runs = await q("SELECT COUNT(*)::int AS c FROM runs");
  return {
    blocks: blocks.rows?.[0]?.c ?? 0,
    sources: sources.rows?.[0]?.c ?? 0,
    runs: runs.rows?.[0]?.c ?? 0,
  };
}

async function getR2Stats() {
  const endpoint = process.env.R2_ENDPOINT_URL;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    return { totalObjects: 0, totalSizeBytes: 0, usagePercent: 0 };
  }
  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  let continuationToken: string | undefined = undefined;
  let totalObjects = 0;
  let totalSizeBytes = 0;
  let safety = 0;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
    );
    const contents = resp.Contents || [];
    for (const obj of contents) {
      totalObjects += 1;
      totalSizeBytes += obj.Size || 0;
    }
    continuationToken = resp.IsTruncated
      ? (resp.NextContinuationToken as string | undefined)
      : undefined;
    safety += 1;
  } while (continuationToken && safety < 1000);
  const tenGb = 10 * 1024 * 1024 * 1024;
  const usagePercent = Math.min(100, (totalSizeBytes / tenGb) * 100);
  return { totalObjects, totalSizeBytes, usagePercent };
}

export async function GET(req: NextRequest) {
  try {
    const db = await getDbStats();
    const r2 = await getR2Stats();
    // Soft quotas (tunable via env)
    const r2SoftGb = Number(process.env.R2_SOFT_LIMIT_GB || 9.5);
    const dbSoftBlocks = Number(process.env.DB_SOFT_LIMIT_BLOCKS || 100000);
    const r2LimitBytes = r2SoftGb * 1024 * 1024 * 1024;
    const r2NearLimit = r2.totalSizeBytes >= r2LimitBytes;
    const dbNearLimit = db.blocks >= dbSoftBlocks;
    return NextResponse.json({
      success: true,
      r2: {
        totalObjects: r2.totalObjects,
        totalSizeBytes: r2.totalSizeBytes,
        usagePercent: r2.usagePercent,
        softLimitGb: r2SoftGb,
        nearLimit: r2NearLimit,
      },
      db: {
        blocks: db.blocks,
        sources: db.sources,
        runs: db.runs,
        softLimitBlocks: dbSoftBlocks,
        nearLimit: dbNearLimit,
      },
    });
  } catch (e) {
    console.error("[limits] error", e);
    return NextResponse.json(
      { success: false, error: String(e) },
      { status: 500 }
    );
  }
}
