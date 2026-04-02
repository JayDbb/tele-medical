import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/app/_lib/supabase/server";
import { getVisitById } from "@/app/_lib/db/drizzle/queries/visit";
import { uploadFile } from "@/app/_lib/storage";
import { getAudioStorageBucket } from "@/app/_lib/storage/config";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for longer uploads

const CHUNKS_BUCKET = getAudioStorageBucket();
// Supabase Free plan has 50MB file size limit
// Individual chunks should be small, but we'll check
const MAX_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB per chunk (well under 50MB limit)

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ visitId: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session || (session.role !== "doctor" && session.role !== "nurse")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { visitId } = await params;
    const formData = await request.formData();

    const chunk = formData.get("chunk") as File;
    const chunkIndex = parseInt(formData.get("chunkIndex") as string);
    const recordingSessionId = formData.get("recordingSessionId") as string;
    const mimeType = formData.get("mimeType") as string;

    if (!chunk || chunkIndex === undefined || !recordingSessionId) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: chunk, chunkIndex, recordingSessionId",
        },
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

    // Check chunk size before processing
    if (chunk.size > MAX_CHUNK_SIZE) {
      console.error("Chunk size exceeds limit", {
        chunkIndex,
        size: chunk.size,
        maxSize: MAX_CHUNK_SIZE,
      });
      return NextResponse.json(
        {
          error: `Chunk size (${(chunk.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (${(MAX_CHUNK_SIZE / 1024 / 1024).toFixed(2)}MB)`,
        },
        { status: 400 }
      );
    }

    // Store chunk in Supabase Storage
    // Path structure: chunks/{visitId}/{recordingSessionId}/chunk-000000
    const chunkFileName = `chunk-${chunkIndex.toString().padStart(6, "0")}`;
    const storagePath = `chunks/${visitId}/${recordingSessionId}/${chunkFileName}`;

    const arrayBuffer = await chunk.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload chunk to Supabase Storage
    try {
      await uploadFile(CHUNKS_BUCKET, storagePath, buffer, {
        contentType: mimeType || "application/octet-stream",
        upsert: false, // Don't overwrite existing chunks
      });
    } catch (uploadError) {
      // Check if it's a size limit error
      const errorMessage =
        uploadError instanceof Error ? uploadError.message : String(uploadError);
      if (
        errorMessage.includes("size") ||
        errorMessage.includes("limit") ||
        errorMessage.includes("50")
      ) {
        console.error("Supabase storage size limit error", {
          chunkIndex,
          size: buffer.length,
          error: errorMessage,
        });
        return NextResponse.json(
          {
            error: `Upload failed: File size limit exceeded. Supabase Free plan has a 50MB limit per file. Consider upgrading your plan or reducing recording quality.`,
            chunkIndex,
            size: buffer.length,
          },
          { status: 413 } // 413 Payload Too Large
        );
      }
      throw uploadError; // Re-throw if it's not a size error
    }

    return NextResponse.json({
      success: true,
      chunkIndex,
      message: "Chunk uploaded successfully",
    });
  } catch (error) {
    console.error("Error uploading chunk:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to upload chunk",
      },
      { status: 500 }
    );
  }
}
