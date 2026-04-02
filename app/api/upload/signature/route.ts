import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/app/_lib/auth/get-current-user";
import { uploadFile } from "@/app/_lib/storage";
import { getDocumentsStorageBucket } from "@/app/_lib/storage/config";
import { v4 as uuidv4 } from "uuid";

/**
 * Upload signature image to Supabase Storage
 * POST /api/upload/signature
 * Body: FormData with signature (base64 image), patientId, and optional witnessSignature
 */
export async function POST(request: NextRequest) {
  try {
    // Verify auth
    await requireUser(["doctor", "nurse"]);

    const formData = await request.formData();
    const signature = formData.get("signature") as string; // base64 data URL
    const patientId = formData.get("patientId") as string | null; // Optional - can be temp UUID
    const witnessSignature = formData.get("witnessSignature") as string | null;

    if (!signature) {
      return NextResponse.json(
        { error: "No signature provided" },
        { status: 400 }
      );
    }

    // Use provided patientId or generate a temporary one
    const targetPatientId = patientId || uuidv4();

    // Convert base64 data URL to buffer
    const base64Data = signature.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    const bucket = getDocumentsStorageBucket();

    // Generate unique path: signatures/{patientId}/{uuid}-signature.png
    const uniqueId = uuidv4();
    const signaturePath = `${targetPatientId}/signatures/${uniqueId}-signature.png`;

    // Upload patient signature
    const signatureData = await uploadFile(bucket, signaturePath, buffer, {
      contentType: "image/png",
      upsert: false,
    });

    let witnessSignaturePath: string | null = null;
    if (witnessSignature) {
      const witnessBase64Data = witnessSignature.replace(/^data:image\/\w+;base64,/, "");
      const witnessBuffer = Buffer.from(witnessBase64Data, "base64");
      witnessSignaturePath = `${patientId}/signatures/${uniqueId}-witness-signature.png`;

      await uploadFile(bucket, witnessSignaturePath, witnessBuffer, {
        contentType: "image/png",
        upsert: false,
      });
    }

    return NextResponse.json({
      signatureUrl: `${bucket}/${signatureData.path}`,
      witnessSignatureUrl: witnessSignaturePath ? `${bucket}/${witnessSignaturePath}` : null,
    });
  } catch (error) {
    console.error("Signature upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
