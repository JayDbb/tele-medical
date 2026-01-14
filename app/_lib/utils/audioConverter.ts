"use client";

import { queueFileUpload, queueMutation } from "@/app/_lib/offline/outbox";

// Pre-load lamejs module when online to avoid chunk load errors when offline
let lamejsModule: any = null;
let lamejsLoadPromise: Promise<any> | null = null;

/**
 * Pre-load the lamejs library when online
 */
export async function preloadLamejs(): Promise<void> {
  if (typeof window === "undefined") return;
  if (lamejsModule) return; // Already loaded
  if (lamejsLoadPromise) return lamejsLoadPromise; // Already loading

  if (!navigator.onLine) {
    throw new Error("Cannot preload lamejs: offline");
  }

  lamejsLoadPromise = import("@breezystack/lamejs")
    .then((module) => {
      lamejsModule = module;
      return module;
    })
    .catch((error) => {
      lamejsLoadPromise = null; // Reset on error so we can retry
      throw error;
    });

  return lamejsLoadPromise;
}

/**
 * Internal conversion function - does the actual MP3 conversion
 * Exported for use in offline sync
 */
export async function _convertToMP3Internal(audioBlob: Blob): Promise<Blob> {
  // Ensure we're in browser environment
  if (typeof window === "undefined") {
    throw new Error("convertToMP3 can only be used in browser environment");
  }

  // Try to get lamejs module (pre-loaded or load now)
  let Mp3Encoder: any;
  try {
    if (lamejsModule) {
      Mp3Encoder = lamejsModule.Mp3Encoder;
    } else if (navigator.onLine) {
      // Try to load if online
      const module = await import("@breezystack/lamejs");
      lamejsModule = module;
      Mp3Encoder = module.Mp3Encoder;
    } else {
      // Offline and not pre-loaded - throw error that can be caught
      throw new Error("lamejs library not available offline. Audio will be stored in original format.");
    }
  } catch (error: any) {
    // Check if it's a chunk load error or network error
    if (
      error?.message?.includes("chunk") ||
      error?.message?.includes("Failed to load") ||
      error?.message?.includes("network") ||
      !navigator.onLine
    ) {
      throw new Error("MP3 conversion unavailable offline. Audio will be stored in original format.");
    }
    throw error;
  }

  // Create an audio context to decode the audio
  const audioContext = new AudioContext();

  // Convert blob to array buffer
  const arrayBuffer = await audioBlob.arrayBuffer();

  // Decode the audio data
  let audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // Telehealth safety check: validate duration before encoding
  if (audioBuffer.duration < 0.1) {
    throw new Error(
      "Recording too short to encode safely (less than 0.1 seconds)"
    );
  }

  // Get the sample rate and channels
  let sampleRate = audioBuffer.sampleRate;
  const numberOfChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;

  // Validate audio data
  if (!sampleRate || sampleRate <= 0) {
    throw new Error("Invalid sample rate in audio data");
  }
  if (numberOfChannels <= 0 || numberOfChannels > 2) {
    throw new Error(
      "Unsupported number of channels. Only mono and stereo are supported."
    );
  }
  if (length === 0) {
    throw new Error("Audio buffer is empty");
  }

  // Optional but recommended: Resample to 44.1 kHz for better compatibility
  // Opus recordings often decode to 48 kHz, which can cause edge cases
  if (sampleRate !== 44100) {
    console.log(
      `Resampling from ${sampleRate} Hz to 44100 Hz for better compatibility`
    );
    const offlineCtx = new OfflineAudioContext(
      numberOfChannels,
      Math.ceil(audioBuffer.duration * 44100),
      44100
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    audioBuffer = await offlineCtx.startRendering();
    sampleRate = audioBuffer.sampleRate;
    console.log(
      `Resampling complete: ${sampleRate} Hz, ${audioBuffer.length} samples`
    );
  }

  // Convert AudioBuffer to per-channel PCM data (NOT interleaved)
  // LAME requires separate channel buffers: encodeBuffer(left) or encodeBuffer(left, right)
  const channelBuffers: Int16Array[] = [];
  let nonZeroSamples = 0;
  let maxSample = 0;

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelData = audioBuffer.getChannelData(channel);
    const channelSamples = new Int16Array(length);

    for (let i = 0; i < length; i++) {
      // Convert float32 (-1.0 to 1.0) to int16 (-32768 to 32767)
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      const int16Sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      channelSamples[i] = int16Sample;

      // Track non-zero samples for validation
      if (Math.abs(int16Sample) > 0) {
        nonZeroSamples++;
      }
      maxSample = Math.max(maxSample, Math.abs(int16Sample));
    }

    channelBuffers.push(channelSamples);
  }

  // Validate channel buffers
  if (channelBuffers.length === 0 || channelBuffers[0].length === 0) {
    throw new Error("No audio samples to encode");
  }

  // Check if audio is all silence
  const silenceThreshold = 100; // Very low threshold - even quiet audio should have some variation
  if (maxSample < silenceThreshold) {
    console.warn(
      `WARNING: Audio appears to be silence or very quiet (max sample: ${maxSample}, non-zero samples: ${nonZeroSamples}/${
        channelBuffers[0].length * numberOfChannels
      })`
    );
  } else {
    console.log(
      `Audio samples: ${channelBuffers[0].length} per channel, ${numberOfChannels} channels, ${nonZeroSamples} non-zero, max amplitude: ${maxSample}`
    );
  }

  // Create MP3 encoder
  const mp3encoder = new Mp3Encoder(numberOfChannels, sampleRate, 128); // 128 kbps bitrate

  // Validate encoder was created properly
  if (!mp3encoder) {
    throw new Error("Failed to create MP3 encoder");
  }

  // Check if encodeBuffer method exists
  if (typeof mp3encoder.encodeBuffer !== "function") {
    throw new Error("MP3 encoder does not have encodeBuffer method");
  }

  const sampleBlockSize = 1152; // MP3 frame size (samples per channel)
  const mp3Data: Uint8Array[] = [];
  const samplesPerChannel = channelBuffers[0].length;

  // Encode in chunks - process each channel separately
  for (let i = 0; i < samplesPerChannel; i += sampleBlockSize) {
    const chunkEnd = Math.min(i + sampleBlockSize, samplesPerChannel);

    // Extract chunk from each channel
    const leftChunk = channelBuffers[0].subarray(i, chunkEnd);

    // For stereo, get right channel chunk
    let rightChunk: Int16Array | undefined;
    if (numberOfChannels === 2) {
      rightChunk = channelBuffers[1].subarray(i, chunkEnd);
    }

    // Pad last chunk if needed (must be exactly sampleBlockSize)
    let leftPadded: Int16Array;
    let rightPadded: Int16Array | undefined;

    if (leftChunk.length < sampleBlockSize) {
      // Last chunk - pad with zeros
      leftPadded = new Int16Array(sampleBlockSize);
      leftPadded.set(leftChunk, 0);
      leftPadded.fill(0, leftChunk.length);
    } else {
      leftPadded = leftChunk;
    }

    if (numberOfChannels === 2 && rightChunk) {
      if (rightChunk.length < sampleBlockSize) {
        rightPadded = new Int16Array(sampleBlockSize);
        rightPadded.set(rightChunk, 0);
        rightPadded.fill(0, rightChunk.length);
      } else {
        rightPadded = rightChunk;
      }
    }

    try {
      // LAME requires per-channel buffers: encodeBuffer(left) or encodeBuffer(left, right)
      const mp3buf =
        numberOfChannels === 2 && rightPadded
          ? mp3encoder.encodeBuffer(leftPadded, rightPadded)
          : mp3encoder.encodeBuffer(leftPadded);

      // Handle different return types from the encoder
      if (mp3buf) {
        if (Array.isArray(mp3buf) && mp3buf.length > 0) {
          mp3Data.push(new Uint8Array(mp3buf));
        } else if (mp3buf instanceof Uint8Array && mp3buf.length > 0) {
          mp3Data.push(mp3buf);
        } else if (
          typeof mp3buf === "object" &&
          "length" in mp3buf &&
          mp3buf.length > 0
        ) {
          try {
            mp3Data.push(new Uint8Array(mp3buf as ArrayLike<number>));
          } catch (e) {
            console.warn(
              `Could not convert mp3buf to Uint8Array at index ${i}:`,
              e
            );
          }
        }
      }
    } catch (encodeError) {
      console.warn(`Error encoding chunk at index ${i}:`, encodeError);
      // Continue with next chunk - don't fail the entire conversion
    }
  }

  // Flush remaining data
  try {
    const mp3buf = mp3encoder.flush();
    if (mp3buf) {
      if (Array.isArray(mp3buf) && mp3buf.length > 0) {
        mp3Data.push(new Uint8Array(mp3buf));
      } else if (mp3buf instanceof Uint8Array && mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      } else if (
        typeof mp3buf === "object" &&
        "length" in mp3buf &&
        mp3buf.length > 0
      ) {
        try {
          mp3Data.push(new Uint8Array(mp3buf as ArrayLike<number>));
        } catch (e) {
          console.warn("Could not convert flushed mp3buf to Uint8Array:", e);
        }
      }
    }
  } catch (flushError) {
    console.warn("Error flushing MP3 encoder:", flushError);
  }

  // Validate that we have MP3 data
  if (mp3Data.length === 0) {
    throw new Error("MP3 encoder produced no data - all chunks were empty");
  }

  const totalMp3Size = mp3Data.reduce((sum, chunk) => sum + chunk.length, 0);
  if (totalMp3Size === 0) {
    throw new Error("MP3 encoder produced 0 bytes of data");
  }

  // Telehealth safety check: encoded MP3 must be at least 4KB
  // Files smaller than this are likely just encoder headers (encoding failure)
  if (totalMp3Size < 4096) {
    throw new Error(
      `Encoded MP3 too small (${totalMp3Size} bytes) — likely encoding failure. Minimum expected: 4096 bytes.`
    );
  }

  console.log(
    `MP3 encoding complete: ${mp3Data.length} chunks, ${totalMp3Size} bytes total`
  );

  // Combine all MP3 chunks into a single blob
  const mp3Blob = new Blob(mp3Data as BlobPart[], { type: "audio/mpeg" });

  // Validate the MP3 blob
  if (mp3Blob.size === 0) {
    throw new Error("MP3 blob is empty after combining chunks");
  }

  // Check if the MP3 blob has valid MP3 structure
  const mp3ArrayBuffer = await mp3Blob.arrayBuffer();
  const mp3View = new Uint8Array(mp3ArrayBuffer);

  // Check for MP3 file signature
  const hasID3v2 =
    mp3View.length >= 3 &&
    String.fromCharCode(mp3View[0], mp3View[1], mp3View[2]) === "ID3";
  const hasMP3Sync =
    mp3View.length >= 2 && mp3View[0] === 0xff && (mp3View[1] & 0xe0) === 0xe0;

  if (!hasID3v2 && !hasMP3Sync) {
    console.warn("WARNING: Generated MP3 does not have standard MP3 headers");
    console.warn(
      `First 20 bytes: ${Array.from(mp3View.slice(0, 20))
        .map((b) => "0x" + b.toString(16).padStart(2, "0"))
        .join(" ")}`
    );
    // Don't throw here - some MP3 encoders produce valid MP3 without ID3 tags
    // The browser's AudioContext should still be able to decode it
  }

  // Close audio context
  await audioContext.close();

  return mp3Blob;
}

