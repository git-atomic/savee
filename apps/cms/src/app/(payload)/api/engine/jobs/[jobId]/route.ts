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
          `SELECT r2_key FROM blocks WHERE source_id = $1`,
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
            const slash = baseKey.lastIndexOf("/");
            const dot = baseKey.lastIndexOf(".");
            if (slash > 0 && dot > slash) {
              const basePath = baseKey.substring(0, slash + 1);
              let core = baseKey.substring(slash + 1, dot);
              // Normalize core by stripping known prefixes
              core = core.replace(/^original_/, "").replace(/^video_/, "");
              // image variants
              r2Keys.push(`${basePath}thumb_${core}.jpg`);
              r2Keys.push(`${basePath}small_${core}.jpg`);
              r2Keys.push(`${basePath}medium_${core}.jpg`);
              r2Keys.push(`${basePath}large_${core}.jpg`);
              // video poster variant if original was video
              if (baseKey.includes(`/video_`) || baseKey.endsWith(`.mp4`)) {
                r2Keys.push(`${basePath}poster_${core}.jpg`);
              }
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

        // Collect avatar keys for users that will be deleted by this operation
        const orphanAvatars = await db.query(
          `SELECT su.avatar_r2_key FROM savee_users su
           WHERE su.avatar_r2_key IS NOT NULL AND su.id IN (
             SELECT su2.id FROM savee_users su2
             LEFT JOIN user_blocks ub2 ON ub2.user_id = su2.id
             WHERE ub2.user_id IS NULL
           )`
        );

        // Delete orphaned savee_users (no relationships left)
        await db.query(
          `DELETE FROM savee_users su
           WHERE NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE ub.user_id = su.id)`
        );

        // Delete their avatar objects from R2
        if (deleteFromR2 && orphanAvatars.rows.length > 0) {
          const avatarKeys = orphanAvatars.rows
            .map((r: any) => r.avatar_r2_key as string)
            .filter(Boolean);
          if (avatarKeys.length > 0) {
            try {
              await deleteObjectsFromR2(avatarKeys);
            } catch (e) {
              console.warn("Failed to delete orphan avatar keys from R2", e);
            }
          }
        }

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
        await db.query("BEGIN");

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
        // Before deleting blocks, record their external_ids to tombstone table
        const tombstones = await db.query(
          `INSERT INTO deleted_blocks (external_id, source_id)
           SELECT external_id, source_id FROM blocks WHERE source_id = $1
           ON CONFLICT (external_id) DO UPDATE SET source_id = EXCLUDED.source_id, deleted_at = now()`,
          [sourceId]
        );
        const delBlocks = await db.query(
          `DELETE FROM blocks WHERE source_id = $1`,
          [sourceId]
        );
        const delRuns = await db.query(
          `DELETE FROM runs WHERE source_id = $1`,
          [sourceId]
        );
        const delSource = await db.query(`DELETE FROM sources WHERE id = $1`, [
          sourceId,
        ]);

        await db.query("COMMIT");

        console.log(
          `Deleted source ${sourceId} (blocks=${delBlocks.rowCount}, runs=${delRuns.rowCount}, source=${delSource.rowCount})`
        );
      } catch (deleteError: unknown) {
        try {
          await db.query("ROLLBACK");
        } catch {}
        console.error(`Database delete error:`, deleteError);
        throw deleteError;
      }
    }

    // Ensure the Payload document is removed from CMS as well
    try {
      await payload.delete({ collection: "sources", id: String(jobId) });
    } catch (e) {
      // It's fine if it was already removed via SQL; ignore
      console.warn("Payload source delete (best-effort) warning:", e as any);
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
    let intervalSeconds: number | null | undefined;
    let disableBackoff: boolean | undefined;
    try {
      const body = await request.json();
      url = body?.url;
      if (typeof body?.intervalSeconds === "number")
        intervalSeconds = body.intervalSeconds;
      else if (body?.intervalSeconds === null) intervalSeconds = null;
      if (typeof body?.disableBackoff === "boolean")
        disableBackoff = body.disableBackoff;
    } catch {
      url = undefined;
    }
    const payload = await getPayload({ config });

    // Update the source
    const data: any = {};
    if (typeof url === "string" && url.trim()) data.url = url.trim();
    if (intervalSeconds === null) data.intervalSeconds = null;
    else if (
      typeof intervalSeconds === "number" &&
      !Number.isNaN(intervalSeconds)
    )
      data.intervalSeconds = Math.max(10, intervalSeconds);
    if (typeof disableBackoff === "boolean")
      data.disableBackoff = disableBackoff;
    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { success: false, error: "No changes provided" },
        { status: 400 }
      );
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
