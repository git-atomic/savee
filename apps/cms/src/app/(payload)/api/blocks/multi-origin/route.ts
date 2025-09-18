import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);

    const payload = await getPayload({ config });
    const db = (payload.db as any).pool;

    // Get blocks with their multi-origin data pre-aggregated
    const query = `
      SELECT 
        b.*,
        COALESCE(
          jsonb_agg(
            DISTINCT CASE 
              WHEN s.source_type = 'home' THEN 'home'
              WHEN s.source_type = 'pop' THEN 'pop'
              WHEN s.source_type = 'user' THEN s.username
              ELSE s.source_type
            END
          ) FILTER (WHERE s.source_type IS NOT NULL),
          '[]'::jsonb
        ) as origins
      FROM blocks b
      LEFT JOIN block_sources bs ON bs.block_id = b.id
      LEFT JOIN sources s ON s.id = bs.source_id
      GROUP BY b.id
      ORDER BY b.id DESC
      LIMIT $1
    `;

    const res = await db.query(query, [limit]);

    return NextResponse.json({
      success: true,
      blocks: res.rows.map((block) => ({
        ...block,
        origins: Array.isArray(block.origins)
          ? block.origins.filter(Boolean)
          : [],
      })),
      count: res.rows.length,
    });
  } catch (error) {
    console.error("Multi-origin blocks API error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

