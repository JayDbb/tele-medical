"use client";

import * as React from "react";
import { useState, useRef } from "react";
import { Mic, Upload, Loader2, FileAudio, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { _convertToMP3Internal, preloadLamejs } from "@/app/_lib/utils/audioConverter";
import { storeFile } from "@/app/_lib/offline/files";
import { toast } from "sonner";

interface AICapturePanelProps {
    patientId: string;
    onTranscriptReady: (transcript: string) => void;
    onParseReady: (parsed: unknown) => void;
}

type CaptureState =
    | "idle"
    | "recording"
    | "converting"
    | "uploading"
    | "transcribing"
    | "parsing"
    | "complete";

export function AICapturePanel({
    patientId,
    onTranscriptReady,
    onParseReady,
}: AICapturePanelProps) {
    const [activeTab, setActiveTab] = useState<"record" | "upload">("record");
    const [state, setState] = useState<CaptureState>("idle");
    const [progress, setProgress] = useState(0);
    const [recordingTime, setRecordingTime] = useState(0);
    const [transcript, setTranscript] = useState<string | null>(null);
    const [previousTranscripts, setPreviousTranscripts] = useState<string[]>([]);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Pre-load lamejs when component mounts (if online)
    React.useEffect(() => {
        if (navigator.onLine) {
            preloadLamejs().catch((error) => {
                console.warn("Failed to preload lamejs:", error);
            });
        }
    }, []);

    // Recording functions
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
                await handleAudioBlob(audioBlob);
                stream.getTracks().forEach((track) => track.stop());
            };

            mediaRecorder.start();
            setState("recording");
            setRecordingTime(0);

            // Start timer
            timerRef.current = setInterval(() => {
                setRecordingTime((prev) => prev + 1);
            }, 1000);
        } catch (error) {
            console.error("Error starting recording:", error);
            toast.error("Failed to start recording");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
            setState("converting");
        }
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith("audio/")) {
            toast.error("Please select an audio file");
            return;
        }

        setState("converting");
        const audioBlob = new Blob([file], { type: file.type });
        await handleAudioBlob(audioBlob);
    };

    const handleAudioBlob = async (audioBlob: Blob) => {
        try {
            setProgress(20);

            // Try to convert to MP3, but handle failures gracefully
            let processedBlob: Blob = audioBlob;
            let fileExtension = "webm";
            let mimeType = audioBlob.type || "audio/webm";

            try {
                processedBlob = await _convertToMP3Internal(audioBlob);
                fileExtension = "mp3";
                mimeType = "audio/mpeg";
                setProgress(40);
            } catch (conversionError: any) {
                // If conversion fails (e.g., offline, chunk load error), use original format
                console.warn("MP3 conversion failed, using original format:", conversionError);
                if (conversionError.message?.includes("offline") || conversionError.message?.includes("chunk")) {
                    toast.warning("MP3 conversion unavailable. Storing audio in original format.");
                }
                // Continue with original blob
                setProgress(40);
            }

            // Store file locally FIRST (always, even if online) for offline support
            const file = new File([processedBlob], `recording-${Date.now()}.${fileExtension}`, {
                type: mimeType,
            });
            const fileId = await storeFile(file);
            setProgress(60);

            // Check if online - new endpoint requires online connection
            const isOnline = navigator.onLine;
            if (!isOnline) {
                // Queue for later processing when online
                const { saveDraft } = await import("@/app/_lib/offline/draft");
                const { getOfflineDB } = await import("@/app/_lib/offline/db");

                const db = getOfflineDB();
                const draft = await db.draftVisits
                    .where("patientId")
                    .equals(patientId)
                    .first();

                if (draft) {
                    await db.draftVisits.update(draft.draftId, {
                        pendingParsing: JSON.stringify({
                            audioFileId: fileId,
                            previousTranscripts: previousTranscripts.length > 0 ? previousTranscripts : undefined,
                            patientId,
                        }),
                    });
                }

                toast.warning("Connection lost. Audio saved locally. Processing will resume when online.");
                setState("idle");
                setProgress(0);
                return;
            }

            setProgress(60);

            // Upload to Supabase Storage via API route (RLS requires server-side upload with service role)
            // Structure: visits/{patientId}/{fileId}/{timestamp}.mp3
            const path = `visits/${patientId}/${fileId}/${Date.now()}.${fileExtension}`;
            let audioPath: string | null = null;

            try {
                setState("uploading");
                const uploadFormData = new FormData();
                uploadFormData.append("file", processedBlob, `recording-${Date.now()}.${fileExtension}`);
                uploadFormData.append("path", path);

                const uploadResponse = await fetch("/api/upload/audio", {
                    method: "POST",
                    body: uploadFormData,
                });

                if (uploadResponse.ok) {
                    const uploadData = await uploadResponse.json();
                    audioPath = uploadData.path || path;
                    setProgress(80);
                } else {
                    throw new Error("Upload failed");
                }
            } catch (uploadError) {
                console.warn("Upload failed:", uploadError);
                // Queue for retry
                const { saveDraft } = await import("@/app/_lib/offline/draft");
                const { getOfflineDB } = await import("@/app/_lib/offline/db");

                const db = getOfflineDB();
                const draft = await db.draftVisits
                    .where("patientId")
                    .equals(patientId)
                    .first();

                if (draft) {
                    await db.draftVisits.update(draft.draftId, {
                        pendingParsing: JSON.stringify({
                            audioFileId: fileId,
                            audioPath: path,
                            previousTranscripts: previousTranscripts.length > 0 ? previousTranscripts : undefined,
                            patientId,
                        }),
                    });
                }

                toast.warning("Upload failed. Audio saved locally. Processing will resume when online.");
                setState("idle");
                setProgress(0);
                return;
            }

            // Transcribe and parse in one step using OpenRouter endpoint
            try {
                setState("transcribing");
                const parseResponse = await fetch("/api/ai/parse-audio-openrouter", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        audioPath,
                        previousTranscripts: previousTranscripts.length > 0 ? previousTranscripts : undefined,
                    }),
                });

                if (!parseResponse.ok) {
                    // Processing failed, queue for retry
                    const { saveDraft } = await import("@/app/_lib/offline/draft");
                    const { getOfflineDB } = await import("@/app/_lib/offline/db");

                    const db = getOfflineDB();
                    const draft = await db.draftVisits
                        .where("patientId")
                        .equals(patientId)
                        .first();

                    if (draft) {
                        await db.draftVisits.update(draft.draftId, {
                            pendingParsing: JSON.stringify({
                                audioFileId: fileId,
                                audioPath: audioPath || path,
                                previousTranscripts: previousTranscripts.length > 0 ? previousTranscripts : undefined,
                                patientId,
                            }),
                        });
                    }

                    throw new Error("Processing failed, will retry when connection is restored");
                }

                const { parsed, transcript: newTranscript } = await parseResponse.json();

                if (!parsed) {
                    throw new Error("Parsing returned empty result");
                }

                // Replicate Whisper provides transcript, so we should always have one
                // But handle edge case where transcript might be empty
                const transcriptText = newTranscript || "No transcript available";

                setTranscript(transcriptText);
                if (newTranscript && newTranscript.trim().length > 0) {
                    // Save transcript via callback (will save to draft and database if visit exists)
                    onTranscriptReady(newTranscript);
                    // Add to previous transcripts for context in next recording
                    setPreviousTranscripts((prev) => [...prev, newTranscript]);
                } else {
                    // Still show something in UI even if transcript is empty
                    setTranscript("Transcript processing completed, but no transcript text was returned.");
                }
                onParseReady(parsed);

                setProgress(100);
                setState("complete");

                toast.success("Audio processed successfully");

                // Reset state after a short delay to allow recording again
                setTimeout(() => {
                    setState("idle");
                    setProgress(0);
                }, 2000);
            } catch (processError) {
                console.error("Error processing audio:", processError);
                toast.warning("Processing failed. Will retry when connection is restored.");
                setState("idle");
                setProgress(0);
            }
        } catch (error) {
            console.error("Error processing audio:", error);
            const errorMessage = error instanceof Error ? error.message : "Processing failed";

            // If it's a network error, we've already saved locally
            if (errorMessage.includes("retry") || errorMessage.includes("offline")) {
                toast.warning(errorMessage);
            } else {
                toast.error(errorMessage);
            }

            setState("idle");
            setProgress(0);
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    const clearAll = () => {
        // Stop any active recording
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
        }

        // Clear timer
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        // Reset all state
        setState("idle");
        setProgress(0);
        setRecordingTime(0);
        setTranscript(null);
        setPreviousTranscripts([]);
        chunksRef.current = [];

        // Clear file input
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }

        toast.success("Cleared all data");
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>AI Capture</CardTitle>
                    {(transcript || previousTranscripts.length > 0 || state !== "idle") && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearAll}
                            disabled={state === "recording" || state === "uploading" || state === "transcribing"}
                            className="h-8 w-8 p-0"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "record" | "upload")}>


                    <TabsContent value="record" className="space-y-4">
                        <div className="flex flex-col items-center gap-4">
                            {state === "recording" ? (
                                <>
                                    <div className="text-center">
                                        <div className="text-2xl font-mono">{formatTime(recordingTime)}</div>
                                        <div className="text-sm text-muted-foreground">Recording...</div>
                                    </div>
                                    <Button onClick={stopRecording} variant="destructive" size="lg">
                                        <Mic className="h-4 w-4 mr-2" />
                                        Stop Recording
                                    </Button>
                                </>
                            ) : (
                                <Button
                                    onClick={startRecording}
                                    size="lg"
                                    disabled={state !== "idle" && state !== "complete"}
                                >
                                    <Mic className="h-4 w-4 mr-2" />
                                    {previousTranscripts.length > 0 ? "Record Again" : "Start Recording"}
                                </Button>
                            )}
                        </div>
                    </TabsContent>


                </Tabs>

                {state !== "idle" && state !== "complete" && (
                    <div className="mt-4 space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">
                                {state === "converting" && "Converting to MP3..."}
                                {state === "uploading" && "Uploading audio..."}
                                {state === "transcribing" && "Transcribing and parsing..."}
                            </span>
                            <span className="text-muted-foreground">{progress}%</span>
                        </div>
                        <Progress value={progress} />
                    </div>
                )}

                {transcript && state === "complete" && (
                    <div className="mt-4 p-3 bg-muted rounded-md">
                        <div className="text-sm font-medium mb-2">Transcript:</div>
                        <div className="text-sm text-muted-foreground max-h-32 overflow-y-auto">
                            {transcript}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

