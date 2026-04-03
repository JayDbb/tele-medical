import Dexie, { Table } from "dexie";
import type { VisitNote } from "@/app/_lib/visit-note/schema";

/**
 * Dexie database for offline-first functionality
 * Stores drafts, outbox operations, files, and entity caches
 */
export class OfflineDB extends Dexie {
  draftVisits!: Table<DraftVisit>;
  outbox!: Table<OutboxOperation>;
  files!: Table<StoredFile>;
  patients!: Table<CachedPatient>;
  visits!: Table<CachedVisit>;
  documents!: Table<CachedDocument>;
  notes!: Table<CachedNote>;
  transcripts!: Table<CachedTranscript>;
  drafts!: Table<FormDraft>;

  constructor() {
    super("TeleMedicalOfflineDB");

    this.version(1).stores({
      draftVisits: "draftId, patientId, userId, [userId+patientId], updatedAt",
      outbox: "id, createdAt, status, [status+createdAt], dependsOn",
      files: "id, createdAt",
    });

    // Version 2: Add pending operations tracking
    this.version(2)
      .stores({
        draftVisits: "draftId, patientId, userId, [userId+patientId], updatedAt",
        outbox: "id, createdAt, status, [status+createdAt], dependsOn",
        files: "id, createdAt",
      })
      .upgrade((tx) => {
        // Migration: add new fields to existing drafts
        return tx.table("draftVisits").toCollection().modify((draft) => {
          if (!draft.pendingChunks) draft.pendingChunks = undefined;
          if (!draft.pendingTranscription) draft.pendingTranscription = undefined;
          if (!draft.pendingParsing) draft.pendingParsing = undefined;
          if (!draft.recordingSessionId) draft.recordingSessionId = undefined;
        });
      });

    // Version 3: Add entity cache tables
    this.version(3)
      .stores({
        draftVisits: "draftId, patientId, userId, [userId+patientId], updatedAt",
        outbox: "id, createdAt, status, [status+createdAt], dependsOn",
        files: "id, createdAt",
        patients: "id, updatedAt, [id+updatedAt]",
        visits: "id, patientId, createdAt, [patientId+createdAt]",
        documents: "id, patientId, visitId, uploadedAt",
        notes: "id, visitId, createdAt",
        transcripts: "id, visitId, createdAt",
        drafts: "draftKey, userId, formName, route, entityId, updatedAt, [userId+formName+route+entityId]",
      });
  }
}

export interface DraftVisit {
  draftId: string;
  patientId: string;
  userId: string;
  role: string;
  updatedAt: number;
  formStateJson: string; // JSON string of VisitNote
  reviewedSectionsJson: string; // JSON string of Set<string>
  expandedSectionsJson: string; // JSON string of Set<string>
  visitIdRemote?: string; // Remote visit ID if created
  status: "draft" | "syncing" | "synced";
  audioFileId?: string; // Reference to files table
  transcript?: string;
  audioPath?: string;
  pendingChunks?: string; // JSON array of chunk file IDs that failed to upload
  pendingTranscription?: string; // JSON: { audioFileId, audioPath, visitId }
  pendingParsing?: string; // JSON: { transcript, visitId, previousTranscripts? }
  recordingSessionId?: string; // For tracking recording sessions
}

export interface OutboxOperation {
  id: string; // UUID
  createdAt: number;
  type: string; // actionType
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  payloadJson: string; // JSON string
  fileIds?: string[]; // References to files table
  dependsOn?: string[]; // IDs of operations this depends on
  status: "queued" | "syncing" | "failed" | "completed";
  attempts: number;
  lastError?: string;
  retryAt?: number; // Timestamp for next retry
}

export interface StoredFile {
  id: string; // UUID
  blob: Blob;
  mime: string;
  name: string;
  size: number;
  createdAt: number;
}

/**
 * Cached entity interfaces
 */
export interface CachedPatient {
  id: string;
  data: unknown; // JSON-serialized patient data
  updatedAt: number;
  cachedAt: number;
}

export interface CachedVisit {
  id: string;
  patientId: string;
  data: unknown; // JSON-serialized visit data
  createdAt: number;
  cachedAt: number;
}

export interface CachedDocument {
  id: string;
  patientId: string;
  visitId?: string | null;
  data: unknown; // JSON-serialized document data
  uploadedAt: number;
  cachedAt: number;
}

export interface CachedNote {
  id: string;
  visitId: string;
  data: unknown; // JSON-serialized note data
  createdAt: number;
  cachedAt: number;
}

export interface CachedTranscript {
  id: string;
  visitId: string;
  data: unknown; // JSON-serialized transcript data
  createdAt: number;
  cachedAt: number;
}

/**
 * General form draft (for any form, not just visits)
 */
export interface FormDraft {
  draftKey: string; // `${userId}:${formName}:${route}:${entityId ?? 'none'}`
  userId: string;
  formName: string; // e.g., "personal-details", "medications", "allergies"
  route: string; // current pathname
  entityId?: string; // patientId, visitId, etc.
  data: string; // JSON string of form data
  updatedAt: number;
}

// Singleton instance
let dbInstance: OfflineDB | null = null;
let dbFailed = false;

export function getOfflineDB(): OfflineDB {
  if (typeof window === "undefined") {
    throw new Error("OfflineDB can only be used in browser environment");
  }

  if (!dbInstance) {
    dbInstance = new OfflineDB();

    // Attempt to open and handle IndexedDB failures gracefully.
    // If the backing store is corrupt, delete and recreate the database.
    dbInstance.open().catch(async (err) => {
      console.warn("OfflineDB failed to open, attempting to reset:", err);
      dbFailed = true;
      try {
        if (dbInstance) {
          dbInstance.close();
        }
        await Dexie.delete("TeleMedicalOfflineDB");
        dbInstance = new OfflineDB();
        await dbInstance.open();
        dbFailed = false;
        console.info("OfflineDB reset successfully");
      } catch (resetErr) {
        console.error("OfflineDB reset failed — offline features disabled:", resetErr);
        dbInstance = null;
      }
    });
  }

  if (!dbInstance) {
    throw new Error("OfflineDB is unavailable — IndexedDB could not be opened");
  }

  return dbInstance;
}

/**
 * Check whether the offline DB is available.
 * Callers can use this to skip offline operations gracefully.
 */
export function isOfflineDBAvailable(): boolean {
  return dbInstance !== null && !dbFailed;
}
