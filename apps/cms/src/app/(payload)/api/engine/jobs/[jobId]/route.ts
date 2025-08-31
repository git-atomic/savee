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
          "SELECT r2_key FROM blocks WHERE source_id = $1 AND r2_key IS NOT NULL",
          [sourceId]
        );

        if (blocksToDelete.rows.length > 0) {
          console.log(
            `Deleting ${blocksToDelete.rows.length} files from R2...`
          );

          // Extract all R2 keys and their variants (original, thumb, small, medium, large)
          const r2Keys: string[] = [];
          for (const row of blocksToDelete.rows) {
            const baseKey = row.r2_key;
            r2Keys.push(baseKey); // original file

            // Add all possible resized variants
            const basePath = baseKey.substring(0, baseKey.lastIndexOf("/") + 1);
            const fileName = baseKey.substring(baseKey.lastIndexOf("/") + 1);
            const nameWithoutExt = fileName.substring(
              0,
              fileName.lastIndexOf(".")
            );
            // Most originals are saved as: original_<hash>.<ext>; variants are thumb_<hash>.jpg, etc.
            const coreName = nameWithoutExt.startsWith("original_")
              ? nameWithoutExt.slice("original_".length)
              : nameWithoutExt;

            // Add variants: thumb, small, medium, large
            r2Keys.push(`${basePath}thumb_${coreName}.jpg`);
            r2Keys.push(`${basePath}small_${coreName}.jpg`);
            r2Keys.push(`${basePath}medium_${coreName}.jpg`);
            r2Keys.push(`${basePath}large_${coreName}.jpg`);
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
        // Delete related data in the correct order to avoid foreign key constraints

        // Delete user_blocks first (if not already done above)
        if (!deleteUsers) {
          await db.query(
            `DELETE FROM user_blocks WHERE block_id IN (
              SELECT id FROM blocks WHERE source_id = $1
            )`,
            [sourceId]
          );
        }

        // Delete job logs (cascade delete will handle this, but explicit is better)
        await db.query(
          "DELETE FROM job_logs WHERE run_id IN (SELECT id FROM runs WHERE source_id = $1)",
          [sourceId]
        );

        // Delete blocks
        await payload.delete({
          collection: "blocks",
          where: {
            source: {
              equals: sourceId,
            },
          },
        });

        // Delete runs
        await payload.delete({
          collection: "runs",
          where: {
            source: {
              equals: sourceId,
            },
          },
        });

        // Finally delete the source itself
        await payload.delete({
          collection: "sources",
          id: sourceId,
        });

        console.log(`Successfully deleted source ${sourceId} from database`);
      } catch (deleteError: unknown) {
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
    const { url } = await request.json();
    const payload = await getPayload({ config });

    // Update the source
    await payload.update({
      collection: "sources",
      id: jobId,
      data: { url },
    });

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
