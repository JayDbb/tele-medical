import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/app/_lib/supabase/server";
import { getVisitById } from "@/app/_lib/db/drizzle/queries/visit";
import { listFiles } from "@/app/_lib/storage";
import { getAudioStorageBucket } from "@/app/_lib/storage/config";

export const runtime = "nodejs";

const CHUNKS_BUCKET = getAudioStorageBucket();

/**
 * Verify how many chunks are uploaded for a recording session
 * Used to ensure all chunks are uploaded before finalization
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ visitId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session || (session.role !== "doctor" && session.role !== "nurse")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { visitId } = await params;
    const { searchParams } = new URL(request.url);
    const recordingSessionId = searchParams.get("sessionId");

    if (!recordingSessionId) {
      return NextResponse.json(
        { error: "recordingSessionId is required" },
        { status: 400 }
      );
    }

    // Verify visit and assignment
    const visit = await getVisitById(visitId);
    if (!visit || visit.clinicianId !== session.id) {
      return NextResponse.json(
        { error: "Not authorized for this visit" },
        { status: 403 }
      );
    }

    // Compute session path in Supabase Storage
    const sessionPath = `chunks/${visitId}/${recordingSessionId}`;

    // List all chunk files in the session directory
    const files = await listFiles(CHUNKS_BUCKET, sessionPath);

    if (!files || files.length === 0) {
      return NextResponse.json({
        chunkCount: 0,
        chunks: [],
      });
    }

    // Filter and sort chunk files
    const chunkFiles = files
      .filter((f) => f.name.startsWith("chunk-"))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Extract chunk indices for debugging
    const chunkIndices = chunkFiles.map((f) => {
      const match = f.name.match(/chunk-(\d+)/);
      return match ? parseInt(match[1], 10) : -1;
    }).filter(idx => idx >= 0).sort((a, b) => a - b);

    return NextResponse.json({
      chunkCount: chunkFiles.length,
      chunks: chunkIndices,
      message: `Found ${chunkFiles.length} chunks`,
    });
  } catch (error) {
    console.error("Error verifying chunks:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to verify chunks",
      },
      { status: 500 }
    );
  }
}
