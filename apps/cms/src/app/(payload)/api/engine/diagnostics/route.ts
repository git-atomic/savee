import { NextRequest, NextResponse } from "next/server";

function isAuthorized(req: NextRequest): boolean {
  const token = process.env.ENGINE_MONITOR_TOKEN;
  if (!token) return true; // allow in dev if not set
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const provided = auth.slice(7).trim();
    if (provided === token) return true;
  }
  try {
    const url = new URL(req.url);
    const t = url.searchParams.get("token");
    if (t && t === token) return true;
  } catch {}
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  const env = process.env;
  const reqInt = (key: string, def?: number) => {
    const v = env[key];
    const n = v ? parseInt(v, 10) : def;
    return Number.isFinite(n as number) ? (n as number) : undefined;
  };
  return NextResponse.json({
    success: true,
    checks: {
      DATABASE_URL: Boolean(env.DATABASE_URL || env.DATABASE_URI),
      R2_ENDPOINT_URL: Boolean(env.R2_ENDPOINT_URL),
      R2_ACCESS_KEY_ID: Boolean(env.R2_ACCESS_KEY_ID),
      R2_SECRET_ACCESS_KEY: Boolean(env.R2_SECRET_ACCESS_KEY),
      R2_BUCKET_NAME: Boolean(env.R2_BUCKET_NAME),
      ENGINE_MONITOR_TOKEN: Boolean(env.ENGINE_MONITOR_TOKEN),
      CORS_ORIGINS: Boolean(env.CORS_ORIGINS),
      MONITOR_MIN_INTERVAL_SECONDS: reqInt(
        "MONITOR_MIN_INTERVAL_SECONDS",
        10800
      ),
      MONITOR_MAX_INTERVAL_SECONDS: reqInt(
        "MONITOR_MAX_INTERVAL_SECONDS",
        21600
      ),
      WORKER_PARALLELISM: reqInt("WORKER_PARALLELISM", 2),
    },
  });
}
