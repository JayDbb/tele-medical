import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/app/_lib/supabase/server";
import { getVisitById } from "@/app/_lib/db/drizzle/queries/visit";
import {
  uploadFile,
  listFiles,
  downloadFile,
  deleteFiles,
} from "@/app/_lib/storage";
import {
  saveTranscriptAction,
  updateVisitDraftAction,
} from "@/app/_actions/visits";
import type { VisitNote } from "@/app/_lib/visit-note/schema";

export const runtime = "nodejs";

const CHUNKS_BUCKET = "telehealth_audio";

/**
 * Cleanup helper: Delete all chunks for a session from Supabase Storage
 * Never throws - logs warnings on failure
 */
async function cleanupSessionChunks(
  bucket: string,
  sessionPath: string
): Promise<void> {
  try {
    console.log("Starting cleanup for session chunks", { bucket, sessionPath });

    // List all files in the session directory
    const files = await listFiles(bucket, sessionPath);
    console.log("Found files to delete", {
      count: files?.length,
      files: files?.map((f) => f.name),
    });

    if (files && files.length > 0) {
      // Delete all chunk files
      // Construct full paths for deletion
      const pathsToDelete = files.map((file) => {
        // Ensure path doesn't have double slashes
        const cleanPath = sessionPath.replace(/\/$/, ""); // Remove trailing slash
        const cleanFileName = file.name.replace(/^\//, ""); // Remove leading slash from filename
        return `${cleanPath}/${cleanFileName}`;
      });

      console.log("Deleting chunk files", {
        bucket,
        paths: pathsToDelete,
        count: pathsToDelete.length,
      });

      try {
        await deleteFiles(bucket, pathsToDelete);
        console.log("Successfully deleted chunk files", {
          count: pathsToDelete.length,
        });
      } catch (deleteError) {
        console.error("Error calling deleteFiles", {
          error: deleteError,
          bucket,
          paths: pathsToDelete,
        });
        throw deleteError; // Re-throw to be caught by outer catch
      }
    } else {
      console.log("No files found to delete", { sessionPath });
    }
  } catch (error) {
    console.error("Cleanup failed for session chunks", {
      sessionPath,
      error,
      bucket,
    });
  }
}

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
    const body = await request.json();
    const { recordingSessionId } = body;

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
    // Path structure: chunks/{visitId}/{recordingSessionId}/
    const sessionPath = `chunks/${visitId}/${recordingSessionId}`;

    // Wrap entire pipeline in try/finally to ensure cleanup
    try {
      // List all chunk files in the session directory
      const files = await listFiles(CHUNKS_BUCKET, sessionPath);

      if (!files || files.length === 0) {
        console.warn("No chunks found for session", { sessionPath, recordingSessionId });
        // Return success but with a message indicating no audio was recorded
        return NextResponse.json({
          success: true,
          transcript: null,
          parsedNote: null,
          audioPath: null,
          message: "No audio chunks were recorded. The recording may have been too short or no audio was captured.",
        });
      }

      // Filter and sort chunk files
      const chunkFiles = files
        .filter((f) => f.name.startsWith("chunk-"))
        .sort((a, b) => a.name.localeCompare(b.name));

      // Extract chunk indices for logging
      const chunkIndices = chunkFiles.map((f) => {
        const match = f.name.match(/chunk-(\d+)/);
        return match ? parseInt(match[1], 10) : -1;
      }).filter(idx => idx >= 0).sort((a, b) => a - b);

      console.log("Chunks found for finalization", {
        sessionPath,
        recordingSessionId,
        totalChunks: chunkFiles.length,
        chunkIndices: chunkIndices.slice(0, 10), // First 10 for logging
        hasGaps: chunkIndices.length > 0 && chunkIndices[chunkIndices.length - 1] - chunkIndices[0] + 1 !== chunkIndices.length,
      });

      if (chunkFiles.length === 0) {
        console.warn("No valid chunk files found for session", { sessionPath, recordingSessionId, files: files.map(f => f.name) });
        // Return success but with a message indicating no valid chunks
        return NextResponse.json({
          success: true,
          transcript: null,
          parsedNote: null,
          audioPath: null,
          message: "No valid audio chunks were found. The recording may have been incomplete.",
        });
      }

      // Download and assemble chunks into single buffer
      const chunks: Buffer[] = [];
      for (const chunkFile of chunkFiles) {
        const chunkPath = `${sessionPath}/${chunkFile.name}`;
        const chunkData = await downloadFile(CHUNKS_BUCKET, chunkPath);
        chunks.push(chunkData);
      }
      const finalBuffer = Buffer.concat(chunks);

      // Determine file extension from first chunk or default to webm
      const extension = "webm"; // Default, could be determined from mimeType if stored
      const fileName = `recording-${recordingSessionId}.${extension}`;
      const storagePath = `visits/${visit.patientId}/${visitId}/${fileName}`;

      // Upload to Supabase Storage
      const bucket = process.env.STORAGE_BUCKET || "visits";
      await uploadFile(bucket, storagePath, finalBuffer, {
        contentType: `audio/${extension}`,
        upsert: true,
      });

      // Trigger transcription pipeline (call directly to avoid auth issues)
      let transcriptId: string | null = null;
      let transcriptText: string | null = null;
      let parsedNote: VisitNote | null = null;

      try {
        const { transcribeAudio } = await import("@/app/_lib/ai/transcribe");
        const transcriptData = await transcribeAudio(storagePath);
        transcriptId = transcriptData.transcriptId || null;
        transcriptText = transcriptData.text || null;

        // Save transcript to database
        if (transcriptText) {
          try {
            await saveTranscriptAction({
              visitId: visit.id,
              text: transcriptText,
              rawText: transcriptData.rawText || transcriptText,
            });
          } catch (error) {
            console.error("Error saving transcript:", error);
          }
        }

        // Trigger parsing if transcript is available (call directly to avoid auth issues)
        if (transcriptText) {
          try {
            const { parseVisitNoteFromTranscript } = await import(
              "@/app/_lib/ai/parse-visit"
            );
            parsedNote = await parseVisitNoteFromTranscript({
              transcript: transcriptText,
            });

            // Save parsed note to visit draft
            if (parsedNote) {
              try {
                await updateVisitDraftAction(visit.id, {
                  notesJson: parsedNote,
                });
                console.log("Parsed note saved to visit draft");
              } catch (error) {
                console.error("Error saving parsed note to visit:", error);
              }
            }
          } catch (error) {
            console.error("Error parsing transcript:", error);
          }
        }
      } catch (error) {
        console.error("Transcription error:", error);
      }

      return NextResponse.json({
        success: true,
        transcriptId,
        transcript: transcriptText,
        parsedNote,
        audioPath: storagePath,
        message: "Recording finalized, transcription and parsing completed",
      });
    } finally {
      // Always cleanup session chunks from storage, even if errors occurred
      // This prevents leaked temporary chunks in storage
      await cleanupSessionChunks(CHUNKS_BUCKET, sessionPath);
    }
  } catch (error) {
    console.error("Error finalizing recording:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to finalize recording",
      },
      { status: 500 }
    );
  }
}
