"use server";

import { revalidateTag } from "next/cache";
import { requireUser } from "@/app/_lib/auth/get-current-user";
import { createDocument, getPatientDocuments, deleteDocument } from "@/app/_lib/db/drizzle/queries/documents";
import { getSignedUrl, deleteFile } from "@/app/_lib/storage";
import { getDocumentsStorageBucket } from "@/app/_lib/storage/config";

export interface CreateDocumentActionParams {
  patientId: string;
  visitId?: string;
  filename: string;
  mimeType: string;
  size: string;
  storageUrl: string;
}

/**
 * Server action to create a document record
 */
export async function createDocumentAction(params: CreateDocumentActionParams) {
  try {
    const user = await requireUser(["doctor", "nurse"]);

    const document = await createDocument({
      patientId: params.patientId,
      visitId: params.visitId,
      filename: params.filename,
      mimeType: params.mimeType,
      size: params.size,
      storageUrl: params.storageUrl,
      uploadedBy: user.id,
    });

    // Invalidate cache tags
    revalidateTag(`documents:${params.patientId}`, "max");
    revalidateTag(`patient:${params.patientId}`, "max");
    if (params.visitId) {
      revalidateTag(`visit:${params.visitId}`, "max");
    }

    return { success: true, document };
  } catch (error) {
    console.error("Error creating document:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create document",
    };
  }
}

/**
 * Server action to get all documents for a patient
 */
export async function getPatientDocumentsAction(patientId: string) {
  try {
    await requireUser(["doctor", "nurse"]);
    
    const documents = await getPatientDocuments(patientId);
    
    return documents;
  } catch (error) {
    console.error("Error fetching documents:", error);
    throw new Error(
      error instanceof Error ? error.message : "Failed to fetch documents"
    );
  }
}

/**
 * Server action to get a signed URL for downloading a document
 */
export async function getDocumentSignedUrlAction(storageUrl: string) {
  try {
    await requireUser(["doctor", "nurse"]);
    
    // Extract bucket and path from storageUrl
    // Format: tele-med-docs/patientId/uuid-filename or tele-med-docs/patientId/visitId/uuid-filename
    const bucket = getDocumentsStorageBucket();
    // Remove bucket prefix if present, otherwise use storageUrl as-is
    const path = storageUrl.startsWith(`${bucket}/`)
      ? storageUrl.replace(`${bucket}/`, "")
      : storageUrl;
    
    const urlData = await getSignedUrl(bucket, path, 3600); // 1 hour expiry
    
    return { success: true, signedUrl: urlData.signedUrl };
  } catch (error) {
    console.error("Error creating signed URL:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create signed URL",
    };
  }
}

/**
 * Server action to delete a document
 */
export async function deleteDocumentAction(documentId: string, storageUrl: string) {
  try {
    await requireUser(["doctor", "nurse"]);
    
    // Delete from storage first
    const bucket = getDocumentsStorageBucket();
    // Remove bucket prefix if present, otherwise use storageUrl as-is
    const path = storageUrl.startsWith(`${bucket}/`)
      ? storageUrl.replace(`${bucket}/`, "")
      : storageUrl;
    
    try {
      await deleteFile(bucket, path);
    } catch (storageError) {
      console.error("Error deleting file from storage:", storageError);
      // Continue with DB deletion even if storage deletion fails
    }
    
    // Delete from database
    const deleted = await deleteDocument(documentId);
    
    if (!deleted) {
      return {
        success: false,
        error: "Document not found",
      };
    }

    // Invalidate cache tags
    if (deleted.patientId) {
      revalidateTag(`documents:${deleted.patientId}`, "max");
      revalidateTag(`patient:${deleted.patientId}`, "max");
    }
    if (deleted.visitId) {
      revalidateTag(`visit:${deleted.visitId}`, "max");
    }
    
    return { success: true };
  } catch (error) {
    console.error("Error deleting document:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete document",
    };
  }
}

