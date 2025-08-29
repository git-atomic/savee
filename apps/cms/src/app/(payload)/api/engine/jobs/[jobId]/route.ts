import { NextRequest, NextResponse } from "next/server";
import { getPayload } from "payload";
import config from "@payload-config";

export async function DELETE(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params;
    const payload = await getPayload({ config });

    // Delete the source (which will cascade delete runs and blocks)
    await payload.delete({
      collection: "sources",
      id: jobId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting job:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete job" },
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
