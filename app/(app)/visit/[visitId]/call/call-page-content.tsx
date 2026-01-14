"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Video, VideoOff, Mic, MicOff, PhoneOff, ChevronRight, ChevronLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { NewVisitForm } from "@/app/_components/visit/new-visit-form";
import type { PatientBasics } from "@/app/_lib/db/drizzle/queries/patient";
import { cn } from "@/app/_lib/utils/cn";
import { useCallRecorder } from "@/app/_lib/hooks/use-call-recorder";

interface CallPageContentProps {
  visitId: string;
  patientId: string;
  patientBasics: PatientBasics;
  roomName: string;
  userId: string;
  userRole: string;
  existingVisitData?: unknown;
}

export function CallPageContent({
  visitId,
  patientId,
  patientBasics,
  roomName,
  userId,
  userRole,
  existingVisitData,
}: CallPageContentProps) {
  const router = useRouter();
  const [isConnected, setIsConnected] = React.useState(false);

  // When doctor joins the call, update patient assignment
  React.useEffect(() => {
    const updateAssignment = async () => {
      try {
        const { updatePatientAssignmentAction } = await import("@/app/_actions/patients");
        await updatePatientAssignmentAction(patientId, "start-visit");
      } catch (error) {
        console.error("Error updating patient assignment:", error);
      }
    };

    if (isConnected) {
      updateAssignment();
    }
  }, [isConnected, patientId]);
  const [isMuted, setIsMuted] = React.useState(false);
  const [isVideoOff, setIsVideoOff] = React.useState(false);
  const [showPatientInfo, setShowPatientInfo] = React.useState(false); // Default to closed - user can open when needed
  const [isMobile, setIsMobile] = React.useState(false);
  const [isTablet, setIsTablet] = React.useState(false);
  const [room, setRoom] = React.useState<any>(null);
  const [showEndCallDialog, setShowEndCallDialog] = React.useState(false);
  const saveVisitRef = React.useRef<(() => Promise<void>) | null>(null);

  // Detect mobile and tablet devices
  React.useEffect(() => {
    const checkDevice = () => {
      const width = window.innerWidth;
      setIsMobile(width < 768); // md breakpoint
      setIsTablet(width >= 768 && width < 1280); // md to xl (iPad range)
    };

    checkDevice();
    window.addEventListener("resize", checkDevice);
    return () => window.removeEventListener("resize", checkDevice);
  }, []);
  const [localTrack, setLocalTrack] = React.useState<any>(null);
  const [remoteTracks, setRemoteTracks] = React.useState<any[]>([]);
  const localVideoRef = React.useRef<HTMLVideoElement>(null);
  const remoteVideoRef = React.useRef<HTMLVideoElement>(null);
  const [token, setToken] = React.useState<string | null>(null);

  // Refs to track current values for cleanup
  const roomRef = React.useRef<any>(null);
  const localTrackRef = React.useRef<any>(null);
  const remoteTracksRef = React.useRef<any[]>([]);

  // Keep refs in sync with state
  React.useEffect(() => {
    roomRef.current = room;
  }, [room]);

  React.useEffect(() => {
    localTrackRef.current = localTrack;
  }, [localTrack]);

  React.useEffect(() => {
    remoteTracksRef.current = remoteTracks;
  }, [remoteTracks]);

  // Get Twilio token
  React.useEffect(() => {
    const fetchToken = async () => {
      try {
        const response = await fetch("/api/video/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appointmentId: visitId,
            role: "doctor",
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to get video token");
        }

        const data = await response.json();
        setToken(data.token);
      } catch (error) {
        console.error("Error fetching token:", error);
        toast.error("Failed to initialize video call");
      }
    };

    fetchToken();
  }, [visitId]);

  // Connect to Twilio room
  React.useEffect(() => {
    if (!token || !roomName) return;

    // Prevent multiple simultaneous connection attempts
    let isConnecting = false;
    let connectionAborted = false;

    const connectToRoom = async () => {
      // If already connecting or connected, don't try again
      if (isConnecting || roomRef.current) {
        console.log("Already connecting or connected, skipping");
        return;
      }

      isConnecting = true;

      try {
        // IMPORTANT: Disconnect from any existing room connection first
        // This prevents "duplicate identity" errors
        if (roomRef.current) {
          console.log("Disconnecting from existing room before reconnecting");
          try {
            roomRef.current.disconnect();
            // Wait a bit for disconnect to complete
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (disconnectError) {
            console.error("Error disconnecting existing room:", disconnectError);
          }
          roomRef.current = null;
          setRoom(null);
          setIsConnected(false);
        }

        // Check if connection was aborted (component unmounted or dependencies changed)
        if (connectionAborted) {
          console.log("Connection aborted");
          return;
        }

        const { connect, createLocalVideoTrack, createLocalAudioTrack } = await import("twilio-video");

        // Create local tracks
        const videoTrack = await createLocalVideoTrack();
        const audioTrack = await createLocalAudioTrack();

        console.log("Created local tracks", {
          hasVideoTrack: !!videoTrack,
          hasAudioTrack: !!audioTrack,
          hasVideoRef: !!localVideoRef.current
        });

        setLocalTrack({ video: videoTrack, audio: audioTrack });

        // Attach video to local element
        if (localVideoRef.current) {
          console.log("Attaching local video to ref");
          try {
            videoTrack.attach(localVideoRef.current);
            console.log("Local video attached successfully");
          } catch (error) {
            console.error("Error attaching local video:", error);
          }
        } else {
          console.log("Local video ref not available yet, will retry in useEffect");
        }

        // Connect to room
        const twilioRoom = await connect(token, {
          name: roomName,
          tracks: [videoTrack, audioTrack],
        });

        setRoom(twilioRoom);
        setIsConnected(true);

        // Ensure local tracks are set
        setLocalTrack({ video: videoTrack, audio: audioTrack });

        // Handle remote participants (patient) - unified handler
        const handleParticipant = (participant: any) => {
          console.log("Handling participant:", participant.identity, {
            tracksCount: participant.tracks.size,
            participantState: participant.state
          });

          // Subscribe to existing tracks
          participant.tracks.forEach((publication: any) => {
            console.log("Processing publication:", {
              trackName: publication.trackName,
              isSubscribed: publication.isSubscribed,
              hasTrack: !!publication.track,
              kind: publication.track?.kind
            });

            if (publication.track) {
              console.log("Found existing track:", publication.track.kind, {
                trackState: publication.track.readyState,
                isEnabled: publication.track.isEnabled
              });
              setRemoteTracks((prev) => {
                if (prev.includes(publication.track)) {
                  console.log("Track already in state, skipping");
                  return prev;
                }
                console.log("Adding track to state");
                return [...prev, publication.track];
              });

              // Try to attach immediately
              if (publication.track.kind === "video") {
                setTimeout(() => {
                  if (remoteVideoRef.current) {
                    console.log("Attaching video track immediately");
                    try {
                      publication.track.attach(remoteVideoRef.current);
                    } catch (error) {
                      console.error("Error attaching track immediately:", error);
                    }
                  }
                }, 100);
              } else if (publication.track.kind === "audio") {
                // Attach audio track to the remote video element (video elements can play audio)
                setTimeout(() => {
                  if (remoteVideoRef.current) {
                    console.log("Attaching audio track immediately");
                    try {
                      publication.track.attach(remoteVideoRef.current);
                    } catch (error) {
                      console.error("Error attaching audio track immediately:", error);
                    }
                  }
                }, 100);
              }
            } else {
              // Subscribe to track when it becomes available
              console.log("Setting up subscription listener for:", publication.trackName);
              publication.on("subscribed", (track: any) => {
                console.log("Track subscribed via listener:", track.kind, {
                  trackState: track.readyState
                });
                setRemoteTracks((prev) => {
                  if (prev.includes(track)) return prev;
                  return [...prev, track];
                });
                setTimeout(() => {
                  if (remoteVideoRef.current) {
                    console.log("Attaching subscribed track:", track.kind);
                    try {
                      track.attach(remoteVideoRef.current);
                    } catch (error) {
                      console.error("Error attaching subscribed track:", error);
                    }
                  }
                }, 100);
              });
            }
          });

          // Listen for new tracks
          participant.on("trackSubscribed", (track: any) => {
            console.log("Track subscribed event:", track.kind, {
              trackState: track.readyState
            });
            setRemoteTracks((prev) => {
              if (prev.includes(track)) return prev;
              return [...prev, track];
            });
            setTimeout(() => {
              if (remoteVideoRef.current) {
                console.log("Attaching track from trackSubscribed event:", track.kind);
                try {
                  track.attach(remoteVideoRef.current);
                } catch (error) {
                  console.error("Error attaching track from event:", error);
                }
              }
            }, 100);
          });

          participant.on("trackUnsubscribed", (track: any) => {
            console.log("Track unsubscribed:", track.kind);
            setRemoteTracks((prev) => prev.filter((t) => t !== track));
            track.detach();
          });
        };

        twilioRoom.on("participantConnected", handleParticipant);

        twilioRoom.on("participantDisconnected", (participant: any) => {
          console.log("Participant disconnected:", participant.identity);
          // Clear remote tracks when participant disconnects
          setRemoteTracks([]);
        });

        // Cleanup on room disconnect
        twilioRoom.on("disconnected", () => {
          cleanupTwilioConnection();
        });

        // Handle existing participants (patient)
        twilioRoom.participants.forEach(handleParticipant);

        isConnecting = false;
      } catch (error) {
        isConnecting = false;
        console.error("Error connecting to room:", error);

        // Check if it's a duplicate identity error
        if (error instanceof Error && error.message.includes("duplicate identity")) {
          console.log("Duplicate identity error - disconnecting and retrying");
          // Disconnect and wait before retrying
          if (roomRef.current) {
            try {
              roomRef.current.disconnect();
            } catch (e) {
              // Ignore disconnect errors
            }
            roomRef.current = null;
            setRoom(null);
            setIsConnected(false);
          }
          // Retry after a delay
          setTimeout(() => {
            if (!connectionAborted) {
              connectToRoom();
            }
          }, 1000);
        } else {
          toast.error("Failed to connect to video call");
        }
      }
    };

    connectToRoom();

    // Cleanup function - will run when dependencies change or component unmounts
    return () => {
      connectionAborted = true;
      cleanupTwilioConnection();
    };
  }, [token, roomName]);

  // Cleanup function for Twilio connection
  const cleanupTwilioConnection = React.useCallback(() => {
    // Disconnect from room
    if (roomRef.current) {
      try {
        roomRef.current.disconnect();
      } catch (error) {
        console.error("Error disconnecting room:", error);
      }
      roomRef.current = null;
    }

    // Detach and stop local tracks
    if (localTrackRef.current) {
      try {
        if (localTrackRef.current.video) {
          localTrackRef.current.video.detach();
          localTrackRef.current.video.stop();
        }
        if (localTrackRef.current.audio) {
          localTrackRef.current.audio.detach();
          localTrackRef.current.audio.stop();
        }
      } catch (error) {
        console.error("Error stopping local tracks:", error);
      }
      localTrackRef.current = null;
    }

    // Detach and stop remote tracks
    remoteTracksRef.current.forEach((track) => {
      try {
        track.detach();
        if (track.stop) {
          track.stop();
        }
      } catch (error) {
        console.error("Error stopping remote track:", error);
      }
    });
    remoteTracksRef.current = [];

    // Clear video element sources
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }, []);

  // Cleanup on component unmount
  React.useEffect(() => {
    return () => {
      cleanupTwilioConnection();
    };
  }, [cleanupTwilioConnection]);

  // Reattach local video when ref becomes available
  React.useEffect(() => {
    if (localTrack?.video && localVideoRef.current) {
      console.log("Reattaching local video", {
        hasTrack: !!localTrack.video,
        hasRef: !!localVideoRef.current
      });
      try {
        localTrack.video.attach(localVideoRef.current);
        console.log("Local video attached successfully");
      } catch (error) {
        console.error("Error attaching local video:", error);
      }
    } else {
      console.log("Cannot attach local video", {
        hasTrack: !!localTrack?.video,
        hasRef: !!localVideoRef.current
      });
    }
  }, [localTrack]);

  // Reattach remote video tracks when ref becomes available
  React.useEffect(() => {
    if (remoteVideoRef.current) {
      const videoTrack = remoteTracks.find(t => t.kind === "video");
      if (videoTrack) {
        console.log("Reattaching remote video track", {
          hasTrack: !!videoTrack,
          hasRef: !!remoteVideoRef.current,
          remoteTracksCount: remoteTracks.length
        });
        try {
          videoTrack.attach(remoteVideoRef.current);
          console.log("Remote video attached successfully");
        } catch (error) {
          console.error("Error attaching remote video:", error);
        }
      } else {
        console.log("No remote video track found", { remoteTracksCount: remoteTracks.length });
      }
    } else {
      console.log("Remote video ref not available");
    }
  }, [remoteTracks]);

  // Use call recorder hook for client-side recording (after room is set)
  const [parsedNoteData, setParsedNoteData] = React.useState<any>(null);
  const parseReadyCallbackRef = React.useRef<((parsed: any) => void) | null>(null);

  const {
    isRecording,
    isUploading,
    isTranscribing,
    isParsing,
    isFinalizing,
    statusMessage,
    startRecording: startCallRecording,
    stopRecording: stopCallRecording,
  } = useCallRecorder({
    room,
    visitId,
    onTranscriptReady: (transcript) => {
      console.log("Transcript ready:", transcript);
    },
    onParseReady: (parsed) => {
      console.log("Parse ready:", parsed);
      setParsedNoteData(parsed);
      // Also call the callback if it's been set
      if (parseReadyCallbackRef.current) {
        parseReadyCallbackRef.current(parsed);
      }
    },
    onFinalizeComplete: (data) => {
      console.log("Finalize complete:", data);
      if (data.parsedNote) {
        console.log("Setting parsed note data:", data.parsedNote);
        setParsedNoteData(data.parsedNote);
        // Also call the callback if it's been set
        if (parseReadyCallbackRef.current) {
          parseReadyCallbackRef.current(data.parsedNote);
        }
      }
    },
  });

  // Cleanup recording state on unmount only
  // Use refs to capture current values without triggering on dependency changes
  const isRecordingRef = React.useRef(isRecording);
  const isUploadingRef = React.useRef(isUploading);
  const isTranscribingRef = React.useRef(isTranscribing);
  const isParsingRef = React.useRef(isParsing);
  const isFinalizingRef = React.useRef(isFinalizing);
  const stopCallRecordingRef = React.useRef(stopCallRecording);

  // Update refs when values change
  React.useEffect(() => {
    isRecordingRef.current = isRecording;
    isUploadingRef.current = isUploading;
    isTranscribingRef.current = isTranscribing;
    isParsingRef.current = isParsing;
    isFinalizingRef.current = isFinalizing;
    stopCallRecordingRef.current = stopCallRecording;
  }, [isRecording, isUploading, isTranscribing, isParsing, isFinalizing, stopCallRecording]);

  // Cleanup on unmount only (no dependencies that would trigger cleanup on change)
  React.useEffect(() => {
    return () => {
      // If we're leaving the page and recording is active, stop it
      if (
        isRecordingRef.current ||
        isUploadingRef.current ||
        isTranscribingRef.current ||
        isParsingRef.current ||
        isFinalizingRef.current
      ) {
        stopCallRecordingRef.current().catch(console.error);
      }
    };
  }, []); // Empty deps - only runs on unmount

  const toggleMute = () => {
    if (localTrack?.audio) {
      if (isMuted) {
        localTrack.audio.enable();
      } else {
        localTrack.audio.disable();
      }
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localTrack?.video) {
      if (isVideoOff) {
        localTrack.video.enable();
      } else {
        localTrack.video.disable();
      }
      setIsVideoOff(!isVideoOff);
    }
  };

  const handleEndCall = async () => {
    // Show confirmation dialog
    setShowEndCallDialog(true);
  };

  const handleEndCallConfirm = async (saveVisit: boolean) => {
    setShowEndCallDialog(false);

    // Stop recording if active
    if (isRecording || isUploading || isTranscribing || isParsing || isFinalizing) {
      try {
        await stopCallRecording();
        // Give a moment for cleanup
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error("Error stopping recording:", error);
      }
    }

    // Cleanup Twilio connection
    cleanupTwilioConnection();

    if (saveVisit) {
      // Trigger save if the ref is available (form is loaded)
      if (saveVisitRef.current) {
        try {
          await saveVisitRef.current();
          // After save, navigate to form page with saved=true to trigger post-save modal
          router.push(`/patients/${patientId}/new-visit?visitId=${visitId}&saved=true`);
        } catch (error) {
          console.error("Error saving visit:", error);
          toast.error("Failed to save visit. Redirecting to form page...");
          // Navigate anyway so user can save manually
          router.push(`/patients/${patientId}/new-visit?visitId=${visitId}`);
        }
      } else {
        // Form not loaded yet, navigate to form page
        router.push(`/patients/${patientId}/new-visit?visitId=${visitId}`);
      }
    } else {
      // Just end the call without saving - navigate back to patient or waiting room
      router.push(`/patients/${patientId}`);
    }
  };

  const handleStartRecording = async () => {
    if (!room) {
      toast.error("Room not connected. Please wait for connection.");
      return;
    }

    await startCallRecording();
  };

  const handleStopRecording = async () => {
    await stopCallRecording();
  };

  return (
    <div className="relative h-screen w-full overflow-hidden">
      {/* Main Video Area - Flex container for video and notes */}
      <div className="flex flex-row h-full w-full">
        {/* Video Section */}
        <div className="flex flex-col h-full flex-1 min-w-0">
          {/* Video Grid */}
          <div className="flex-1 relative bg-black">
            {/* Remote Video (Patient) */}
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-contain"
                style={{ display: remoteTracks.some(t => t.kind === "video") ? "block" : "none" }}
              // Ensure audio plays (not muted)
              />
              {!remoteTracks.some(t => t.kind === "video") && (
                <div className="text-white text-center absolute inset-0 flex items-center justify-center">
                  <p className="text-lg">Waiting for patient to join...</p>
                </div>
              )}
            </div>

            {/* Local Video (Self View) */}
            <div className="absolute bottom-4 right-4 w-48 h-36 rounded-lg overflow-hidden border-2 border-white shadow-lg bg-black z-10">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ display: localTrack?.video ? "block" : "none" }}
              />
            </div>

            {/* Status Indicator */}
            {(isRecording || isUploading || isTranscribing || isParsing || isFinalizing) && statusMessage && (
              <div className={`absolute top-4 left-4 flex items-center gap-2 text-white px-3 py-1.5 rounded-full ${isRecording ? "bg-red-600" :
                isUploading ? "bg-blue-600" :
                  isTranscribing ? "bg-purple-600" :
                    isParsing ? "bg-indigo-600" :
                      isFinalizing ? "bg-orange-600" :
                        "bg-gray-600"
                }`}>
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                <span className="text-sm font-medium">{statusMessage}</span>
              </div>
            )}
          </div>

          {/* Controls Bar */}
          <div className="bg-background border-t p-4 flex items-center justify-center gap-4">
            <Button
              variant={isMuted ? "destructive" : "outline"}
              size="icon"
              onClick={toggleMute}
            >
              {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>
            <Button
              variant={isVideoOff ? "destructive" : "outline"}
              size="icon"
              onClick={toggleVideo}
            >
              {isVideoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
            </Button>
            {isRecording || isUploading || isTranscribing || isParsing || isFinalizing ? (
              <Button
                variant="destructive"
                onClick={handleStopRecording}
                className="gap-2"
                disabled={isFinalizing || isTranscribing || isParsing}
              >
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                <span>
                  {statusMessage ||
                    (isFinalizing ? "Finalizing..." :
                      isTranscribing ? "Transcribing..." :
                        isParsing ? "Parsing..." :
                          isUploading ? "Uploading..." :
                            "Stop Recording")}
                </span>
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={handleStartRecording}
              >
                Start Recording
              </Button>
            )}
            <Button
              variant={showPatientInfo ? "default" : "outline"}
              size="icon"
              onClick={() => setShowPatientInfo(!showPatientInfo)}
              title={showPatientInfo ? "Hide Notes" : "Show Notes"}
            >
              <FileText className="h-5 w-5" />
            </Button>
            <Button
              variant="destructive"
              size="icon"
              onClick={handleEndCall}
            >
              <PhoneOff className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Patient Info Panel - Desktop (xl+): Side Panel */}
        {showPatientInfo && !isTablet && (
          <div className="hidden xl:flex flex-col h-full w-[450px] bg-background overflow-y-auto z-20">
            <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-background z-10">
              <h2 className="font-semibold text-lg">Notes</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPatientInfo(false)}
                className="gap-2"
              >
                <ChevronRight className="h-4 w-4" />
                <span>Collapse</span>
              </Button>
            </div>
            <div className="p-4">
              <NewVisitForm
                patientId={patientId}
                patientBasics={patientBasics}
                userId={userId}
                userRole={userRole}
                existingVisitId={visitId}
                existingVisitData={existingVisitData}
                isRecording={isRecording}
                onStartRecording={handleStartRecording}
                onStopRecording={handleStopRecording}
                hideAICapture={true}
                initialParsedData={parsedNoteData}
                onSaveReadyRef={saveVisitRef}
                isInVideoCall={true}
              />
            </div>
          </div>
        )}

        {/* Patient Info Panel - Tablet (iPad): Side Panel (wider) */}
        {showPatientInfo && isTablet && (
          <div className="hidden md:flex xl:hidden flex-col h-full w-[45%] min-w-[500px] max-w-[600px] bg-background overflow-y-auto z-20">
            <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-background z-10">
              <h2 className="font-semibold text-lg">Notes</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPatientInfo(false)}
                className="gap-2"
              >
                <ChevronRight className="h-4 w-4" />
                <span>Collapse</span>
              </Button>
            </div>
            <div className="p-4">
              <NewVisitForm
                patientId={patientId}
                patientBasics={patientBasics}
                userId={userId}
                userRole={userRole}
                existingVisitId={visitId}
                existingVisitData={existingVisitData}
                isRecording={isRecording}
                onStartRecording={handleStartRecording}
                onStopRecording={handleStopRecording}
                hideAICapture={true}
                initialParsedData={parsedNoteData}
                onSaveReadyRef={saveVisitRef}
                isInVideoCall={true}
              />
            </div>
          </div>
        )}
      </div>


      {/* Patient Info Panel - Mobile: Modal */}
      <Dialog
        open={isMobile && showPatientInfo}
        onOpenChange={(open) => {
          if (isMobile) {
            setShowPatientInfo(open);
          }
        }}
      >
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-y-auto p-0">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>Notes</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 overflow-y-auto max-h-[calc(95vh-80px)]">
            <NewVisitForm
              patientId={patientId}
              patientBasics={patientBasics}
              userId={userId}
              userRole={userRole}
              existingVisitId={visitId}
              existingVisitData={existingVisitData}
              isRecording={isRecording}
              onStartRecording={handleStartRecording}
              onStopRecording={handleStopRecording}
              hideAICapture={true}
              initialParsedData={parsedNoteData}
              onParseReadyRef={parseReadyCallbackRef}
              onSaveReadyRef={saveVisitRef}
              isInVideoCall={true}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* End Call Confirmation Dialog */}
      <Dialog open={showEndCallDialog} onOpenChange={setShowEndCallDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>End Call</DialogTitle>
            <DialogDescription>
              Would you like to save the visit before ending the call?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => handleEndCallConfirm(false)}
              className="w-full sm:w-auto"
            >
              End Without Saving
            </Button>
            <Button
              variant="default"
              onClick={() => handleEndCallConfirm(true)}
              className="w-full sm:w-auto"
            >
              Save Visit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

