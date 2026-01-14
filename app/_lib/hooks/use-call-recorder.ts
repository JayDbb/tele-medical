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
  const createMixedStream = useCallback(() => {
    if (!room) return null;

    try {
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;

      const destination = audioCtx.createMediaStreamDestination();
      destinationRef.current = destination;

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
  }, [room]);

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
        const chunkFile = new File([chunk], `chunk-${chunkIndex}-${sessionId}`, {
          type: mimeType,
        });
        const fileId = await storeFile(chunkFile);
        
        // Save chunk info to draft for retry
        const db = getOfflineDB();
        const draft = await db.draftVisits
          .where("visitIdRemote")
          .equals(visitId)
          .first();
        
        if (draft) {
          const pendingChunks = JSON.parse(draft.pendingChunks || "[]") as string[];
          pendingChunks.push(JSON.stringify({
            fileId,
            chunkIndex,
            sessionId,
            mimeType,
            visitId,
          }));
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
          
          const chunkFile = new File([chunk], `chunk-${chunkIndex}-${sessionId}`, {
            type: mimeType,
          });
          const fileId = await storeFile(chunkFile);
          
          const db = getOfflineDB();
          const draft = await db.draftVisits
            .where("visitIdRemote")
            .equals(visitId)
            .first();
          
          if (draft) {
            const pendingChunks = JSON.parse(draft.pendingChunks || "[]") as string[];
            pendingChunks.push(JSON.stringify({
              fileId,
              chunkIndex,
              sessionId,
              mimeType,
              visitId,
            }));
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
          
          const chunkFile = new File([chunk], `chunk-${chunkIndex}-${sessionId}`, {
            type: mimeType,
          });
          const fileId = await storeFile(chunkFile);
          
          const db = getOfflineDB();
          const draft = await db.draftVisits
            .where("visitIdRemote")
            .equals(visitId)
            .first();
          
          if (draft) {
            const pendingChunks = JSON.parse(draft.pendingChunks || "[]") as string[];
            pendingChunks.push(JSON.stringify({
              fileId,
              chunkIndex,
              sessionId,
              mimeType,
              visitId,
            }));
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
      // Create mixed stream
      const mixedStream = createMixedStream();
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
        })),
        audioSourcesCount: audioSourcesRef.current.size,
        audioSourceKeys: Array.from(audioSourcesRef.current.keys()),
      });

      mixedStreamRef.current = mixedStream;

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

      // Track upload status
      let pendingUploads = 0;
      const incrementUploads = () => {
        pendingUploads++;
        setState((prev) => ({
          ...prev,
          isUploading: pendingUploads > 0,
          statusMessage:
            pendingUploads > 0 ? "Uploading chunks..." : "Recording...",
        }));
      };
      const decrementUploads = () => {
        pendingUploads = Math.max(0, pendingUploads - 1);
        setState((prev) => ({
          ...prev,
          isUploading: pendingUploads > 0,
          statusMessage:
            pendingUploads > 0 ? "Uploading chunks..." : "Recording...",
        }));
      };

      // Handle data available (chunks)
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
          const currentChunkIndex = chunkIndexRef.current;
          chunkIndexRef.current++;

          // Upload chunk asynchronously
          incrementUploads();
          uploadChunk(event.data, currentChunkIndex, sessionId, mimeType)
            .then(() => {
              decrementUploads();
            })
            .catch((error) => {
              console.error(
                `Error uploading chunk ${currentChunkIndex}:`,
                error
              );
              decrementUploads();
            });
        }
      };

      // Handle errors - don't auto-stop on error, just log
      mediaRecorder.onerror = (event: any) => {
        console.error("MediaRecorder error:", event.error);
        toast.error(
          `Recording error: ${event.error?.message || "Unknown error"}`
        );
        // Don't stop recording on error, let user decide
      };

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
      try {
        mediaRecorder.start(2000);
        console.log("MediaRecorder started successfully", {
          state: mediaRecorder.state,
          mimeType: mediaRecorder.mimeType,
        });

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
        // If we can't mark it as explicit, don't proceed with finalization
        return;
      }

      // Only set finalizing state AFTER we've confirmed it's an explicit stop
      setState((prev) => ({
        ...prev,
        isFinalizing: true,
        statusMessage: "Finalizing recording...",
      }));

      return new Promise<void>((resolve) => {
        // REPLACE the onstop handler (the guard handler will have already checked the flag)
        // Now we set the actual finalization handler
        mediaRecorder.onstop = async () => {
          console.log("onstop handler in stopRecording called");
          try {
            // Wait for any pending uploads to complete
            setState((prev) => ({
              ...prev,
              statusMessage: "Waiting for uploads to complete...",
            }));

            // Give a moment for pending uploads
            await new Promise((r) => setTimeout(r, 1000));

            // Finalize recording on server
            setState((prev) => ({
              ...prev,
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
                  recordingSessionId: recordingSessionIdRef.current ? recordingSessionIdRef.current : undefined,
                });
              }
              
              toast.warning("Connection lost. Recording saved. Finalization will resume when online.");
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

            let response: Response;
            try {
              response = await fetch(
                `/api/visits/${visitId}/recording/finalize`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    recordingSessionId: recordingSessionIdRef.current || undefined,
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
                  recordingSessionId: recordingSessionIdRef.current ? recordingSessionIdRef.current : undefined,
                });
              }
              
              toast.warning("Connection lost. Recording saved. Finalization will resume when online.");
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
              if (error.error?.includes("chunk") || error.error?.includes("No chunks")) {
                toast.warning("Some chunks are still uploading. Finalization will retry automatically.");
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
                statusMessage: "Parsing transcript...",
                isParsing: true,
              }));

              // Small delay to show parsing state
              await new Promise((r) => setTimeout(r, 500));
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
        console.log("Stopping MediaRecorder");
        try {
          mediaRecorder.stop();
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
      audioContextRef.current.close().catch(() => {
        // Ignore errors
      });
      audioContextRef.current = null;
    }

    // Stop tracks in mixed stream
    if (mixedStreamRef.current) {
      mixedStreamRef.current.getTracks().forEach((track) => track.stop());
      mixedStreamRef.current = null;
    }

    destinationRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  // Handle new remote tracks being added during recording
  useEffect(() => {
    if (
      !room ||
      !state.isRecording ||
      !audioContextRef.current ||
      !destinationRef.current
    ) {
      return;
    }

    const handleTrackSubscribed = (track: any, participant: any) => {
      if (track.kind === "audio" && track.mediaStreamTrack) {
        try {
          const stream = new MediaStream([track.mediaStreamTrack]);
          const source =
            audioContextRef.current!.createMediaStreamSource(stream);
          source.connect(destinationRef.current!);
          audioSourcesRef.current.set(
            `remote-${participant.sid}-${track.sid}`,
            source
          );
        } catch (error) {
          console.error("Error adding remote track to mix:", error);
        }
      }
    };

    const handleTrackUnsubscribed = (track: any, participant: any) => {
      const key = `remote-${participant.sid}-${track.sid}`;
      const source = audioSourcesRef.current.get(key);
      if (source) {
        try {
          source.disconnect();
        } catch (error) {
          // Ignore errors
        }
        audioSourcesRef.current.delete(key);
      }
    };

    // Listen to all participants for track events
    room.participants.forEach((participant: any) => {
      participant.on("trackSubscribed", (track: any) =>
        handleTrackSubscribed(track, participant)
      );
      participant.on("trackUnsubscribed", (track: any) =>
        handleTrackUnsubscribed(track, participant)
      );
    });

    room.on(
      "trackSubscribed",
      (track: any, publication: any, participant: any) => {
        if (track.kind === "audio") {
          handleTrackSubscribed(track, participant);
        }
      }
    );

    room.on(
      "trackUnsubscribed",
      (track: any, publication: any, participant: any) => {
        if (track.kind === "audio") {
          handleTrackUnsubscribed(track, participant);
        }
      }
    );

    return () => {
      // Cleanup listeners would be handled by room cleanup
    };
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
    if (state.isRecording) return "Recording...";
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
