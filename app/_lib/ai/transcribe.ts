import { getSignedUrl } from "@/app/_lib/storage";
import { getAudioStorageBucket } from "@/app/_lib/storage/config";

interface ReplicateTranscriptSegment {
  text?: string;
}

/**
 * Transcribe audio from Supabase Storage
 * This is the core transcription logic that can be called directly from server code
 * without going through the HTTP API.
 */
export async function transcribeAudio(audioPath: string) {
  const replicateApiKey = process.env.REPLICATE_API_KEY;

  if (!replicateApiKey) {
    throw new Error(
      "Audio transcription is unavailable. Set REPLICATE_API_KEY to enable audio-to-text."
    );
  }

  // Get signed URL from Supabase Storage using service role key
  const bucket = getAudioStorageBucket();

  let audioUrl: string;
  try {
    const urlData = await getSignedUrl(bucket, audioPath, 3600);
    audioUrl = urlData.signedUrl;
    console.log("Using Supabase signed URL for transcription");
  } catch (error) {
    console.error("URL error:", error);
    throw new Error(
      error instanceof Error
        ? error.message
        : "Failed to create signed URL for audio"
    );
  }

  // Transcribe audio using Whisper via Replicate
  const whisperModel =
    "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c";

  // Use the signed URL directly - it should be accessible to Replicate
  const transcriptionInput = {
    audio: audioUrl,
  };

  // Create prediction via Replicate API
  const predictionResponse = await fetch(
    "https://api.replicate.com/v1/predictions",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${replicateApiKey}`,
        "Content-Type": "application/json",
      },
        body: JSON.stringify({
          version: whisperModel,
          input: transcriptionInput,
        }),
    }
  );

  if (!predictionResponse.ok) {
    const errorData = await predictionResponse.json().catch(() => ({}));
    throw new Error(
      errorData.detail || `Replicate API error: ${predictionResponse.statusText}`
    );
  }

  const prediction = await predictionResponse.json();
  const predictionId = prediction.id;

  // Poll for completion
  let completed = false;
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes max (5s * 60)

  while (!completed && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds

    const statusResponse = await fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      {
        headers: {
          Authorization: `Token ${replicateApiKey}`,
        },
      }
    );

    if (!statusResponse.ok) {
      throw new Error("Failed to check transcription status");
    }

    const status = await statusResponse.json();

      if (status.status === "succeeded") {
        completed = true;
        // Extract transcript from output
        const output = status.output;
        let transcript = "";
        if (typeof output === "string") {
          transcript = output;
        } else if (output?.text) {
          transcript = output.text;
        } else if (Array.isArray(output)) {
          transcript = output
            .map((seg: string | ReplicateTranscriptSegment) =>
              typeof seg === "string" ? seg : seg.text || ""
            )
            .join(" ");
        }
        
        return {
          transcriptId: predictionId,
          text: transcript,
          rawText: transcript,
        };
      } else if (status.status === "failed" || status.status === "canceled") {
        throw new Error(
          `Transcription failed: ${status.error || "Unknown error"}`
        );
      }

    attempts++;
  }

  throw new Error("Transcription timed out");
}

