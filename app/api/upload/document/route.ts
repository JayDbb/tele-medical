import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/app/_lib/auth/get-current-user";
import { uploadFile } from "@/app/_lib/storage";
import { getDocumentsStorageBucket } from "@/app/_lib/storage/config";
import { v4 as uuidv4 } from "uuid";

/**
 * Upload document file to Supabase Storage
 * POST /api/upload/document
 * Body: FormData with file, patientId, and optional visitId
 */
export async function POST(request: NextRequest) {
  try {
    // Verify auth
    await requireUser(["doctor", "nurse"]);

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const patientId = formData.get("patientId") as string;
    const visitId = formData.get("visitId") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!patientId) {
      return NextResponse.json(
        { error: "No patientId provided" },
        { status: 400 }
      );
    }

    // Validate file type (images, PDFs, documents)
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "File type not allowed. Allowed types: images, PDF, DOC, DOCX" },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File size exceeds 10MB limit" },
        { status: 400 }
      );
    }

    const bucket = getDocumentsStorageBucket();

    // Generate unique path: documents/{patientId}/{visitId?}/{uuid}-{filename}
    const uniqueId = uuidv4();
    const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const path = visitId
      ? `${patientId}/${visitId}/${uniqueId}-${sanitizedFilename}`
      : `${patientId}/${uniqueId}-${sanitizedFilename}`;

    // Convert File to ArrayBuffer for upload
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase Storage using service role key (bypasses RLS)
    try {
      const data = await uploadFile(bucket, path, buffer, {
        contentType: file.type,
        upsert: false, // Don't overwrite existing files
      });

      console.log("Document upload successful:", { path: data.path, bucket });

      return NextResponse.json({
        path: data.path,
        fullPath: `${bucket}/${data.path}`,
        storageUrl: `${bucket}/${data.path}`,
        filename: file.name,
        mimeType: file.type,
        size: file.size.toString(),
      });
    } catch (uploadError) {
      console.error("Document upload error:", uploadError);
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

