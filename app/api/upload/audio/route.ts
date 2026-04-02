import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/app/_lib/auth/get-current-user";
import { uploadFile } from "@/app/_lib/storage";
import { getAudioStorageBucket } from "@/app/_lib/storage/config";

/**
 * Upload audio file to Supabase Storage
 * POST /api/upload/audio
 * Body: FormData with file and path
 */
export async function POST(request: NextRequest) {
  try {
    // Verify auth
    await requireUser(["doctor", "nurse"]);

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const path = formData.get("path") as string;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!path) {
      return NextResponse.json(
        { error: "No path provided" },
        { status: 400 }
      );
    }

    const bucket = getAudioStorageBucket();

    // Convert File to ArrayBuffer for upload
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase Storage using service role key (bypasses RLS)
    try {
      const data = await uploadFile(bucket, path, buffer, {
        contentType: file.type || "audio/mpeg",
        upsert: false, // Don't overwrite existing files
      });

      console.log("Upload successful:", { path: data.path, bucket });

      return NextResponse.json({
        path: data.path,
        fullPath: `${bucket}/${data.path}`,
      });
    } catch (uploadError) {
      console.error("Upload file error:", uploadError);
      throw uploadError;
    }
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
