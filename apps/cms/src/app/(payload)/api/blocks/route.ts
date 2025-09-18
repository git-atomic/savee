import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

export async function GET(req: NextRequest) {
  try {
    const payload = await getPayload({ config });
    const { searchParams } = new URL(req.url);

    // Parse query parameters
    const externalId = searchParams.get("externalId");
    const origin = searchParams.get("origin"); // 'home', 'pop', 'user'
    const username = searchParams.get("username");
    const sourceId = searchParams.get("sourceId");
    const runId = searchParams.get("runId");
    const q = searchParams.get("q");
    const limitParam = searchParams.get("limit");
    const mode = (searchParams.get("mode") || "").toLowerCase(); // "events" => one row per origin occurrence
    const cursor = searchParams.get("cursor");

    const rawLimit = (() => {
      const lp = (limitParam || "").trim().toLowerCase();
      if (lp === "all" || lp === "*") return 1000; // safety cap
      const n = parseInt(limitParam || "20", 10);
      if (!Number.isFinite(n) || n <= 0) return 20;
      return n;
    })();
    const limit = Math.min(rawLimit, 1000);

    // Parse cursor for pagination
    let cursorSavedAt: string | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      try {
        const parsed = JSON.parse(Buffer.from(cursor, "base64").toString());
        cursorSavedAt = parsed.saved_at;
        cursorId = parsed.id;
      } catch (e) {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
    }

    const params: any[] = [];
    const blockWhere: string[] = [];

    // Filters that apply to blocks themselves
    if (externalId) {
      blockWhere.push("b.external_id = $" + (params.length + 1));
      params.push(externalId);
    }
    if (q && q.trim().length > 1) {
      const like = `%${q.trim()}%`;
      blockWhere.push(
        `(b.title ILIKE $${params.length + 1} OR b.og_title ILIKE $${
          params.length + 1
        } OR b.og_description ILIKE $${params.length + 1})`
      );
      params.push(like);
    }
    if (cursorSavedAt && cursorId) {
      params.push(cursorSavedAt);
      params.push(cursorId);
      blockWhere.push(
        `(b.saved_at < $${params.length - 1} OR (b.saved_at = $${
          params.length - 1
        } AND b.id < $${params.length}))`
      );
    }

    // NEW APPROACH: Use EXISTS to find blocks that INCLUDE the requested origin
    let originFilter = "";
    if (origin === "home" || origin === "pop") {
      params.push(origin);
      originFilter = `
        AND EXISTS (
          SELECT 1 FROM block_sources bs_filter
          JOIN sources s_filter ON s_filter.id = bs_filter.source_id
          WHERE bs_filter.block_id = b.id AND s_filter.source_type::text = $${params.length}
        )`;
    } else if (origin === "user" && username) {
      params.push("user");
      params.push(username);
      originFilter = `
        AND EXISTS (
          SELECT 1 FROM block_sources bs_filter
          JOIN sources s_filter ON s_filter.id = bs_filter.source_id
          WHERE bs_filter.block_id = b.id 
          AND s_filter.source_type::text = $${params.length - 1}
          AND s_filter.username = $${params.length}
        )`;
    }

    // Additional filters
    if (sourceId) {
      params.push(parseInt(sourceId));
      originFilter += ` AND EXISTS (
        SELECT 1 FROM block_sources bs_src WHERE bs_src.block_id = b.id AND bs_src.source_id = $${params.length}
      )`;
    }
    if (runId) {
      params.push(parseInt(runId));
      originFilter += ` AND EXISTS (
        SELECT 1 FROM block_sources bs_run WHERE bs_run.block_id = b.id AND bs_run.run_id = $${params.length}
      )`;
    }

    const blockWhereSQL = blockWhere.length
      ? `WHERE ${blockWhere.join(" AND ")}`
      : "";

    // Build WHERE safely to avoid leading AND
    const normalizedBlock = blockWhereSQL.replace(/^\s*WHERE\s+/i, "").trim();
    const normalizedOrigin = originFilter.replace(/^\s*AND\s+/i, "").trim();
    const whereParts = [normalizedBlock, normalizedOrigin].filter(Boolean);
    const whereSQL = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    // MODE A: unique blocks (default)
    let query = `
      SELECT 
        b.*, 
        '${origin || "mixed"}' as origin,
        NULL as source_username,
        (
          WITH users_union AS (
            SELECT s2b.username AS uname
            FROM block_sources bs2b JOIN sources s2b ON s2b.id = bs2b.source_id
            WHERE bs2b.block_id = b.id AND s2b.source_type::text = 'user' AND s2b.username IS NOT NULL
            UNION
            SELECT u.username AS uname FROM user_blocks ub JOIN savee_users u ON u.id = ub.user_id WHERE ub.block_id = b.id
          )
          SELECT jsonb_build_object(
            'home', COALESCE((
              SELECT BOOL_OR(s2a.source_type::text = 'home')
              FROM block_sources bs2a JOIN sources s2a ON s2a.id = bs2a.source_id
              WHERE bs2a.block_id = b.id
            ), false),
            'pop', COALESCE((
              SELECT BOOL_OR(s2p.source_type::text = 'pop')
              FROM block_sources bs2p JOIN sources s2p ON s2p.id = bs2p.source_id
              WHERE bs2p.block_id = b.id
            ), false),
            'users', COALESCE((SELECT jsonb_agg(DISTINCT uname) FROM users_union), '[]'::jsonb),
            'users_count', COALESCE((SELECT COUNT(DISTINCT uname)::int FROM users_union), 0),
            'tags', COALESCE((
              SELECT jsonb_agg(DISTINCT tag)
              FROM (
                SELECT CASE WHEN s2c.source_type::text = 'user' THEN s2c.username ELSE s2c.source_type::text END AS tag
                FROM block_sources bs2c JOIN sources s2c ON s2c.id = bs2c.source_id WHERE bs2c.block_id = b.id
                UNION
                SELECT uname AS tag FROM users_union
              ) tag_src
            ), '[]'::jsonb)
          )
        ) AS origin_map
      FROM blocks b
      ${whereSQL}
      ORDER BY b.saved_at DESC NULLS LAST, b.created_at DESC NULLS LAST
      LIMIT $${params.length + 1}
    `;

    // MODE B: events view (one row per origin occurrence in block_sources)
    if (mode === "events") {
      // Build events WHERE based on origin/user filters
      const evWhere: string[] = [];
      if (origin === "home" || origin === "pop") {
        params.push(origin);
        evWhere.push(`s.source_type::text = $${params.length}`);
      } else if (origin === "user" && username) {
        params.push("user");
        params.push(username);
        evWhere.push(`s.source_type::text = $${params.length - 1}`);
        evWhere.push(`s.username = $${params.length}`);
      }
      if (sourceId) {
        params.push(parseInt(sourceId));
        evWhere.push(`bs.source_id = $${params.length}`);
      }
      if (runId) {
        params.push(parseInt(runId));
        evWhere.push(`bs.run_id = $${params.length}`);
      }
      const evWhereSQL = evWhere.length ? `WHERE ${evWhere.join(" AND ")}` : "";

      query = `
        SELECT 
          b.*, 
          s.source_type::text AS origin,
          s.username AS source_username,
          jsonb_build_object(
            'home', (s.source_type::text = 'home'),
            'pop', (s.source_type::text = 'pop'),
            'users', CASE WHEN s.source_type::text = 'user' AND s.username IS NOT NULL THEN jsonb_build_array(s.username) ELSE '[]'::jsonb END,
            'users_count', CASE WHEN s.source_type::text = 'user' AND s.username IS NOT NULL THEN 1 ELSE 0 END,
            'tags', CASE WHEN s.source_type::text = 'user' AND s.username IS NOT NULL THEN jsonb_build_array(s.username) ELSE jsonb_build_array(s.source_type::text) END
          ) AS origin_map,
          bs.saved_at AS appeared_at,
          bs.run_id AS appeared_run_id
        FROM block_sources bs
        JOIN blocks b ON b.id = bs.block_id
        JOIN sources s ON s.id = bs.source_id
        ${evWhereSQL}
        ORDER BY bs.saved_at DESC NULLS LAST, b.created_at DESC NULLS LAST
        LIMIT $${params.length + 1}
      `;
    }
    params.push(limit);

    console.log("Blocks API Query:", query);
    console.log("Blocks API Params:", params);

    const result = await payload.db.pool.query(query, params);
    const blocks = result.rows;

    let nextCursor: string | null = null;
    if (blocks.length === limit) {
      const lastBlock = blocks[blocks.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({
          saved_at: lastBlock.saved_at,
          id: lastBlock.id,
        })
      ).toString("base64");
    }

    return NextResponse.json({
      success: true,
      blocks,
      nextCursor,
      count: blocks.length,
      filters: { origin, username, sourceId, runId, q },
    });
  } catch (error) {
    console.error("Error in /api/blocks:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
