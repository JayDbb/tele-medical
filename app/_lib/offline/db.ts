import Dexie, { Table } from "dexie";
import type { VisitNote } from "@/app/_lib/visit-note/schema";

/**
 * Dexie database for offline-first functionality
 * Stores drafts, outbox operations, and files
 */
export class OfflineDB extends Dexie {
  draftVisits!: Table<DraftVisit>;
  outbox!: Table<OutboxOperation>;
  files!: Table<StoredFile>;

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

// Singleton instance
let dbInstance: OfflineDB | null = null;

export function getOfflineDB(): OfflineDB {
  if (typeof window === "undefined") {
    throw new Error("OfflineDB can only be used in browser environment");
  }

  if (!dbInstance) {
    dbInstance = new OfflineDB();
  }

  return dbInstance;
}
