import { getOfflineDB, isOfflineDBAvailable } from "./db";
import { getFile, getFileBlob } from "./files";
import { saveDraft } from "./draft";
import { toast } from "sonner";
import { getReadyOperations } from "./repos/outbox.repo";
import { processOperation } from "./repos/outbox.repo";
import { isOnline } from "./sync/network";
import * as patientsRepo from "./repos/patients.repo";
import * as visitsRepo from "./repos/visits.repo";
import * as documentsRepo from "./repos/documents.repo";

/**
 * Sync engine to retry pending operations when connection is restored
 */
export class SyncEngine {
  private isRunning = false;
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing = false; // Prevent concurrent sync operations
  private activeOperations = new Set<string>(); // Track operations in progress
  private lastSyncTime = 0; // Track last sync time to prevent too frequent syncs
  private readonly SYNC_COOLDOWN_MS = 5000; // Minimum 5 seconds between syncs

  /**
   * Start the sync engine (checks for pending operations periodically)
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Check immediately
    this.syncPendingOperations();

    // Check every 30 seconds when online
    this.syncInterval = setInterval(() => {
      if (navigator.onLine) {
        this.syncPendingOperations();
      }
    }, 30000);

    // Also check when connection is restored
    window.addEventListener("online", () => {
      this.syncPendingOperations();
    });
  }

  /**
   * Stop the sync engine
   */
  stop() {
    this.isRunning = false;
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Sync all pending operations
   */
  private async syncPendingOperations() {
    if (!isOnline()) return;
    if (!isOfflineDBAvailable()) return;

    // Prevent concurrent sync operations
    if (this.isSyncing) {
      console.log("Sync already in progress, skipping...");
      return;
    }

    // Prevent too frequent syncs (cooldown)
    const now = Date.now();
    if (now - this.lastSyncTime < this.SYNC_COOLDOWN_MS) {
      return;
    }

    this.isSyncing = true;
    this.lastSyncTime = now;

    try {
      // Process general outbox operations first
      await this.processOutboxOperations();

      const db = getOfflineDB();

      // Get all drafts with pending operations
      const drafts = await db.draftVisits.toArray();

      let hasPendingOps = false;
      for (const draft of drafts) {
        // Skip drafts with parsing that has exceeded max retries
        if (draft.pendingParsing) {
          const parseRetryCount = (draft as any).parseRetryCount || 0;
          if (parseRetryCount >= 3) {
            // Already exceeded max retries, skip it (will be cleared in retryPendingParsing)
            continue;
          }
        }

        if (
          draft.pendingChunks ||
          draft.pendingTranscription ||
          draft.pendingParsing ||
          (draft.recordingSessionId &&
            draft.visitIdRemote &&
            !draft.transcript &&
            !draft.pendingTranscription)
        ) {
          hasPendingOps = true;
          break;
        }
      }

      if (!hasPendingOps) {
        this.isSyncing = false;
        return;
      }

      // Show sync started notification (only once per sync cycle)
      toast.info("Syncing pending operations...", { duration: 2000 });

      for (const draft of drafts) {
        try {
          // Reload draft to get latest state before each operation
          const currentDraft = await db.draftVisits.get(draft.draftId);
          if (!currentDraft) continue;

          // Retry pending chunk uploads first (transcription depends on chunks)
          if (currentDraft.pendingChunks) {
            const opKey = `${currentDraft.draftId}-chunks`;
            if (!this.activeOperations.has(opKey)) {
              this.activeOperations.add(opKey);
              try {
                await this.retryPendingChunks(currentDraft);
              } finally {
                this.activeOperations.delete(opKey);
              }
            }
          }

          // Retry finalization if we have a recording session but no transcript
          if (
            currentDraft.recordingSessionId &&
            currentDraft.visitIdRemote &&
            !currentDraft.transcript &&
            !currentDraft.pendingTranscription
          ) {
            const opKey = `${currentDraft.draftId}-finalize`;
            if (!this.activeOperations.has(opKey)) {
              this.activeOperations.add(opKey);
              try {
                await this.retryFinalization(currentDraft);
              } finally {
                this.activeOperations.delete(opKey);
              }
            }
          }

          // Retry pending transcription (reload draft to check current state)
          const draftAfterChunks = await db.draftVisits.get(draft.draftId);
          if (draftAfterChunks?.pendingTranscription) {
            const opKey = `${draftAfterChunks.draftId}-transcribe`;
            if (!this.activeOperations.has(opKey)) {
              this.activeOperations.add(opKey);
              try {
                await this.retryPendingTranscription(draftAfterChunks);
              } finally {
                this.activeOperations.delete(opKey);
              }
            }
          }

          // Retry pending parsing (reload draft to check current state)
          const draftAfterTranscribe = await db.draftVisits.get(draft.draftId);
          if (draftAfterTranscribe?.pendingParsing) {
            // Check retry count before attempting
            const parseRetryCount =
              (draftAfterTranscribe as any).parseRetryCount || 0;
            if (parseRetryCount < 3) {
              const opKey = `${draftAfterTranscribe.draftId}-parse`;
              if (!this.activeOperations.has(opKey)) {
                this.activeOperations.add(opKey);
                try {
                  await this.retryPendingParsing(draftAfterTranscribe);
                } finally {
                  this.activeOperations.delete(opKey);
                }
              }
            }
          }
        } catch (error) {
          console.error("Error syncing draft operations:", error);
        }
      }

      // Emit custom event to notify forms that sync completed
      window.dispatchEvent(
        new CustomEvent("draftSyncCompleted", {
          detail: { patientId: drafts[0]?.patientId },
        })
      );
    } catch (error) {
      console.error("Error in syncPendingOperations:", error);
    } finally {
      // Always reset syncing flag, even on errors
      this.isSyncing = false;
    }
  }

  /**
   * Retry finalization if recording session exists
   */
  private async retryFinalization(draft: any) {
    if (!draft.recordingSessionId || !draft.visitIdRemote) return;

    // Double-check draft state before proceeding
    const db = getOfflineDB();
    const currentDraft = await db.draftVisits.get(draft.draftId);
    if (
      !currentDraft ||
      !currentDraft.recordingSessionId ||
      currentDraft.transcript ||
      currentDraft.pendingTranscription
    ) {
      // Already completed or in progress
      return;
    }

    try {
      const response = await fetch(
        `/api/visits/${currentDraft.visitIdRemote}/recording/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recordingSessionId: currentDraft.recordingSessionId,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();

        // Verify draft still exists and hasn't changed
        const verifyDraft = await db.draftVisits.get(draft.draftId);
        if (!verifyDraft || verifyDraft.transcript) {
          // Already completed by another process
          return;
        }

        // Update draft with results
        await db.draftVisits.update(draft.draftId, {
          recordingSessionId: undefined, // Clear after successful finalization
          transcript: data.transcript || verifyDraft.transcript,
          audioPath: data.audioPath || verifyDraft.audioPath,
        });

        if (data.transcript) {
          toast.success(
            "Recording finalized and transcribed. Parsing will start automatically."
          );
          // Emit event to notify form
          window.dispatchEvent(
            new CustomEvent("draftUpdated", {
              detail: { patientId: draft.patientId },
            })
          );
        }
      }
    } catch (error) {
      console.error("Error retrying finalization:", error);
    }
  }

  /**
   * Retry uploading pending chunks
   */
  private async retryPendingChunks(draft: any) {
    if (!draft.pendingChunks || !draft.visitIdRemote) return;

    const pendingChunks = JSON.parse(draft.pendingChunks) as string[];
    if (pendingChunks.length === 0) return;

    const db = getOfflineDB();
    const successfulChunks: string[] = [];

    for (const chunkDataStr of pendingChunks) {
      try {
        const chunkData = JSON.parse(chunkDataStr);
        const { fileId, chunkIndex, sessionId, mimeType, visitId } = chunkData;

        const file = await getFile(fileId);
        if (!file) {
          console.warn(`Chunk file ${fileId} not found, skipping`);
          continue;
        }

        const formData = new FormData();
        formData.append("chunk", file.blob);
        formData.append("chunkIndex", chunkIndex.toString());
        formData.append("recordingSessionId", sessionId);
        formData.append("mimeType", mimeType);

        const response = await fetch(`/api/visits/${visitId}/recording/chunk`, {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          successfulChunks.push(chunkDataStr);
          // Delete file after successful upload
          await db.files.delete(fileId);
        }
      } catch (error) {
        console.error("Error retrying chunk upload:", error);
      }
    }

    // Update draft with remaining chunks
    const remainingChunks = pendingChunks.filter(
      (chunk) => !successfulChunks.includes(chunk)
    );

    await db.draftVisits.update(draft.draftId, {
      pendingChunks:
        remainingChunks.length > 0
          ? JSON.stringify(remainingChunks)
          : undefined,
    });

    if (successfulChunks.length > 0) {
      toast.success(
        `Uploaded ${successfulChunks.length} pending recording chunk(s). Continuing with transcription...`
      );
      // Emit event to notify form
      window.dispatchEvent(
        new CustomEvent("draftUpdated", {
          detail: { patientId: draft.patientId },
        })
      );
    }
  }

  /**
   * Retry pending transcription
   */
  private async retryPendingTranscription(draft: any) {
    if (!draft.pendingTranscription) return;

    // Double-check draft state before proceeding
    const db = getOfflineDB();
    const currentDraft = await db.draftVisits.get(draft.draftId);
    if (!currentDraft || !currentDraft.pendingTranscription) {
      // Already completed or cleared
      return;
    }

    try {
      const transcriptionData = JSON.parse(currentDraft.pendingTranscription);
      const { audioFileId, audioPath, patientId } = transcriptionData;

      // First, try to upload the audio file if we have it locally
      let finalAudioPath = audioPath;
      if (audioFileId) {
        const file = await getFile(audioFileId);
        if (file) {
          try {
            const uploadFormData = new FormData();
            uploadFormData.append("file", file.blob, file.name);
            uploadFormData.append("path", audioPath);

            const uploadResponse = await fetch("/api/upload/audio", {
              method: "POST",
              body: uploadFormData,
            });

            if (uploadResponse.ok) {
              const uploadData = await uploadResponse.json();
              finalAudioPath = uploadData.path || audioPath;
            }
          } catch (error) {
            console.error("Error uploading audio for transcription:", error);
          }
        }
      }

      // Now try transcription
      const transcribeResponse = await fetch("/api/ai/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioPath: finalAudioPath }),
      });

      if (transcribeResponse.ok) {
        const { text: transcript } = await transcribeResponse.json();
        if (transcript) {
          // Verify draft still has pending transcription before clearing
          const verifyDraft = await db.draftVisits.get(draft.draftId);
          if (!verifyDraft || !verifyDraft.pendingTranscription) {
            // Already completed by another process
            return;
          }

          // Clear pending transcription and save transcript
          await db.draftVisits.update(draft.draftId, {
            pendingTranscription: undefined,
            transcript,
            audioPath: finalAudioPath,
          });

          // Automatically trigger parsing after successful transcription
          try {
            toast.info("Parsing transcript...", { duration: 3000 });
            const parseResponse = await fetch("/api/ai/parse-visit", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transcript,
              }),
            });

            if (parseResponse.ok) {
              const { parsed } = await parseResponse.json();
              if (parsed) {
                // Verify draft still exists before updating
                const verifyDraft = await db.draftVisits.get(draft.draftId);
                if (!verifyDraft) return;

                // Update draft with parsed data
                const formState = JSON.parse(verifyDraft.formStateJson || "{}");
                const mergedState = { ...formState, ...parsed };
                await db.draftVisits.update(draft.draftId, {
                  formStateJson: JSON.stringify(mergedState),
                });

                toast.success(
                  "Transcription and parsing completed. Form will update automatically."
                );
                // Emit event to notify form to reload
                window.dispatchEvent(
                  new CustomEvent("draftUpdated", {
                    detail: {
                      patientId: transcriptionData.patientId,
                      hasParsedData: true,
                    },
                  })
                );
              }
            } else {
              // Parsing failed, queue for retry only if not already queued
              const verifyDraft = await db.draftVisits.get(draft.draftId);
              if (verifyDraft && !verifyDraft.pendingParsing) {
                await db.draftVisits.update(draft.draftId, {
                  pendingParsing: JSON.stringify({
                    transcript,
                    patientId: transcriptionData.patientId,
                  }),
                });
              }
              toast.warning("Parsing failed, will retry automatically");
            }
          } catch (parseError) {
            console.error("Error parsing after transcription:", parseError);
            // Queue parsing for retry only if not already queued
            const verifyDraft = await db.draftVisits.get(draft.draftId);
            if (verifyDraft && !verifyDraft.pendingParsing) {
              await db.draftVisits.update(draft.draftId, {
                pendingParsing: JSON.stringify({
                  transcript,
                  patientId: transcriptionData.patientId,
                }),
              });
            }
            toast.warning("Parsing failed, will retry automatically");
          }
        }
      }
    } catch (error) {
      console.error("Error retrying transcription:", error);
    }
  }

  /**
   * Retry pending parsing
   */
  private async retryPendingParsing(draft: any) {
    if (!draft.pendingParsing) return;

    // Double-check draft state before proceeding
    const db = getOfflineDB();
    const currentDraft = await db.draftVisits.get(draft.draftId);
    if (!currentDraft || !currentDraft.pendingParsing) {
      // Already completed or cleared
      return;
    }

    // Track retry attempts for this draft
    const retryKey = `parse-retry-${draft.draftId}`;
    const retryCount = (currentDraft as any).parseRetryCount || 0;
    const MAX_PARSE_RETRIES = 3;

    if (retryCount >= MAX_PARSE_RETRIES) {
      // Too many retries, clear pending parsing to stop infinite retries
      console.warn(
        `Max parse retries reached for draft ${draft.draftId}, clearing pending parsing`
      );
      await db.draftVisits.update(draft.draftId, {
        pendingParsing: undefined,
      });
      toast.error(
        "Parsing failed after multiple attempts. Please try again manually."
      );
      return;
    }

    try {
      const parsingData = JSON.parse(currentDraft.pendingParsing);
      const { audioFileId, audioPath, transcript, previousTranscripts, patientId } = parsingData;

      let parseResponse: Response;
      
      // If we have an audioPath, use the new endpoint (file already uploaded to storage)
      if (audioPath) {
        parseResponse = await fetch("/api/ai/parse-audio-openrouter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioPath,
            previousTranscripts: previousTranscripts && previousTranscripts.length > 0 ? previousTranscripts : undefined,
          }),
        });
      } else if (audioFileId) {
        // If we have audioFileId but no audioPath, we need to upload first
        const audioFile = await getFile(audioFileId);
        if (!audioFile) {
          console.error(`Audio file ${audioFileId} not found in IndexedDB`);
          await db.draftVisits.update(draft.draftId, {
            pendingParsing: undefined,
            parseRetryCount: 0,
          } as any);
          toast.error("Audio file not found. Please try recording again.");
          return;
        }

        // Upload to storage first
        const path = `visits/${patientId}/${audioFileId}/${Date.now()}.${audioFile.name.split('.').pop() || 'mp3'}`;
        const uploadFormData = new FormData();
        uploadFormData.append("file", audioFile.blob, audioFile.name);
        uploadFormData.append("path", path);

        const uploadResponse = await fetch("/api/upload/audio", {
          method: "POST",
          body: uploadFormData,
        });

        if (!uploadResponse.ok) {
          throw new Error("Failed to upload audio file");
        }

        const uploadData = await uploadResponse.json();
        const uploadedPath = uploadData.path || path;

        // Now process with the uploaded path
        parseResponse = await fetch("/api/ai/parse-audio-openrouter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioPath: uploadedPath,
            previousTranscripts: previousTranscripts && previousTranscripts.length > 0 ? previousTranscripts : undefined,
          }),
        });
      } else if (transcript) {
        // Fallback to old endpoint if we have transcript (backward compatibility)
        parseResponse = await fetch("/api/ai/parse-visit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript,
            previousTranscripts,
          }),
        });
      } else {
        throw new Error("No audio file, audioPath, or transcript found in pending parsing data");
      }

      if (parseResponse.ok) {
        const responseData = await parseResponse.json();

        // Check if there's an error in the response (even with 200 status)
        if (responseData.error) {
          console.error("Parse API returned error:", responseData.error);

          // Increment retry count
          const newRetryCount = retryCount + 1;
          await db.draftVisits.update(draft.draftId, {
            parseRetryCount: newRetryCount,
          } as any);

          // If it's a JSON parsing error, it's likely permanent - clear after a few retries
          if (
            responseData.error.includes("Failed to parse JSON") &&
            newRetryCount >= 2
          ) {
            await db.draftVisits.update(draft.draftId, {
              pendingParsing: undefined,
              parseRetryCount: 0,
            } as any);
            toast.error(
              "AI parsing failed. Please try again or enter data manually."
            );
            return;
          }

          // Otherwise, will retry on next sync cycle
          return;
        }

        const { parsed, transcript: newTranscript } = responseData;
        if (parsed) {
          // Verify draft still has pending parsing before clearing
          const verifyDraft = await db.draftVisits.get(draft.draftId);
          if (!verifyDraft || !verifyDraft.pendingParsing) {
            // Already completed by another process
            return;
          }

          // Update draft with parsed data
          const formState = JSON.parse(verifyDraft.formStateJson || "{}");
          const mergedState = { ...formState, ...parsed };
          await db.draftVisits.update(draft.draftId, {
            pendingParsing: undefined,
            parseRetryCount: 0,
            formStateJson: JSON.stringify(mergedState),
          } as any);

          toast.success("Parsing completed. Form will update automatically.");
          // Emit event to notify form to reload
          window.dispatchEvent(
            new CustomEvent("draftUpdated", {
              detail: { patientId: parsingData.patientId, hasParsedData: true },
            })
          );
        } else {
          // No parsed data in response - increment retry count
          const newRetryCount = retryCount + 1;
          await db.draftVisits.update(draft.draftId, {
            parseRetryCount: newRetryCount,
          } as any);
        }
      } else {
        // Non-OK response - try to parse error
        let errorMessage = "";
        try {
          const errorData = await parseResponse.json();
          errorMessage = errorData.error || errorData.message || "";
        } catch {
          const errorText = await parseResponse.text();
          errorMessage = errorText;
        }

        console.error(
          "Parse API error response:",
          parseResponse.status,
          errorMessage
        );

        const newRetryCount = retryCount + 1;

        // If it's a 400 error (bad request) or JSON parsing error, it's likely permanent
        if (
          (parseResponse.status === 400 ||
            errorMessage.includes("Failed to parse JSON")) &&
          newRetryCount >= 2
        ) {
          await db.draftVisits.update(draft.draftId, {
            pendingParsing: undefined,
            parseRetryCount: 0,
          } as any);
          toast.error(
            "AI parsing failed. Please try again or enter data manually."
          );
          return;
        }

        // Increment retry count for retryable errors
        await db.draftVisits.update(draft.draftId, {
          parseRetryCount: newRetryCount,
        } as any);
      }
    } catch (error) {
      console.error("Error retrying parsing:", error);

      // Increment retry count on error
      await db.draftVisits.update(draft.draftId, {
        parseRetryCount: retryCount + 1,
      } as any);
    }
  }

  /**
   * Process general outbox operations (FIFO, respecting dependencies)
   */
  private async processOutboxOperations() {
    if (!isOnline()) return;

    try {
      // Get ready operations (no dependencies or dependencies completed)
      const readyOps = await getReadyOperations();

      // Filter out operations that are not ready to retry yet
      const now = Date.now();
      const opsToProcess = readyOps.filter((op) => {
        if (op.retryAt && op.retryAt > now) {
          return false; // Not ready yet
        }
        return (
          op.status === "queued" || (op.status === "failed" && op.attempts < 8)
        );
      });

      if (opsToProcess.length === 0) {
        return;
      }

      // Process operations in order (FIFO) - limit to 5 at a time to avoid overwhelming
      const opsToProcessNow = opsToProcess.slice(0, 5);

      for (const op of opsToProcessNow) {
        const opKey = `outbox-${op.id}`;
        if (this.activeOperations.has(opKey)) {
          continue; // Already processing
        }

        this.activeOperations.add(opKey);
        try {
          const result = await processOperation(op);

          if (result.success && result.response) {
            // Update cache based on operation type
            await this.handleOperationSuccess(op, result.response);
          }
        } catch (error) {
          console.error(`Error processing outbox operation ${op.id}:`, error);
        } finally {
          this.activeOperations.delete(opKey);
        }
      }
    } catch (error) {
      console.error("Error processing outbox operations:", error);
    }
  }

  /**
   * Handle successful operation - update cache
   */
  private async handleOperationSuccess(
    op: { type: string; payloadJson: string },
    response: unknown
  ): Promise<void> {
    try {
      const payload = JSON.parse(op.payloadJson) as Record<string, unknown>;

      // Update cache based on operation type
      if (op.type.includes("patient")) {
        if (response && typeof response === "object" && "id" in response) {
          await patientsRepo.upsertFromServer(
            response as { id: string; [key: string]: unknown }
          );
        }
      } else if (op.type.includes("visit")) {
        if (response && typeof response === "object" && "id" in response) {
          await visitsRepo.upsertFromServer(
            response as {
              id: string;
              patientId: string;
              [key: string]: unknown;
            }
          );
        }
      } else if (op.type.includes("document")) {
        if (response && typeof response === "object" && "id" in response) {
          await documentsRepo.upsertFromServer(
            response as {
              id: string;
              patientId: string;
              [key: string]: unknown;
            }
          );
        }
      }
    } catch (error) {
      console.error("Error updating cache after operation success:", error);
    }
  }
}

// Singleton instance
let syncEngineInstance: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (typeof window === "undefined") {
    throw new Error("SyncEngine can only be used in browser environment");
  }

  if (!syncEngineInstance) {
    syncEngineInstance = new SyncEngine();
  }

  return syncEngineInstance;
}
