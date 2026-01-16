"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";

interface UseCallRecorderOptions {
  room: any; // Twilio Room
  visitId: string;
  onTranscriptReady?: (transcript: string) => void;
  onParseReady?: (parsed: any) => void;
  onFinalizeComplete?: (data: {
    transcript?: string;
    parsedNote?: any;
  }) => void;
}

interface RecordingState {
  isRecording: boolean;
  isUploading: boolean;
  isTranscribing: boolean;
  isParsing: boolean;
  isFinalizing: boolean;
  recordingSessionId: string | null;
  statusMessage: string | null;
}

export function useCallRecorder({
  room,
  visitId,
  onTranscriptReady,
  onParseReady,
  onFinalizeComplete,
}: UseCallRecorderOptions) {
  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    isUploading: false,
    isTranscribing: false,
    isParsing: false,
    isFinalizing: false,
    recordingSessionId: null,
    statusMessage: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mixedStreamRef = useRef<MediaStream | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioSourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(
    new Map()
  );
  const chunkIndexRef = useRef<number>(0);
  const recordingSessionIdRef = useRef<string | null>(null);
  const isStoppingRef = useRef<boolean>(false); // Guard against multiple simultaneous stop calls
  const uploadPromisesRef = useRef<Promise<void>[]>([]); // Track all chunk upload promises
  const recordingStartTimeRef = useRef<number>(0); // Track when recording started
  const uploadedChunkIndicesRef = useRef<Set<number>>(new Set()); // Track which chunk indices have been uploaded

  // Get best supported MIME type
  const getBestMimeType = useCallback(() => {
    const types = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "video/webm;codecs=opus",
      "audio/webm",
      "audio/ogg",
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return ""; // Browser default
  }, []);

  // Create mixed audio stream from all participants
  const createMixedStream = useCallback(async () => {
    if (!room) return null;

    try {
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;

      // Ensure AudioContext is running before creating destination
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      // Monitor and resume AudioContext if it gets suspended
      // Some browsers suspend AudioContext after inactivity, which can cause MediaRecorder to stop
      const audioContextMonitor = setInterval(() => {
        if (audioCtx.state === "suspended") {
          const recordingDuration = Date.now() - recordingStartTimeRef.current;
          console.warn("AudioContext suspended - attempting to resume", {
            recordingDuration: `${(recordingDuration / 1000).toFixed(1)}s`,
          });
          audioCtx.resume().catch((error) => {
            console.error("Failed to resume AudioContext:", error);
          });
        } else if (audioCtx.state === "closed") {
          console.error("AudioContext closed unexpectedly!");
          clearInterval(audioContextMonitor);
        }
      }, 5000);

      (audioCtx as any).__monitorInterval = audioContextMonitor;

      const destination = audioCtx.createMediaStreamDestination();
      destinationRef.current = destination;

      console.log("AudioContext state:", {
        state: audioCtx.state,
        sampleRate: audioCtx.sampleRate,
        destinationStreamTracks: destination.stream.getAudioTracks().length,
      });

      // Add local audio track
      const localParticipant = room.localParticipant;
      if (localParticipant) {
        localParticipant.audioTracks.forEach((publication: any) => {
          const track = publication.track;
          if (track && track.mediaStreamTrack) {
            try {
              const stream = new MediaStream([track.mediaStreamTrack]);
              const source = audioCtx.createMediaStreamSource(stream);
              source.connect(destination);
              audioSourcesRef.current.set(
                `local-${publication.trackSid}`,
                source
              );
            } catch (error) {
              console.error("Error adding local audio track:", error);
            }
          }
        });
      }

      // Add remote audio tracks from all participants
      room.participants.forEach((participant: any) => {
        console.log(
          "Processing participant for audio mix:",
          participant.identity,
          {
            audioTracksCount: participant.audioTracks.size,
          }
        );

        participant.audioTracks.forEach((publication: any) => {
          console.log("Processing audio publication:", {
            trackName: publication.trackName,
            isSubscribed: publication.isSubscribed,
            hasTrack: !!publication.track,
            trackSid: publication.trackSid,
          });

          // Subscribe to the track if not already subscribed
          if (!publication.isSubscribed) {
            console.log("Subscribing to audio track:", publication.trackName);
            publication.setSubscribed(true);
          }

          // Check if track is subscribed and available
          if (publication.isSubscribed && publication.track) {
            const track = publication.track;
            if (track.mediaStreamTrack) {
              try {
                console.log("Adding remote audio track to mix:", track.sid);
                const stream = new MediaStream([track.mediaStreamTrack]);
                const source = audioCtx.createMediaStreamSource(stream);
                source.connect(destination);
                audioSourcesRef.current.set(
                  `remote-${participant.sid}-${track.sid}`,
                  source
                );
                console.log("Remote audio track added successfully");
              } catch (error) {
                console.error("Error adding remote audio track:", error);
              }
            } else {
              console.warn("Remote audio track has no mediaStreamTrack");
            }
          } else {
            console.log(
              "Audio track not subscribed yet, will be added when subscribed"
            );
            // Set up listener for when track becomes subscribed
            publication.on("subscribed", (track: any) => {
              console.log(
                "Remote audio track subscribed, adding to mix:",
                track.sid
              );
              if (
                track.mediaStreamTrack &&
                audioContextRef.current &&
                destinationRef.current
              ) {
                try {
                  const stream = new MediaStream([track.mediaStreamTrack]);
                  const source =
                    audioContextRef.current.createMediaStreamSource(stream);
                  source.connect(destinationRef.current);
                  audioSourcesRef.current.set(
                    `remote-${participant.sid}-${track.sid}`,
                    source
                  );
                  console.log(
                    "Remote audio track added to mix after subscription"
                  );
                } catch (error) {
                  console.error(
                    "Error adding subscribed remote audio track:",
                    error
                  );
                }
              }
            });
          }
        });
      });

      return destination.stream;
    } catch (error) {
      console.error("Error creating mixed stream:", error);
      return null;
    }
  }, [room]) as () => Promise<MediaStream | null>;

  // Upload chunk to server with offline fallback
  const uploadChunk = useCallback(
    async (
      chunk: Blob,
      chunkIndex: number,
      sessionId: string,
      mimeType: string
    ) => {
      const isOnline = navigator.onLine;

      // If offline, store chunk locally and queue for later
      if (!isOnline) {
        const { storeFile } = await import("@/app/_lib/offline/files");
        const { saveDraft } = await import("@/app/_lib/offline/draft");
        const { getOfflineDB } = await import("@/app/_lib/offline/db");

        // Store chunk as file
        const chunkFile = new File(
          [chunk],
          `chunk-${chunkIndex}-${sessionId}`,
          {
            type: mimeType,
          }
        );
        const fileId = await storeFile(chunkFile);

        // Save chunk info to draft for retry
        const db = getOfflineDB();
        const draft = await db.draftVisits
          .where("visitIdRemote")
          .equals(visitId)
          .first();

        if (draft) {
          const pendingChunks = JSON.parse(
            draft.pendingChunks || "[]"
          ) as string[];
          pendingChunks.push(
            JSON.stringify({
              fileId,
              chunkIndex,
              sessionId,
              mimeType,
              visitId,
            })
          );
          await db.draftVisits.update(draft.draftId, {
            pendingChunks: JSON.stringify(pendingChunks),
            recordingSessionId: sessionId,
          });
        }

        throw new Error("Offline: Chunk saved locally, will retry when online");
      }

      try {
        const formData = new FormData();
        formData.append("chunk", chunk);
        formData.append("chunkIndex", chunkIndex.toString());
        formData.append("recordingSessionId", sessionId);
        formData.append("mimeType", mimeType);

        const response = await fetch(`/api/visits/${visitId}/recording/chunk`, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          // If upload fails, store locally and queue for retry
          const { storeFile } = await import("@/app/_lib/offline/files");
          const { getOfflineDB } = await import("@/app/_lib/offline/db");

          const chunkFile = new File(
            [chunk],
            `chunk-${chunkIndex}-${sessionId}`,
            {
              type: mimeType,
            }
          );
          const fileId = await storeFile(chunkFile);

          const db = getOfflineDB();
          const draft = await db.draftVisits
            .where("visitIdRemote")
            .equals(visitId)
            .first();

          if (draft) {
            const pendingChunks = JSON.parse(
              draft.pendingChunks || "[]"
            ) as string[];
            pendingChunks.push(
              JSON.stringify({
                fileId,
                chunkIndex,
                sessionId,
                mimeType,
                visitId,
              })
            );
            await db.draftVisits.update(draft.draftId, {
              pendingChunks: JSON.stringify(pendingChunks),
              recordingSessionId: sessionId,
            });
          }

          const error = await response
            .json()
            .catch(() => ({ error: "Upload failed" }));
          throw new Error(error.error || "Failed to upload chunk");
        }

        return response.json();
      } catch (error) {
        // Network error - store locally
        if (error instanceof TypeError && error.message.includes("fetch")) {
          const { storeFile } = await import("@/app/_lib/offline/files");
          const { getOfflineDB } = await import("@/app/_lib/offline/db");

          const chunkFile = new File(
            [chunk],
            `chunk-${chunkIndex}-${sessionId}`,
            {
              type: mimeType,
            }
          );
          const fileId = await storeFile(chunkFile);

          const db = getOfflineDB();
          const draft = await db.draftVisits
            .where("visitIdRemote")
            .equals(visitId)
            .first();

          if (draft) {
            const pendingChunks = JSON.parse(
              draft.pendingChunks || "[]"
            ) as string[];
            pendingChunks.push(
              JSON.stringify({
                fileId,
                chunkIndex,
                sessionId,
                mimeType,
                visitId,
              })
            );
            await db.draftVisits.update(draft.draftId, {
              pendingChunks: JSON.stringify(pendingChunks),
              recordingSessionId: sessionId,
            });
          }
        }
        throw error;
      }
    },
    [visitId]
  );

  // Start recording
  const startRecording = useCallback(async () => {
    if (!room || state.isRecording) {
      return;
    }

    // Reset the stopping guard flag when starting a new recording
    isStoppingRef.current = false;

    try {
      // Create mixed stream (now async to ensure AudioContext is running)
      const mixedStream = await createMixedStream();
      if (!mixedStream) {
        throw new Error("Failed to create mixed audio stream");
      }

      // Verify the stream has active tracks
      const audioTracks = mixedStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error(
          "No audio tracks available in stream. Please ensure microphone is enabled."
        );
      }

      // Check if tracks are actually active
      const activeTracks = audioTracks.filter(
        (track) => track.readyState === "live"
      );
      if (activeTracks.length === 0) {
        throw new Error(
          "No active audio tracks. Please check microphone permissions."
        );
      }

      console.log("Mixed stream created with tracks:", {
        totalTracks: audioTracks.length,
        activeTracks: activeTracks.length,
        trackStates: audioTracks.map((t) => ({
          id: t.id,
          state: t.readyState,
          enabled: t.enabled,
          muted: t.muted,
        })),
        audioSourcesCount: audioSourcesRef.current.size,
        audioSourceKeys: Array.from(audioSourcesRef.current.keys()),
        audioContextState: audioContextRef.current?.state,
      });

      // Verify AudioContext is running
      if (
        audioContextRef.current &&
        audioContextRef.current.state !== "running"
      ) {
        console.warn("AudioContext not running, attempting to resume...", {
          state: audioContextRef.current.state,
        });
        try {
          await audioContextRef.current.resume();
          console.log("AudioContext resumed successfully");
        } catch (error) {
          console.error("Failed to resume AudioContext:", error);
          throw new Error(
            "AudioContext could not be started. Please check browser permissions."
          );
        }
      }

      // Wait a brief moment to ensure audio starts flowing
      await new Promise((resolve) => setTimeout(resolve, 100));

      mixedStreamRef.current = mixedStream;

      // Monitor stream tracks to detect if they become inactive
      // This can cause MediaRecorder to stop unexpectedly
      const trackMonitorInterval = setInterval(() => {
        if (!mixedStreamRef.current) {
          clearInterval(trackMonitorInterval);
          return;
        }

        const tracks = mixedStreamRef.current.getAudioTracks();
        const inactiveTracks = tracks.filter((t) => t.readyState !== "live");
        const endedTracks = tracks.filter((t) => t.readyState === "ended");

        if (inactiveTracks.length > 0 || endedTracks.length > 0) {
          const recordingDuration = Date.now() - recordingStartTimeRef.current;
          console.warn("Stream tracks becoming inactive!", {
            inactiveCount: inactiveTracks.length,
            endedCount: endedTracks.length,
            totalTracks: tracks.length,
            recordingDuration: `${(recordingDuration / 1000).toFixed(1)}s`,
            trackStates: tracks.map((t) => ({
              id: t.id,
              state: t.readyState,
              enabled: t.enabled,
            })),
          });

          // If all tracks are ended, MediaRecorder will stop
          if (endedTracks.length === tracks.length) {
            console.error("All stream tracks ended - MediaRecorder will stop!");
            toast.error("Audio stream ended. Recording may stop.");
            clearInterval(trackMonitorInterval);
          }
        }

        // Also check AudioContext state
        if (audioContextRef.current) {
          const ctxState = audioContextRef.current.state;
          if (ctxState === "suspended" || ctxState === "closed") {
            const recordingDuration =
              Date.now() - recordingStartTimeRef.current;
            console.warn("AudioContext state changed:", {
              state: ctxState,
              recordingDuration: `${(recordingDuration / 1000).toFixed(1)}s`,
            });

            // Try to resume if suspended
            if (ctxState === "suspended" && audioContextRef.current.resume) {
              audioContextRef.current.resume().catch((error) => {
                console.error("Failed to resume AudioContext:", error);
              });
            }
          }
        }
      }, 10000); // Check every 10 seconds

      // Store interval for cleanup
      (mixedStream as any).__trackMonitorInterval = trackMonitorInterval;

      // Create MediaRecorder
      const mimeType = getBestMimeType();
      const mediaRecorder = new MediaRecorder(mixedStream, {
        mimeType: mimeType || undefined,
      });
      mediaRecorderRef.current = mediaRecorder;

      // Generate session ID
      const sessionId = `rec-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      recordingSessionIdRef.current = sessionId;
      chunkIndexRef.current = 0;
      recordingStartTimeRef.current = Date.now();
      uploadedChunkIndicesRef.current = new Set();
      uploadPromisesRef.current = [];

      // Track upload status
      let pendingUploads = 0;
      uploadPromisesRef.current = []; // Reset upload promises for new recording
      const incrementUploads = () => {
        pendingUploads++;
        setState((prev) => ({
          ...prev,
          isUploading: pendingUploads > 0,
          // Don't show "Uploading chunks..." when recording - keep "Recording..." message
          statusMessage: prev.isRecording
            ? "Recording..."
            : pendingUploads > 0
            ? "Uploading chunks..."
            : null,
        }));
      };
      const decrementUploads = () => {
        pendingUploads = Math.max(0, pendingUploads - 1);
        setState((prev) => ({
          ...prev,
          isUploading: pendingUploads > 0,
          // Don't show "Uploading chunks..." when recording - keep "Recording..." message
          statusMessage: prev.isRecording
            ? "Recording..."
            : pendingUploads > 0
            ? "Uploading chunks..."
            : null,
        }));
      };

      // Handle data available (chunks)
      const chunks: Blob[] = [];
      const chunkTimestamps: number[] = []; // Track when chunks are received
      let lastChunkTime = Date.now();
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
          const currentChunkIndex = chunkIndexRef.current;
          const chunkSize = event.data.size;
          const timestamp = Date.now();
          const timeSinceLastChunk = timestamp - lastChunkTime;
          const recordingDuration = timestamp - recordingStartTimeRef.current;
          chunkTimestamps.push(timestamp);
          lastChunkTime = timestamp;
          console.log(
            `Chunk ${currentChunkIndex} received: ${chunkSize} bytes at ${new Date(
              timestamp
            ).toISOString()}, ${timeSinceLastChunk}ms since last chunk`
          );
          chunkIndexRef.current++;

          // Upload chunk asynchronously and track the promise
          // Don't await - let it upload in background
          incrementUploads();
          const uploadStartTime = Date.now();
          const uploadPromise = uploadChunk(
            event.data,
            currentChunkIndex,
            sessionId,
            mimeType
          )
            .then(() => {
              const uploadDuration = Date.now() - uploadStartTime;
              console.log(`Chunk ${currentChunkIndex} uploaded successfully`);
              uploadedChunkIndicesRef.current.add(currentChunkIndex);
              decrementUploads();
            })
            .catch((error) => {
              const uploadDuration = Date.now() - uploadStartTime;
              const errorMessage =
                error instanceof Error ? error.message : String(error);

              // Check if it's a size limit error
              if (
                errorMessage.includes("size") ||
                errorMessage.includes("limit") ||
                errorMessage.includes("50") ||
                errorMessage.includes("413")
              ) {
                console.error(
                  `Chunk ${currentChunkIndex} upload failed due to size limit:`,
                  errorMessage
                );
                toast.error(
                  `Recording may be too large. Supabase Free plan has a 50MB limit. Consider stopping the recording soon.`
                );
              } else {
                console.error(
                  `Error uploading chunk ${currentChunkIndex}:`,
                  error
                );
              }

              // Even if upload fails, the chunk is saved locally for retry
              // Don't stop recording - just log the error and continue
              decrementUploads();
              // Don't re-throw - we want recording to continue even if uploads fail
              // The chunk is saved locally and will be retried later
            });
          uploadPromisesRef.current.push(uploadPromise);
        } else {
          console.warn("Received empty chunk data", {
            hasData: !!event.data,
            size: event.data?.size || 0,
          });
        }
      };

      // Store chunk timestamps for debugging
      (mediaRecorder as any).__chunkTimestamps = chunkTimestamps;

      // Monitor for gaps in chunk reception (indicates MediaRecorder might be stopping)
      let lastDataRequestCheck = Date.now();
      const chunkMonitorInterval = setInterval(() => {
        const now = Date.now();
        const timeSinceLastChunk = now - lastChunkTime;
        const recordingDuration = now - recordingStartTimeRef.current;

        // If we haven't received a chunk in 5 seconds and we've been recording for more than 10 seconds,
        // something might be wrong (but don't request data too frequently as it causes empty chunks)
        if (
          timeSinceLastChunk > 5000 &&
          recordingDuration > 10000 &&
          mediaRecorder.state === "recording"
        ) {
          console.warn(
            "No chunks received recently - MediaRecorder might be having issues",
            {
              timeSinceLastChunk: `${(timeSinceLastChunk / 1000).toFixed(1)}s`,
              recordingDuration: `${(recordingDuration / 1000).toFixed(1)}s`,
              recorderState: mediaRecorder.state,
              totalChunks: uploadPromisesRef.current.length,
              streamTracks:
                mixedStreamRef.current?.getAudioTracks().length || 0,
              streamTrackStates:
                mixedStreamRef.current?.getAudioTracks().map((t) => ({
                  id: t.id,
                  state: t.readyState,
                  enabled: t.enabled,
                  muted: t.muted,
                })) || [],
            }
          );

          // Only request data if it's been a while since last request to avoid empty chunks
          const timeSinceLastRequest = Date.now() - lastDataRequestCheck;
          if (timeSinceLastRequest > 3000) {
            try {
              mediaRecorder.requestData();
              lastDataRequestCheck = Date.now();
              console.log(
                "Requested data to check MediaRecorder responsiveness"
              );
            } catch (error) {
              console.error(
                "Error requesting data - MediaRecorder might be dead:",
                error
              );
            }
          }
        }
      }, 5000); // Check every 5 seconds

      (mediaRecorder as any).__chunkMonitorInterval = chunkMonitorInterval;

      // Handle errors - don't auto-stop on error, just log
      mediaRecorder.onerror = (event: any) => {
        console.error("MediaRecorder error:", event.error);
        const errorMessage = event.error?.message || "Unknown error";
        console.error("MediaRecorder error details:", {
          error: event.error,
          message: errorMessage,
          state: mediaRecorder.state,
        });
        toast.error(`Recording error: ${errorMessage}`);
        // Don't stop recording on error, let user decide
        // But log the error for debugging
      };

      // Monitor MediaRecorder state to detect unexpected stops
      let lastStateCheck = Date.now();
      let consecutiveInactiveChecks = 0;
      const stateMonitorInterval = setInterval(() => {
        const now = Date.now();
        const recordingDuration = now - recordingStartTimeRef.current;

        if (mediaRecorder.state === "inactive" && !isStoppingRef.current) {
          consecutiveInactiveChecks++;
          // Only report error after checking twice (to avoid false positives)
          if (consecutiveInactiveChecks >= 2) {
            console.error("MediaRecorder stopped unexpectedly!", {
              state: mediaRecorder.state,
              recordingDuration: `${(recordingDuration / 1000).toFixed(1)}s`,
              totalChunks: uploadPromisesRef.current.length,
              consecutiveChecks: consecutiveInactiveChecks,
            });
            toast.error(
              `Recording stopped unexpectedly after ${(
                recordingDuration / 1000
              ).toFixed(0)} seconds. Please try again.`
            );
            setState({
              isRecording: false,
              isUploading: false,
              isTranscribing: false,
              isParsing: false,
              isFinalizing: false,
              recordingSessionId: null,
              statusMessage: null,
            });
            clearInterval(stateMonitorInterval);
          }
        } else if (mediaRecorder.state === "recording") {
          consecutiveInactiveChecks = 0; // Reset counter when recording
          lastStateCheck = Date.now();

          // Log recording progress every 30 seconds
          if (recordingDuration % 30000 < 5000) {
            console.log("Recording progress:", {
              duration: `${(recordingDuration / 1000).toFixed(1)}s`,
              totalChunks: uploadPromisesRef.current.length,
              uploadedChunks: uploadedChunkIndicesRef.current.size,
              recorderState: mediaRecorder.state,
            });
          }

          // Don't request data too frequently - let the timeslice interval handle it
          // Requesting data too often causes empty chunks
        } else if (mediaRecorder.state === "paused") {
          console.warn("MediaRecorder is paused - this shouldn't happen", {
            recordingDuration: `${(recordingDuration / 1000).toFixed(1)}s`,
          });
        }
      }, 5000); // Check every 5 seconds

      // Store interval so we can clear it on cleanup
      (mediaRecorder as any).__stateMonitorInterval = stateMonitorInterval;

      // Track if this is an explicit stop (set by stopRecording function)
      // Use a ref that persists across the MediaRecorder lifecycle
      const explicitStopRef = { current: false };
      (mediaRecorder as any).__explicitStopRef = explicitStopRef;

      // Set up a guard handler that prevents accidental finalization
      // This will catch any unexpected stops and prevent finalization
      mediaRecorder.onstop = () => {
        console.log("onstop triggered during startRecording", {
          explicitStop: explicitStopRef.current,
          state: mediaRecorder.state,
        });

        // If this is NOT an explicit stop, just reset state and return
        // DO NOT finalize - this prevents the "Finalizing recording..." message
        if (!explicitStopRef.current) {
          console.warn(
            "Unexpected stop detected - NOT finalizing, just resetting state"
          );
          setState({
            isRecording: false,
            isUploading: false,
            isTranscribing: false,
            isParsing: false,
            isFinalizing: false, // Explicitly set to false - no finalization
            recordingSessionId: null,
            statusMessage: null,
          });
          toast.error("Recording stopped unexpectedly. Please try again.");
          return; // CRITICAL: Don't proceed with any finalization
        }

        // If we get here and explicitStopRef is true, it means stopRecording was called
        // But we shouldn't handle finalization here - stopRecording will replace this handler
        console.log(
          "onstop triggered but explicit stop flag is true - stopRecording should handle this"
        );
      };

      // Start recording with 2 second timeslices
      // This allows enough time for audio data to accumulate before chunks are emitted
      // Calling requestData() too frequently can result in empty chunks
      try {
        // Start with a 2 second timeslice - this ensures chunks have actual audio data
        mediaRecorder.start(2000);
        console.log("MediaRecorder started successfully", {
          state: mediaRecorder.state,
          mimeType: mediaRecorder.mimeType,
          timeslice: 2000,
          streamTracks: mixedStream.getAudioTracks().length,
          streamTrackStates: mixedStream.getAudioTracks().map((t) => ({
            id: t.id,
            state: t.readyState,
            enabled: t.enabled,
            muted: t.muted,
          })),
        });

        // Only request data periodically if we haven't received chunks naturally
        // This prevents requesting empty chunks when timeslice hasn't elapsed
        let lastDataRequestTime = Date.now();
        const dataRequestInterval = setInterval(() => {
          try {
            if (mediaRecorder.state === "recording") {
              const timeSinceLastChunk = Date.now() - lastChunkTime;
              // Only request data if we haven't received a chunk in 4+ seconds
              // This prevents requesting data too early and getting empty chunks
              if (timeSinceLastChunk > 4000) {
                mediaRecorder.requestData();
                lastDataRequestTime = Date.now();
                console.log(
                  "Requested data due to no chunks received in",
                  `${(timeSinceLastChunk / 1000).toFixed(1)}s`
                );
              } else {
                console.log(
                  "Skipping data request - timeslice not elapsed yet",
                  {
                    timeSinceLastChunk: `${(timeSinceLastChunk / 1000).toFixed(
                      1
                    )}s`,
                  }
                );
              }
            } else {
              clearInterval(dataRequestInterval);
            }
          } catch (error) {
            console.warn("Error in periodic data request:", error);
            clearInterval(dataRequestInterval);
          }
        }, 10000); // Check every 10 seconds instead of requesting every 5

        // Store interval for cleanup
        (mediaRecorder as any).__dataRequestInterval = dataRequestInterval;

        // Verify it's actually recording after a brief moment
        setTimeout(() => {
          if (mediaRecorder.state === "recording") {
            console.log("MediaRecorder confirmed recording");
          } else if (mediaRecorder.state === "inactive") {
            console.error("MediaRecorder stopped immediately after start");
            // Only reset if we didn't explicitly stop
            if (!explicitStopRef.current) {
              setState({
                isRecording: false,
                isUploading: false,
                isTranscribing: false,
                isParsing: false,
                isFinalizing: false,
                recordingSessionId: null,
                statusMessage: null,
              });
              toast.error("Recording stopped unexpectedly. Please try again.");
            }
          }
        }, 500);
      } catch (error) {
        console.error("Error starting MediaRecorder:", error);
        throw error;
      }

      // Store the stop flag ref so stopRecording can set it
      (mediaRecorder as any).__explicitStopRef = explicitStopRef;

      setState({
        isRecording: true,
        isUploading: false,
        isTranscribing: false,
        isParsing: false,
        isFinalizing: false,
        recordingSessionId: sessionId,
        statusMessage: "Recording...",
      });

      toast.success("Recording started");
    } catch (error) {
      console.error("Error starting recording:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to start recording"
      );
    }
  }, [
    room,
    state.isRecording,
    createMixedStream,
    getBestMimeType,
    uploadChunk,
  ]);

  // Stop recording and finalize
  const stopRecording = useCallback(async () => {
    // Guard: Prevent multiple simultaneous calls using ref (synchronous check)
    if (isStoppingRef.current) {
      console.log("Stop already in progress, ignoring duplicate call");
      return;
    }

    // Guard: Don't stop if we're already finalizing/stopping
    if (state.isFinalizing || state.isTranscribing || state.isParsing) {
      console.log("Already finalizing/processing, ignoring stop request");
      return;
    }

    if (
      !state.isRecording ||
      !mediaRecorderRef.current ||
      !recordingSessionIdRef.current
    ) {
      console.log("Cannot stop - not recording or missing refs", {
        isRecording: state.isRecording,
        hasRecorder: !!mediaRecorderRef.current,
        hasSessionId: !!recordingSessionIdRef.current,
      });
      return;
    }

    // Guard: Check if MediaRecorder is actually recording
    const mediaRecorder = mediaRecorderRef.current;
    if (mediaRecorder.state !== "recording") {
      console.log(
        "MediaRecorder is not in recording state:",
        mediaRecorder.state
      );
      // Reset state if recorder stopped unexpectedly
      setState({
        isRecording: false,
        isUploading: false,
        isTranscribing: false,
        isParsing: false,
        isFinalizing: false,
        recordingSessionId: null,
        statusMessage: null,
      });
      return;
    }

    // Set the guard flag immediately
    isStoppingRef.current = true;

    try {
      // Mark this as an explicit stop BEFORE setting finalizing state
      const explicitStopRef = (mediaRecorder as any).__explicitStopRef;
      if (explicitStopRef) {
        explicitStopRef.current = true;
        console.log("Marked as explicit stop");
      } else {
        console.warn("No explicitStopRef found on MediaRecorder");
      }

      // CRITICAL: Request final data BEFORE stopping to ensure last chunk is captured
      // This ensures any buffered audio is emitted as a chunk
      try {
        mediaRecorder.requestData();
        console.log("Requested final data chunk before stop");
      } catch (error) {
        console.warn("Error requesting final data:", error);
      }

      // Small delay to allow requestData to process
      await new Promise((r) => setTimeout(r, 200));

      // If we can't mark it as explicit, don't proceed with finalization
      if (!explicitStopRef) {
        return;
      }

      // Set recording to false immediately and start finalizing
      setState({
        isRecording: false, // Stop showing "Recording..." immediately
        isUploading: false, // Clear uploading state
        isTranscribing: false,
        isParsing: false,
        isFinalizing: true,
        recordingSessionId: state.recordingSessionId,
        statusMessage: "Finalizing recording...",
      });

      return new Promise<void>((resolve) => {
        // REPLACE the onstop handler (the guard handler will have already checked the flag)
        // Now we set the actual finalization handler
        mediaRecorder.onstop = async () => {
          // CRITICAL: Wait a moment for the final ondataavailable event to fire and be queued
          // The final chunk from stop() might not be in uploadPromisesRef yet
          await new Promise((r) => setTimeout(r, 500));

          const chunkTimestamps =
            (mediaRecorder as any).__chunkTimestamps || [];
          const recordingDuration =
            chunkTimestamps.length > 0
              ? chunkTimestamps[chunkTimestamps.length - 1] - chunkTimestamps[0]
              : 0;
          console.log("onstop handler in stopRecording called", {
            totalChunks: uploadPromisesRef.current.length,
            chunkTimestampsCount: chunkTimestamps.length,
            estimatedDuration: `${(recordingDuration / 1000).toFixed(1)}s`,
            recorderState: mediaRecorder.state,
            chunkIndex: chunkIndexRef.current,
          });
          try {
            // Wait for any pending uploads to complete (but don't show uploading status)
            setState((prev) => ({
              ...prev,
              isRecording: false, // Ensure recording is false
              isUploading: false, // Don't show uploading status during finalization
              statusMessage: "Waiting for uploads to complete...",
            }));

            // Wait for all pending chunk uploads to complete
            // This is critical - we must wait for ALL chunks before finalizing
            const uploadPromises = uploadPromisesRef.current || [];
            const expectedChunks = chunkIndexRef.current; // Total chunks that should have been created
            const recordingDuration =
              Date.now() - recordingStartTimeRef.current;
            // We use 2000ms timeslice, so calculate expected chunks based on that
            const expectedChunkCount = Math.ceil(recordingDuration / 2000) + 1; // 2 seconds per chunk, +1 for final partial chunk

            console.log("Waiting for chunk uploads", {
              totalPromises: uploadPromises.length,
              expectedChunks,
              expectedChunkCount,
              recordingDuration: `${(recordingDuration / 1000).toFixed(1)}s`,
              uploadedChunks: uploadedChunkIndicesRef.current.size,
            });

            if (uploadPromises.length > 0) {
              try {
                // Wait for all uploads with a longer timeout (max 60 seconds to ensure all chunks upload)
                const results = await Promise.race([
                  Promise.allSettled(uploadPromises),
                  new Promise<PromiseSettledResult<void>[]>((r) =>
                    setTimeout(() => r([]), 60000)
                  ),
                ]);
                const successful = results.filter(
                  (r) => r.status === "fulfilled"
                ).length;
                const failed = results.filter(
                  (r) => r.status === "rejected"
                ).length;
                const failedIndices: number[] = [];
                results.forEach((r, idx) => {
                  if (r.status === "rejected") {
                    // Try to find which chunk index failed (approximate from position)
                    failedIndices.push(idx);
                  }
                });
                console.log("Chunk uploads completed", {
                  total: uploadPromises.length,
                  successful,
                  failed,
                  uploadedChunkCount: uploadedChunkIndicesRef.current.size,
                  expectedChunkCount,
                });

                // If we have failed uploads, wait longer and check again
                if (failed > 0) {
                  console.warn(
                    `Some chunks failed to upload (${failed}), waiting additional time for retries...`
                  );
                  await new Promise((r) => setTimeout(r, 5000));

                  // Check if failed chunks are being retried
                  const currentUploadPromises = uploadPromisesRef.current || [];
                  if (currentUploadPromises.length > uploadPromises.length) {
                    console.log(
                      "New upload promises detected - waiting for retries"
                    );
                    await Promise.race([
                      Promise.allSettled(
                        currentUploadPromises.slice(uploadPromises.length)
                      ),
                      new Promise((r) => setTimeout(r, 10000)),
                    ]);
                  }
                }
              } catch (error) {
                console.warn("Error waiting for uploads:", error);
              }
            } else {
              console.warn(
                "No upload promises found - this might indicate chunks weren't captured"
              );
              // Give more time for any final chunk to be emitted and uploaded
              await new Promise((r) => setTimeout(r, 5000));
            }

            // Additional wait to ensure any in-flight uploads complete
            console.log("Additional wait to ensure all uploads complete...");
            await new Promise((r) => setTimeout(r, 3000));

            // Quick verification - just check once to ensure chunks are uploaded
            // Don't wait too long since we already waited for upload promises
            console.log("Quick verification of chunk uploads...");
            try {
              const verifyResponse = await fetch(
                `/api/visits/${visitId}/recording/verify-chunks?sessionId=${recordingSessionIdRef.current}`,
                { method: "GET" }
              );

              if (verifyResponse.ok) {
                const verifyData = await verifyResponse.json();
                const serverChunkCount = verifyData.chunkCount || 0;
                const serverChunkIndices = verifyData.chunks || [];
                const expectedCount = Math.max(
                  expectedChunkCount,
                  expectedChunks
                );

                console.log("Chunk verification", {
                  serverChunkCount,
                  expectedCount,
                  uploadedChunkCount: uploadedChunkIndicesRef.current.size,
                });

                // If we're missing more than 10% of chunks, wait a bit more
                if (
                  serverChunkCount < expectedCount * 0.9 &&
                  serverChunkCount < expectedCount
                ) {
                  console.log(
                    `Waiting 2s for remaining chunks (${serverChunkCount}/${expectedCount})...`
                  );
                  await new Promise((r) => setTimeout(r, 2000));

                  // One more quick check
                  const verifyResponse2 = await fetch(
                    `/api/visits/${visitId}/recording/verify-chunks?sessionId=${recordingSessionIdRef.current}`,
                    { method: "GET" }
                  );
                  if (verifyResponse2.ok) {
                    const verifyData2 = await verifyResponse2.json();
                    const serverChunkIndices2 = verifyData2.chunks || [];
                    console.log("Final chunk count:", {
                      serverChunkCount: verifyData2.chunkCount,
                      expectedCount,
                    });
                  }
                }
              }
            } catch (error) {
              console.warn(
                "Error verifying chunks (proceeding anyway):",
                error
              );
            }

            // Finalize recording on server
            setState((prev) => ({
              ...prev,
              isRecording: false,
              isUploading: false,
              statusMessage: "Transcribing audio...",
              isTranscribing: true,
            }));

            // Check if online before finalizing
            if (!navigator.onLine) {
              // Save draft with pending finalization
              const { saveDraft } = await import("@/app/_lib/offline/draft");
              const { getOfflineDB } = await import("@/app/_lib/offline/db");

              const db = getOfflineDB();
              const draft = await db.draftVisits
                .where("visitIdRemote")
                .equals(visitId)
                .first();

              if (draft) {
                await db.draftVisits.update(draft.draftId, {
                  recordingSessionId: recordingSessionIdRef.current
                    ? recordingSessionIdRef.current
                    : undefined,
                });
              }

              toast.warning(
                "Connection lost. Recording saved. Finalization will resume when online."
              );
              setState({
                isRecording: false,
                isUploading: false,
                isTranscribing: false,
                isParsing: false,
                isFinalizing: false,
                recordingSessionId: null,
                statusMessage: null,
              });
              isStoppingRef.current = false;
              resolve();
              return;
            }

            // Calculate expected chunk count - use the actual chunk index (which is incremented after each chunk)
            // This accounts for the final chunk that might be emitted after stop()
            const finalExpectedChunks = chunkIndexRef.current;
            const finalRecordingDuration =
              Date.now() - recordingStartTimeRef.current;
            // We use 2000ms timeslice, so calculate expected chunks based on that
            // Add 1 to account for any partial chunk at the end
            const finalExpectedChunkCount = Math.max(
              finalExpectedChunks,
              Math.ceil(finalRecordingDuration / 2000) + 1 // 2 seconds per chunk, +1 for final partial chunk
            );

            let response: Response;
            try {
              response = await fetch(
                `/api/visits/${visitId}/recording/finalize`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    recordingSessionId:
                      recordingSessionIdRef.current || undefined,
                    expectedChunkCount: finalExpectedChunkCount,
                    mimeType: getBestMimeType(),
                  }),
                }
              );
            } catch (networkError) {
              // Network error - save for retry
              const { saveDraft } = await import("@/app/_lib/offline/draft");
              const { getOfflineDB } = await import("@/app/_lib/offline/db");

              const db = getOfflineDB();
              const draft = await db.draftVisits
                .where("visitIdRemote")
                .equals(visitId)
                .first();

              if (draft) {
                await db.draftVisits.update(draft.draftId, {
                  recordingSessionId: recordingSessionIdRef.current
                    ? recordingSessionIdRef.current
                    : undefined,
                });
              }

              toast.warning(
                "Connection lost. Recording saved. Finalization will resume when online."
              );
              setState({
                isRecording: false,
                isUploading: false,
                isTranscribing: false,
                isParsing: false,
                isFinalizing: false,
                recordingSessionId: null,
                statusMessage: null,
              });
              isStoppingRef.current = false;
              resolve();
              return;
            }

            if (!response.ok) {
              // If finalization fails, check if it's due to missing chunks (will retry later)
              const error = await response
                .json()
                .catch(() => ({ error: "Finalize failed" }));

              // If chunks are missing, they'll be retried by sync engine
              if (
                error.error?.includes("chunk") ||
                error.error?.includes("No chunks")
              ) {
                toast.warning(
                  "Some chunks are still uploading. Finalization will retry automatically."
                );
              } else {
                throw new Error(error.error || "Failed to finalize recording");
              }

              setState({
                isRecording: false,
                isUploading: false,
                isTranscribing: false,
                isParsing: false,
                isFinalizing: false,
                recordingSessionId: null,
                statusMessage: null,
              });
              isStoppingRef.current = false;
              resolve();
              return;
            }

            const data = await response.json();

            // Check if we have parsed note (parsing completed)
            if (data.parsedNote) {
              setState((prev) => ({
                ...prev,
                isRecording: false,
                isUploading: false,
                isTranscribing: false,
                statusMessage: "Parsing transcript...",
                isParsing: true,
              }));

              // Small delay to show parsing state before clearing
              await new Promise((r) => setTimeout(r, 800));
            }

            // Clear all states after processing completes
            setState({
              isRecording: false,
              isUploading: false,
              isTranscribing: false,
              isParsing: false,
              isFinalizing: false,
              recordingSessionId: null,
              statusMessage: null,
            });

            // Call callbacks with results
            if (data.transcript && onTranscriptReady) {
              onTranscriptReady(data.transcript);
            }

            if (data.parsedNote && onParseReady) {
              console.log("Calling onParseReady with:", data.parsedNote);
              onParseReady(data.parsedNote);
            }

            // Call finalize complete callback
            if (onFinalizeComplete) {
              console.log("Calling onFinalizeComplete with:", {
                transcript: data.transcript,
                parsedNote: data.parsedNote,
              });
              onFinalizeComplete({
                transcript: data.transcript,
                parsedNote: data.parsedNote,
              });
            }

            if (data.parsedNote) {
              toast.success("Recording finalized. Form updated with AI data.");
            } else {
              toast.success("Recording finalized. Transcription completed.");
            }

            // Cleanup
            cleanup();
            resolve();
          } catch (error) {
            console.error("Error finalizing recording:", error);
            toast.error(
              error instanceof Error
                ? error.message
                : "Failed to finalize recording"
            );
            setState({
              isRecording: false,
              isUploading: false,
              isTranscribing: false,
              isParsing: false,
              isFinalizing: false,
              recordingSessionId: null,
              statusMessage: null,
            });
            cleanup();
            isStoppingRef.current = false; // Reset guard flag
            resolve();
          }
        };

        // Now stop the recorder
        console.log("Stopping MediaRecorder", {
          state: mediaRecorder.state,
          totalChunks: uploadPromisesRef.current.length,
        });
        try {
          // Request any remaining data before stopping (important for iPad)
          // This ensures the final chunk is captured
          if (mediaRecorder.state === "recording") {
            // Request final data chunk
            mediaRecorder.requestData();
            console.log("Requested final data chunk");

            // Wait a bit for the final chunk to be emitted, then stop
            // Use a shorter delay and ensure we actually stop
            setTimeout(() => {
              try {
                if (
                  mediaRecorder.state === "recording" ||
                  mediaRecorder.state === "inactive"
                ) {
                  console.log("Stopping MediaRecorder after requestData", {
                    state: mediaRecorder.state,
                    totalChunksBeforeStop: uploadPromisesRef.current.length,
                  });
                  mediaRecorder.stop();
                } else {
                  console.log("MediaRecorder already stopped", {
                    state: mediaRecorder.state,
                  });
                }
              } catch (stopError) {
                console.error(
                  "Error stopping MediaRecorder after requestData:",
                  stopError
                );
                // Still resolve to prevent hanging
                resolve();
              }
            }, 200); // Increased delay slightly to ensure final chunk is processed
          } else {
            console.log(
              "MediaRecorder not in recording state, stopping directly",
              {
                state: mediaRecorder.state,
              }
            );
            mediaRecorder.stop();
          }
        } catch (error) {
          console.error("Error stopping MediaRecorder:", error);
          // Reset state on error
          setState({
            isRecording: false,
            isUploading: false,
            isTranscribing: false,
            isParsing: false,
            isFinalizing: false,
            recordingSessionId: null,
            statusMessage: null,
          });
          cleanup();
          resolve();
        }
      });
    } catch (error) {
      console.error("Error stopping recording:", error);
      toast.error("Failed to stop recording");
      setState((prev) => ({
        ...prev,
        isRecording: false,
        isUploading: false,
        isTranscribing: false,
      }));
      cleanup();
    }
  }, [state.isRecording, visitId]);

  // Cleanup audio context and sources
  const cleanup = useCallback(() => {
    // Reset stopping guard flag
    isStoppingRef.current = false;

    // Clear any intervals on MediaRecorder
    if (mediaRecorderRef.current) {
      const recorder = mediaRecorderRef.current as any;
      if (recorder.__stateMonitorInterval) {
        clearInterval(recorder.__stateMonitorInterval);
      }
      if (recorder.__dataRequestInterval) {
        clearInterval(recorder.__dataRequestInterval);
      }
      if (recorder.__chunkMonitorInterval) {
        clearInterval(recorder.__chunkMonitorInterval);
      }
    }

    // Disconnect all audio sources
    audioSourcesRef.current.forEach((source) => {
      try {
        source.disconnect();
      } catch (error) {
        // Ignore errors
      }
    });
    audioSourcesRef.current.clear();

    // Close audio context
    if (audioContextRef.current) {
      const audioCtx = audioContextRef.current as any;

      // Clear monitoring interval
      if (audioCtx.__monitorInterval) {
        clearInterval(audioCtx.__monitorInterval);
      }

      audioContextRef.current.close().catch(() => {
        // Ignore errors
      });
      audioContextRef.current = null;
    }

    // Stop tracks in mixed stream
    if (mixedStreamRef.current) {
      // Clear any monitoring intervals
      const stream = mixedStreamRef.current as any;
      if (stream.__trackMonitorInterval) {
        clearInterval(stream.__trackMonitorInterval);
      }

      // Stop all tracks in the mixed stream
      const tracks = mixedStreamRef.current.getTracks();
      tracks.forEach((track: MediaStreamTrack) => {
        track.stop();
      });
    }
  }, [room, state.isRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (
        state.isRecording ||
        state.isUploading ||
        state.isTranscribing ||
        state.isParsing ||
        state.isFinalizing
      ) {
        // Force cleanup if component unmounts while recording/processing
        cleanup();
        setState({
          isRecording: false,
          isUploading: false,
          isTranscribing: false,
          isParsing: false,
          isFinalizing: false,
          recordingSessionId: null,
          statusMessage: null,
        });
      }
    };
  }, []);

  // Get current status message
  const getStatusMessage = () => {
    if (state.statusMessage) return state.statusMessage;
    if (state.isRecording) return "Recording..."; // Always show "Recording..." when recording, even if uploading chunks
    if (state.isUploading) return "Uploading chunks...";
    if (state.isFinalizing) return "Finalizing recording...";
    if (state.isTranscribing) return "Transcribing audio...";
    if (state.isParsing) return "Parsing transcript...";
    return null;
  };

  return {
    isRecording: state.isRecording,
    isUploading: state.isUploading,
    isTranscribing: state.isTranscribing,
    isParsing: state.isParsing,
    isFinalizing: state.isFinalizing,
    statusMessage: getStatusMessage(),
    startRecording,
    stopRecording,
  };
}
