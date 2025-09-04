import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

// R2 cleanup helper function - moved outside to avoid scoping issues
async function deleteObjectsFromR2(r2Keys: string[]): Promise<boolean> {
  try {
    // Create R2 client
    const { S3Client, DeleteObjectsCommand } = await import(
      "@aws-sdk/client-s3"
    );

    const r2Client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT_URL,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });

    const bucketName = process.env.R2_BUCKET_NAME;
    if (!bucketName) {
      throw new Error("R2_BUCKET_NAME not configured");
    }

    // Delete objects in batches (S3 allows max 1000 per request)
    const batchSize = 1000;
    for (let i = 0; i < r2Keys.length; i += batchSize) {
      const batch = r2Keys.slice(i, i + batchSize);

      const deleteCommand = new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: batch.map((key) => ({ Key: key })),
          Quiet: true,
        },
      });

      await r2Client.send(deleteCommand);
      console.log(`Deleted batch of ${batch.length} objects from R2`);
    }

    return true;
  } catch (error) {
    console.error("R2 deletion error:", error);
    return false;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const body = await request.json();
    const {
      deleteFromDb = true,
      deleteFromR2 = true,
      deleteUsers = true,
    } = body;

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: "Job ID is required" },
        { status: 400 }
      );
    }

    const payload = await getPayload({ config });

    // Convert string ID to number if needed
    const sourceId = parseInt(jobId);
    if (isNaN(sourceId)) {
      return NextResponse.json(
        { success: false, error: "Invalid job ID format" },
        { status: 400 }
      );
    }

    console.log(`Attempting to delete source with ID: ${sourceId}, options:`, {
      deleteFromDb,
      deleteFromR2,
      deleteUsers,
    });

    // Get database connection for direct SQL queries
    const db = (payload.db as any).pool;

    // Delete from R2 if requested
    if (deleteFromR2) {
      try {
        // Get all R2 keys for this source to delete from R2
        const blocksToDelete = await db.query(
          `SELECT r2_key, image_url, video_url FROM blocks WHERE source_id = $1`,
          [sourceId]
        );

        if (blocksToDelete.rows.length > 0) {
          console.log(
            `Deleting ${blocksToDelete.rows.length} files from R2...`
          );

          // Extract all R2 keys and their variants (original, thumb, small, medium, large)
          const r2Keys: string[] = [];
          for (const row of blocksToDelete.rows) {
            const baseKey = row.r2_key as string | null;
            if (!baseKey) continue;
            r2Keys.push(baseKey);
            const slash = baseKey.lastIndexOf('/');
            const dot = baseKey.lastIndexOf('.');
            if (slash > 0 and dot > slash) {
              const basePath = baseKey.substring(0, slash + 1);
              const core = baseKey.substring(slash + 1, dot).replace(/^original_/, '');
              r2Keys.push(`${basePath}thumb_${core}.jpg`);
              r2Keys.push(`${basePath}small_${core}.jpg`);
              r2Keys.push(`${basePath}medium_${core}.jpg`);
              r2Keys.push(`${basePath}large_${core}.jpg`);
            }
          }

          // Actually delete from R2
          const uniqueKeys = Array.from(new Set(r2Keys));
          const deleteSuccess = await deleteObjectsFromR2(uniqueKeys);
          if (deleteSuccess) {
            console.log(`Successfully deleted ${r2Keys.length} files from R2`);
          } else {
            console.log(`R2 deletion completed with some errors`);
          }
        }
      } catch (r2Error) {
        console.error("R2 deletion error:", r2Error);
        // Continue with other deletions even if R2 fails
      }
    }

    // Delete users if requested
    if (deleteUsers) {
      try {
        // Delete user_blocks relationships for this source
        await db.query(
          `DELETE FROM user_blocks WHERE block_id IN (
            SELECT id FROM blocks WHERE source_id = $1
          )`,
          [sourceId]
        );

        // Delete orphaned savee_users (users with no remaining blocks)
        await db.query(
          `DELETE FROM savee_users WHERE id NOT IN (
            SELECT DISTINCT user_id FROM user_blocks
          )`
        );

        console.log(
          `Deleted user relationships and orphaned users for source ${sourceId}`
        );
      } catch (userError) {
        console.error("User deletion error:", userError);
        // Continue with other deletions
      }
    }

    // Delete from database if requested
    if (deleteFromDb) {
      try {
        await db.query('BEGIN');

        // Delete user_blocks first (if not already done above)
        if (!deleteUsers) {
          await db.query(
            `DELETE FROM user_blocks WHERE block_id IN (
              SELECT id FROM blocks WHERE source_id = $1
            )`,
            [sourceId]
          );
        }

        // Delete job logs (explicit)
        await db.query(
          `DELETE FROM job_logs WHERE run_id IN (SELECT id FROM runs WHERE source_id = $1)`,
          [sourceId]
        );

        // Delete blocks then runs then source (respect FKs)
        const delBlocks = await db.query(`DELETE FROM blocks WHERE source_id = $1`, [sourceId]);
        const delRuns = await db.query(`DELETE FROM runs WHERE source_id = $1`, [sourceId]);
        const delSource = await db.query(`DELETE FROM sources WHERE id = $1`, [sourceId]);

        await db.query('COMMIT');

        console.log(
          `Deleted source ${sourceId} (blocks=${delBlocks.rowCount}, runs=${delRuns.rowCount}, source=${delSource.rowCount})`
        );
      } catch (deleteError: unknown) {
        try { await db.query('ROLLBACK'); } catch {}
        console.error(`Database delete error:`, deleteError);
        throw deleteError;
      }
    }

    return NextResponse.json({
      success: true,
      message: "Job deleted successfully with selected options",
      deleted: { db: deleteFromDb, r2: deleteFromR2, users: deleteUsers },
    });
  } catch (error: unknown) {
    console.error("Error deleting job:", error);
    return NextResponse.json(
      {
        success: false,
        error: `Failed to delete job: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    let url: string | undefined;
    try {
      const body = await request.json();
      url = body?.url;
    } catch {
      url = undefined;
    }
    const payload = await getPayload({ config });

    // Update the source
    const data: any = {};
    if (typeof url === 'string' && url.trim()) data.url = url.trim();
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ success: false, error: "No changes provided" }, { status: 400 });
    }
    await payload.update({ collection: "sources", id: jobId, data });

    // Note: maxItems is typically stored per run, not per source

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating job:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update job" },
      { status: 500 }
    );
  }
}
