import { getOfflineDB, type DraftVisit } from "./db";
import type { VisitNote } from "@/app/_lib/visit-note/schema";
import { v4 as uuidv4 } from "uuid";

/**
 * Load or create a draft visit
 */
export async function loadDraft(
  patientId: string,
  userId: string,
  role: string
): Promise<DraftVisit> {
  const db = getOfflineDB();
  
  // Try to find existing draft
  const existing = await db.draftVisits
    .where("[userId+patientId]")
    .equals([userId, patientId])
    .first();
  
  if (existing) {
    return existing;
  }
  
  // Create new draft
  const draftId = uuidv4();
  const draft: DraftVisit = {
    draftId,
    patientId,
    userId,
    role,
    updatedAt: Date.now(),
    formStateJson: JSON.stringify({}),
    reviewedSectionsJson: JSON.stringify([]),
    expandedSectionsJson: JSON.stringify([]),
    status: "draft",
  };
  
  await db.draftVisits.add(draft);
  return draft;
}

/**
 * Save draft form state
 * Creates a draft if it doesn't exist
 */
export async function saveDraft(
  patientId: string,
  userId: string,
  updates: {
    formState?: VisitNote;
    reviewedSections?: Set<string>;
    expandedSections?: Set<string>;
    visitIdRemote?: string;
    status?: DraftVisit["status"];
    audioFileId?: string;
    transcript?: string;
    audioPath?: string;
    role?: string;
  }
): Promise<void> {
  const db = getOfflineDB();
  
  let draft = await db.draftVisits
    .where("[userId+patientId]")
    .equals([userId, patientId])
    .first();
  
  // Create draft if it doesn't exist
  if (!draft) {
    const draftId = uuidv4();
    draft = {
      draftId,
      patientId,
      userId,
      role: updates.role || "doctor",
      updatedAt: Date.now(),
      formStateJson: JSON.stringify({}),
      reviewedSectionsJson: JSON.stringify([]),
      expandedSectionsJson: JSON.stringify([]),
      status: "draft",
    };
    await db.draftVisits.add(draft);
  }
  
  const updated: Partial<DraftVisit> = {
    updatedAt: Date.now(),
  };
  
  if (updates.formState !== undefined) {
    updated.formStateJson = JSON.stringify(updates.formState);
  }
  
  if (updates.reviewedSections !== undefined) {
    updated.reviewedSectionsJson = JSON.stringify(Array.from(updates.reviewedSections));
  }
  
  if (updates.expandedSections !== undefined) {
    updated.expandedSectionsJson = JSON.stringify(Array.from(updates.expandedSections));
  }
  
  if (updates.visitIdRemote !== undefined) {
    updated.visitIdRemote = updates.visitIdRemote;
  }
  
  if (updates.status !== undefined) {
    updated.status = updates.status;
  }
  
  if (updates.audioFileId !== undefined) {
    updated.audioFileId = updates.audioFileId;
  }
  
  if (updates.transcript !== undefined) {
    updated.transcript = updates.transcript;
  }
  
  if (updates.audioPath !== undefined) {
    updated.audioPath = updates.audioPath;
  }

  await db.draftVisits.update(draft.draftId, updated);
}

/**
 * Get draft with pending operations
 */
export async function getDraftWithPendingOperations(
  patientId: string,
  userId: string
): Promise<DraftVisit | null> {
  const db = getOfflineDB();
  
  const draft = await db.draftVisits
    .where("[userId+patientId]")
    .equals([userId, patientId])
    .first();
  
  return draft || null;
}

/**
 * Get draft form state
 */
export async function getDraftFormState(
  patientId: string,
  userId: string
): Promise<VisitNote | null> {
  const db = getOfflineDB();
  
  const draft = await db.draftVisits
    .where("[userId+patientId]")
    .equals([userId, patientId])
    .first();
  
  if (!draft || !draft.formStateJson) {
    return null;
  }
  
  try {
    return JSON.parse(draft.formStateJson) as VisitNote;
  } catch {
    return null;
  }
}

/**
 * Get reviewed sections
 */
export async function getReviewedSections(
  patientId: string,
  userId: string
): Promise<Set<string>> {
  const db = getOfflineDB();
  
  const draft = await db.draftVisits
    .where("[userId+patientId]")
    .equals([userId, patientId])
    .first();
  
  if (!draft || !draft.reviewedSectionsJson) {
    return new Set();
  }
  
  try {
    const arr = JSON.parse(draft.reviewedSectionsJson) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

/**
 * Clear draft
 */
export async function clearDraft(
  patientId: string,
  userId: string
): Promise<void> {
  const db = getOfflineDB();
  
  await db.draftVisits
    .where("[userId+patientId]")
    .equals([userId, patientId])
    .delete();
}

