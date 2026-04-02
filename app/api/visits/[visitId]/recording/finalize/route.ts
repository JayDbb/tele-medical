import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getServerSession } from "@/app/_lib/supabase/server";
import { db } from "@/app/_lib/db/drizzle/index";
import { patients } from "@/app/_lib/db/drizzle/schema";
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
export const maxDuration = 300; // 5 minutes for longer processing

const CHUNKS_BUCKET = "telehealth_audio";
// Supabase Free plan has 50MB file size limit
// Pro plan can go up to 500GB, but we'll check and warn
const SUPABASE_FREE_PLAN_LIMIT = 50 * 1024 * 1024; // 50MB

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
    const { recordingSessionId, expectedChunkCount } = body;

    if (!recordingSessionId) {
      return NextResponse.json(
        { error: "recordingSessionId is required" },
        { status: 400 }
      );
    }

    // Verify visit and assignment (align with finalizeVisitAction: visit OR patient assignee)
    const visit = await getVisitById(visitId);
    if (!visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }
    const [patientRow] = await db
      .select({ clinicianId: patients.clinicianId })
      .from(patients)
      .where(eq(patients.id, visit.patientId))
      .limit(1);
    const canFinalizeRecording =
      visit.clinicianId === session.id ||
      patientRow?.clinicianId === session.id;
    if (!canFinalizeRecording) {
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
        expectedChunkCount: expectedChunkCount || "unknown",
        chunkIndices: chunkIndices.slice(0, 10), // First 10 for logging
        hasGaps: chunkIndices.length > 0 && chunkIndices[chunkIndices.length - 1] - chunkIndices[0] + 1 !== chunkIndices.length,
      });
      
      // Validate we have chunks - be lenient with expected count since it's an estimate
      // The actual chunk count depends on timeslice (2 seconds) and final partial chunks
      if (expectedChunkCount && chunkFiles.length > 0) {
        // Allow for some variance - expected count is an estimate based on duration
        // With 2-second timeslices, actual count should be roughly duration/2
        // But we should have at least some chunks and not be missing too many
        const minExpectedChunks = Math.floor(expectedChunkCount * 0.7); // Allow 30% variance
        const missing = expectedChunkCount - chunkFiles.length;
        
        if (chunkFiles.length < minExpectedChunks) {
          console.warn("Too many chunks missing - refusing to finalize", {
            expectedChunkCount,
            foundChunks: chunkFiles.length,
            minExpectedChunks,
            missing,
            chunkIndices: chunkIndices,
          });
          
          // Wait a bit and retry listing (eventual consistency)
          await new Promise((r) => setTimeout(r, 3000));
          const retryFiles = await listFiles(CHUNKS_BUCKET, sessionPath);
          const retryChunkFiles = retryFiles
            ?.filter((f) => f.name.startsWith("chunk-"))
            .sort((a, b) => a.name.localeCompare(b.name)) || [];
          
          if (retryChunkFiles.length < minExpectedChunks) {
            return NextResponse.json(
              {
                error: `Too many chunks missing: expected at least ${minExpectedChunks}, found ${retryChunkFiles.length}. Please wait and retry.`,
                expectedChunkCount,
                foundChunks: retryChunkFiles.length,
                minExpectedChunks,
                missing: expectedChunkCount - retryChunkFiles.length,
              },
              { status: 400 }
            );
          }
          
          // Update chunkFiles with retry results
          chunkFiles.length = 0;
          chunkFiles.push(...retryChunkFiles);
          
          // Re-extract indices
          const retryIndices = chunkFiles.map((f) => {
            const match = f.name.match(/chunk-(\d+)/);
            return match ? parseInt(match[1], 10) : -1;
          }).filter(idx => idx >= 0).sort((a, b) => a - b);
          chunkIndices.length = 0;
          chunkIndices.push(...retryIndices);
          
          console.log("After retry, chunks found", {
            totalChunks: chunkFiles.length,
            expectedChunkCount,
            minExpectedChunks,
          });
        } else if (missing > 0) {
          console.log("Some chunks missing but within acceptable range", {
            expectedChunkCount,
            foundChunks: chunkFiles.length,
            missing,
            note: "Proceeding with available chunks",
          });
        }
      }

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
      // IMPORTANT: Sort by chunk index to ensure correct order
      const chunks: Array<{ index: number; data: Buffer }> = [];
      for (const chunkFile of chunkFiles) {
        const match = chunkFile.name.match(/chunk-(\d+)/);
        if (match) {
          const chunkIndex = parseInt(match[1], 10);
          const chunkPath = `${sessionPath}/${chunkFile.name}`;
          const chunkData = await downloadFile(CHUNKS_BUCKET, chunkPath);
          chunks.push({ index: chunkIndex, data: chunkData });
        }
      }
      
      // Sort by index to ensure correct order
      chunks.sort((a, b) => a.index - b.index);
      
      // Log chunk sizes for debugging
      console.log("Assembling chunks", {
        totalChunks: chunks.length,
        chunkSizes: chunks.map(c => ({ index: c.index, size: c.data.length })).slice(0, 10),
        totalSize: chunks.reduce((sum, c) => sum + c.data.length, 0),
      });
      
      // Check for missing chunks (gaps in sequence)
      if (chunks.length > 0) {
        const indices = chunks.map(c => c.index).sort((a, b) => a - b);
        const expectedIndices: number[] = [];
        for (let i = indices[0]; i <= indices[indices.length - 1]; i++) {
          expectedIndices.push(i);
        }
        const missingIndices = expectedIndices.filter(idx => !indices.includes(idx));
        if (missingIndices.length > 0) {
          console.warn("Missing chunk indices detected!", {
            missingIndices: missingIndices.slice(0, 20), // First 20 missing
            totalMissing: missingIndices.length,
            firstChunk: indices[0],
            lastChunk: indices[indices.length - 1],
          });
        }
      }
      
      // Concatenate chunks in order
      // NOTE: For WebM/Opus, simple Buffer.concat can work for timeslice recordings
      // because each chunk is a valid WebM segment. However, if playback issues occur,
      // we may need to use a proper WebM muxer (e.g., webm-muxer) to handle container metadata.
      // For now, we'll concatenate and validate the result.
      const finalBuffer = Buffer.concat(chunks.map(c => c.data));
      const finalSize = finalBuffer.length;

      // Check if final file exceeds Supabase Free plan limit
      if (finalSize > SUPABASE_FREE_PLAN_LIMIT) {
        const sizeMB = (finalSize / 1024 / 1024).toFixed(2);
        const limitMB = (SUPABASE_FREE_PLAN_LIMIT / 1024 / 1024).toFixed(0);
        console.error("Final recording exceeds Supabase Free plan limit", {
          size: finalSize,
          sizeMB,
          limitMB,
          recordingDuration: expectedChunkCount ? `${expectedChunkCount}s` : "unknown",
        });
        
        return NextResponse.json(
          {
            error: `Recording size (${sizeMB}MB) exceeds Supabase Free plan limit (${limitMB}MB). Please upgrade to Pro plan or reduce recording duration/quality.`,
            size: finalSize,
            sizeMB: parseFloat(sizeMB),
            limitMB: parseFloat(limitMB),
            recordingDuration: expectedChunkCount || 0,
          },
          { status: 413 } // 413 Payload Too Large
        );
      }

      // Determine file extension from first chunk or default to webm
      const extension = "webm"; // Default, could be determined from mimeType if stored
      const fileName = `recording-${recordingSessionId}.${extension}`;
      const storagePath = `visits/${visit.patientId}/${visitId}/${fileName}`;

      // Upload to Supabase Storage
      const bucket = process.env.STORAGE_BUCKET || "visits";
      try {
        await uploadFile(bucket, storagePath, finalBuffer, {
          contentType: `audio/${extension}`,
          upsert: true,
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
          const sizeMB = (finalSize / 1024 / 1024).toFixed(2);
          console.error("Supabase storage size limit error during final upload", {
            size: finalSize,
            sizeMB,
            error: errorMessage,
          });
          return NextResponse.json(
            {
              error: `Upload failed: File size limit exceeded. Recording size is ${sizeMB}MB, but Supabase Free plan has a 50MB limit per file. Please upgrade your plan or reduce recording duration/quality.`,
              size: finalSize,
              sizeMB: parseFloat(sizeMB),
            },
            { status: 413 } // 413 Payload Too Large
          );
        }
        throw uploadError; // Re-throw if it's not a size error
      }

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
