import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

export async function POST(_req: NextRequest) {
  try {
    const payload = await getPayload({ config });
    const db = (payload.db as any).pool;

    // Get all source types and their IDs
    const sourcesRes = await db.query(`
      SELECT id, source_type, username FROM sources 
      ORDER BY source_type, username
    `);

    const sources = sourcesRes.rows;
    const homeSource = sources.find((s) => s.source_type === "home");
    const popSource = sources.find((s) => s.source_type === "pop");
    const userSources = sources.filter((s) => s.source_type === "user");

    if (!homeSource || !popSource) {
      return NextResponse.json({
        success: false,
        error: "Missing home or pop source",
      });
    }

    // Get a valid run_id
    const runRes = await db.query(
      `SELECT id FROM runs ORDER BY id DESC LIMIT 1`
    );
    const validRunId = runRes.rows[0]?.id || 1;

    // Get all blocks
    const blocksRes = await db.query(
      `SELECT id, external_id FROM blocks ORDER BY id`
    );

    let insertedCount = 0;
    let processed = 0;

    console.log(
      `Processing ${blocksRes.rows.length} blocks for multi-origin relations...`
    );

    // For demonstration, let's simulate that:
    // - All blocks appear in home
    // - 30% appear in pop
    // - 40% appear in random user collections
    for (const block of blocksRes.rows) {
      processed++;

      try {
        // Always add to home
        await db.query(
          `
          INSERT INTO block_sources (block_id, source_id, run_id, saved_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (block_id, source_id) DO NOTHING
        `,
          [block.id, homeSource.id, validRunId]
        );

        // 30% chance to add to pop
        if (Math.random() < 0.3) {
          await db.query(
            `
            INSERT INTO block_sources (block_id, source_id, run_id, saved_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (block_id, source_id) DO NOTHING
          `,
            [block.id, popSource.id, validRunId]
          );
        }

        // 40% chance to add to 1-2 random users
        if (Math.random() < 0.4 && userSources.length > 0) {
          const numUsers = Math.random() < 0.5 ? 1 : 2;
          const shuffled = [...userSources].sort(() => 0.5 - Math.random());

          for (let i = 0; i < Math.min(numUsers, shuffled.length); i++) {
            await db.query(
              `
              INSERT INTO block_sources (block_id, source_id, run_id, saved_at)
              VALUES ($1, $2, $3, NOW())
              ON CONFLICT (block_id, source_id) DO NOTHING
            `,
              [block.id, shuffled[i].id, validRunId]
            );
          }
        }

        insertedCount++;

        if (processed % 50 === 0) {
          console.log(
            `Processed ${processed}/${blocksRes.rows.length} blocks...`
          );
        }
      } catch (err) {
        console.error(`Error processing block ${block.external_id}:`, err);
      }
    }

    // Get updated stats
    const statsRes = await db.query(`
      SELECT s.source_type, COUNT(*) as count
      FROM block_sources bs
      JOIN sources s ON s.id = bs.source_id
      GROUP BY s.source_type
      ORDER BY s.source_type
    `);

    return NextResponse.json({
      success: true,
      processed: blocksRes.rows.length,
      populated: insertedCount,
      stats: statsRes.rows,
      message: "Multi-origin relations populated successfully",
    });
  } catch (error) {
    console.error("Populate origins error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}

