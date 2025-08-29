import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

export async function DELETE(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = await params;
    
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

    console.log(`Attempting to delete source with ID: ${sourceId}`);

    // Delete related data in the correct order to avoid foreign key constraints
    try {
      // First delete all blocks for this source
      await payload.delete({
        collection: "blocks",
        where: {
          source: {
            equals: sourceId,
          },
        },
      });

      // Then delete all runs for this source  
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

      console.log(`Successfully deleted source ${sourceId} and all related data`);
    } catch (deleteError: any) {
      console.error(`Detailed delete error:`, deleteError);
      throw deleteError;
    }
    return NextResponse.json({ success: true, message: "Job deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting job:", error);
    return NextResponse.json(
      { success: false, error: `Failed to delete job: ${error.message}` },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params;
    const { url, maxItems } = await request.json();
    const payload = await getPayload({ config });

    // Update the source
    await payload.update({
      collection: "sources",
      id: jobId,
      data: { url, maxItems },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating job:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update job" },
      { status: 500 }
    );
  }
}