/**
 * Converts a WebM/Opus audio blob to MP3 format
 * Stores the original blob first for offline persistence
 * @param audioBlob - The audio blob (typically WebM format from MediaRecorder)
 * @returns A Promise that resolves to an MP3 blob, or throws if offline and conversion fails
 */
export async function convertToMP3(audioBlob: Blob): Promise<Blob> {
  // Store the original blob first for offline persistence
  const originalFile = new File([audioBlob], `recording-${Date.now()}.webm`, {
    type: audioBlob.type || "audio/webm",
  });

  let fileId: string | null = null;
  try {
    // Store original file in IndexedDB first
    fileId = await queueFileUpload(originalFile.name, "/api/convert-audio", {
      action: "convert_to_mp3",
      originalFileId: originalFile.name,
    });
  } catch (error) {
    console.warn("Failed to store original audio file:", error);
  }

  // Try to convert immediately
  try {
    const mp3Blob = await _convertToMP3Internal(audioBlob);

    // If successful and we stored it, we can optionally remove it
    // But we'll keep it in case the upload fails later

    return mp3Blob;
  } catch (error: any) {
    // Check if it's a network/API error from lamejs
    const isNetworkError =
      error.message?.includes("fetch") ||
      error.message?.includes("network") ||
      error.message?.includes("Failed to fetch") ||
      error.message?.includes("API") ||
      !navigator.onLine;

    if (isNetworkError && fileId) {
      // Queue the conversion+upload for later
      // The file is already stored, we'll convert and upload during sync
      await queueMutation({
        type: "file_upload", // Reuse file_upload type, but mark it as needing conversion
        endpoint: "/api/convert-audio", // Placeholder endpoint
        method: "POST",
        payloadJson: JSON.stringify({
          action: "convert_to_mp3",
          originalFileId: fileId,
        }),
        fileIds: [fileId],
      });

      // Return the original blob - it will be wrapped as MP3 file by caller
      // The actual conversion will happen during sync before upload
      // Note: The upload will also be queued, but the sync will handle conversion first
      console.log(
        "Audio conversion queued for later sync. Original file stored and will be converted when online."
      );
      return audioBlob; // Return original - will be converted during sync
    }

    // For other errors, rethrow
    throw error;
  }
}
