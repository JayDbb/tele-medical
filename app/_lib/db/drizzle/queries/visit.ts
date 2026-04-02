import { eq, and, or, desc, inArray } from "drizzle-orm";
import { db } from "../index";
import { visits, notes, transcripts, patients, users } from "../schema";
import type { VisitNote } from "@/app/_lib/visit-note/schema";

export interface CreateVisitDraftParams {
  patientId: string;
  createdByUserId: string;
  notesJson?: VisitNote;
  audioPath?: string;
  transcript?: string;
  status?: string;
  priority?: string;
  appointmentType?: string;
}

export interface UpdateVisitDraftParams {
  notesJson?: VisitNote;
  audioPath?: string;
  transcript?: string;
  parsedJson?: VisitNote;
  status?: string;
  notesStatus?: string;
  priority?: string;
  appointmentType?: string;
  clinicianId?: string | null;
  createdAt?: Date;
  twilioRoomName?: string;
  twilioRoomSid?: string;
  patientJoinToken?: string;
}

/**
 * Create a visit draft
 */
export async function createVisitDraft(params: CreateVisitDraftParams) {
  const visit = await db
    .insert(visits)
    .values({
      patientId: params.patientId,
      clinicianId: params.createdByUserId,
      status: params.status || "In Progress",
      audioUrl: params.audioPath || null,
      priority: params.priority || null,
      appointmentType: params.appointmentType || null,
    })
    .returning();

  const visitId = visit[0].id;

  // Get user name for audit log
  const userResult = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, params.createdByUserId))
    .limit(1);
  const userName = userResult[0]?.name || userResult[0]?.email || null;

  // Create note if notesJson provided
  let noteId: string | null = null;
  if (params.notesJson) {
    const insertedNote = await db
      .insert(notes)
      .values({
        visitId,
        note: params.notesJson as unknown,
        content: JSON.stringify(params.notesJson),
        status: "draft",
        authorId: params.createdByUserId,
      })
      .returning();
    noteId = insertedNote[0].id;

    // Add audit log entry for note creation
    if (noteId) {
      await addAuditLogEntry(
        noteId,
        params.createdByUserId,
        userName,
        "created",
        null,
        "In Progress"
      );
    }
  }

  // Create transcript if provided
  if (params.transcript) {
    await db.insert(transcripts).values({
      visitId,
      text: params.transcript,
      rawText: params.transcript,
      status: "completed",
    });
  }

  return visit[0];
}

/**
 * Update visit draft
 */
export async function updateVisitDraft(
  visitId: string,
  params: UpdateVisitDraftParams
) {
  const updates: Record<string, unknown> = {};

  if (params.audioPath !== undefined) {
    updates.audioUrl = params.audioPath;
  }

  if (params.status !== undefined) {
    updates.status = params.status;
  }

  if (params.notesStatus !== undefined) {
    updates.notesStatus = params.notesStatus;
  }

  if (params.priority !== undefined) {
    updates.priority = params.priority;
  }

  if (params.appointmentType !== undefined) {
    updates.appointmentType = params.appointmentType;
  }

  if (params.clinicianId !== undefined) {
    updates.clinicianId = params.clinicianId;
  }

  if (params.createdAt !== undefined) {
    updates.createdAt = params.createdAt;
  }

  if (params.twilioRoomName !== undefined) {
    updates.twilioRoomName = params.twilioRoomName;
  }

  if (params.twilioRoomSid !== undefined) {
    updates.twilioRoomSid = params.twilioRoomSid;
  }

  if (params.patientJoinToken !== undefined) {
    updates.patientJoinToken = params.patientJoinToken;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(visits).set(updates).where(eq(visits.id, visitId));
  }

  // Update or create note
  if (params.notesJson) {
    const existingNote = await db
      .select()
      .from(notes)
      .where(eq(notes.visitId, visitId))
      .limit(1);

    if (existingNote[0]) {
      await db
        .update(notes)
        .set({
          note: params.notesJson as unknown,
          content: JSON.stringify(params.notesJson),
        })
        .where(eq(notes.visitId, visitId));
    } else {
      // Get visit to get clinicianId
      const visit = await db
        .select()
        .from(visits)
        .where(eq(visits.id, visitId))
        .limit(1);

      if (visit[0]) {
        await db.insert(notes).values({
          visitId,
          note: params.notesJson as unknown,
          content: JSON.stringify(params.notesJson),
          status: "draft",
          authorId: visit[0].clinicianId || null,
        });
      }
    }
  }

  // Always create a new transcript (don't update existing ones - allow multiple recordings)
  if (params.transcript) {
    await db.insert(transcripts).values({
      visitId,
      text: params.transcript,
      rawText: params.transcript,
      status: "completed",
    });
  }

  return { success: true };
}

/**
 * Add audit log entry to a note
 */
export async function addAuditLogEntry(
  noteId: string,
  userId: string,
  userName: string | null,
  action: string,
  fromStatus: string | null,
  toStatus: string,
  reason?: string
) {
  const note = await db
    .select()
    .from(notes)
    .where(eq(notes.id, noteId))
    .limit(1);

  if (!note[0]) return;

  const currentAudit = note[0].audit as { entries?: Array<unknown> } | null;
  const entries = Array.isArray(currentAudit?.entries)
    ? currentAudit.entries
    : [];

  entries.push({
    timestamp: new Date().toISOString(),
    userId,
    userName,
    action,
    fromStatus,
    toStatus,
    reason,
  });

  await db
    .update(notes)
    .set({
      audit: { entries },
    })
    .where(eq(notes.id, noteId));
}

/**
 * Finalize visit (set status to completed/signed)
 */
export async function finalizeVisit(
  visitId: string,
  finalizedBy: string,
  status: "completed" | "signed" = "completed"
) {
  // Get user name for audit log
  const userResult = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, finalizedBy))
    .limit(1);
  const userName = userResult[0]?.name || userResult[0]?.email || null;

  // Map old status values to new ones
  const newStatus =
    status === "signed" ? "Signed & Complete" : "Signed & Complete";

  await db
    .update(visits)
    .set({
      status: newStatus,
      notesStatus: "finalized",
      notesFinalizedBy: finalizedBy,
      notesFinalizedAt: new Date(),
    })
    .where(eq(visits.id, visitId));

  // Also update note status and add audit log
  const visitNotes = await db
    .select()
    .from(notes)
    .where(eq(notes.visitId, visitId));

  for (const note of visitNotes) {
    const fromNoteStatus = note.status;
    await db
      .update(notes)
      .set({
        status: "finalized",
        finalizedBy,
        finalizedAt: new Date(),
      })
      .where(eq(notes.id, note.id));

    // Add audit log - map status values for display
    const fromStatusDisplay =
      fromNoteStatus === "draft" || fromNoteStatus === "in_progress"
        ? "In Progress"
        : fromNoteStatus === "finalized"
        ? "Signed & Complete"
        : fromNoteStatus;
    await addAuditLogEntry(
      note.id,
      finalizedBy,
      userName,
      "finalized",
      fromStatusDisplay,
      "Signed & Complete"
    );
  }

  return { success: true };
}

/**
 * Mark visit as in progress (when editing a signed note)
 */
export async function markVisitInProgress(
  visitId: string,
  userId: string,
  reason?: string
) {
  // Get user name for audit log
  const userResult = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const userName = userResult[0]?.name || userResult[0]?.email || null;

  // Get current visit status
  const currentVisit = await db
    .select()
    .from(visits)
    .where(eq(visits.id, visitId))
    .limit(1);

  if (!currentVisit[0]) {
    throw new Error("Visit not found");
  }

  // Update visit status
  await db
    .update(visits)
    .set({
      status: "In Progress",
      notesStatus: "in_progress",
      notesFinalizedBy: null,
      notesFinalizedAt: null,
    })
    .where(eq(visits.id, visitId));

  // Update notes and add audit log
  const visitNotes = await db
    .select()
    .from(notes)
    .where(eq(notes.visitId, visitId));

  for (const note of visitNotes) {
    const fromNoteStatus = note.status;
    await db
      .update(notes)
      .set({
        status: "in_progress",
        finalizedBy: null,
        finalizedAt: null,
      })
      .where(eq(notes.id, note.id));

    // Add audit log
    await addAuditLogEntry(
      note.id,
      userId,
      userName,
      "edited_after_signing",
      fromNoteStatus,
      "In Progress",
      reason || "Note edited after being signed"
    );
  }

  return { success: true };
}

/**
 * Get visit by ID
 */
export async function getVisitById(visitId: string) {
  const result = await db
    .select()
    .from(visits)
    .where(eq(visits.id, visitId))
    .limit(1);

  return result[0] || null;
}

/**
 * Get comprehensive visit details including notes, transcripts, documents, and audit logs
 */
export async function getVisitDetails(visitId: string) {
  // Get visit
  const visitResult = await db
    .select()
    .from(visits)
    .where(eq(visits.id, visitId))
    .limit(1);

  if (!visitResult[0]) {
    return null;
  }

  const visit = visitResult[0];

  // Get patient
  const patientResult = await db
    .select({
      id: patients.id,
      fullName: patients.fullName,
      clinicianId: patients.clinicianId,
    })
    .from(patients)
    .where(eq(patients.id, visit.patientId))
    .limit(1);

  if (!patientResult[0]) {
    return null;
  }

  // Get notes
  const notesResult = await db
    .select()
    .from(notes)
    .where(eq(notes.visitId, visitId))
    .orderBy(desc(notes.createdAt));

  // Get transcripts
  const transcriptsResult = await db
    .select({
      id: transcripts.id,
      text: transcripts.text,
      rawText: transcripts.rawText,
      createdAt: transcripts.createdAt,
    })
    .from(transcripts)
    .where(eq(transcripts.visitId, visitId))
    .orderBy(desc(transcripts.createdAt));

  // Get documents
  const { getVisitDocuments } = await import("./documents");
  const documentsResult = await getVisitDocuments(visitId);

  // Get finalized by name
  let finalizedByName: string | null = null;
  if (visit.notesFinalizedBy) {
    const finalizedByResult = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, visit.notesFinalizedBy))
      .limit(1);
    finalizedByName =
      finalizedByResult[0]?.name || finalizedByResult[0]?.email || null;
  }

  // Extract audit logs from notes
  const auditLogs: Array<{
    timestamp: Date;
    userId: string | null;
    userName: string | null;
    action: string;
    fromStatus: string | null;
    toStatus: string;
    reason?: string;
  }> = [];

  for (const note of notesResult) {
    if (note.audit) {
      const audit = note.audit as {
        entries?: Array<{
          timestamp: string;
          userId: string | null;
          userName: string | null;
          action: string;
          fromStatus: string | null;
          toStatus: string;
          reason?: string;
        }>;
      } | null;

      if (audit?.entries) {
        for (const entry of audit.entries) {
          auditLogs.push({
            timestamp: new Date(entry.timestamp),
            userId: entry.userId,
            userName: entry.userName,
            action: entry.action,
            fromStatus: entry.fromStatus,
            toStatus: entry.toStatus,
            reason: entry.reason,
          });
        }
      }
    }
  }

  // Sort audit logs by timestamp (newest first)
  auditLogs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return {
    visit: {
      id: visit.id,
      status: visit.status,
      createdAt: visit.createdAt,
      notesFinalizedBy: visit.notesFinalizedBy,
      notesFinalizedAt: visit.notesFinalizedAt,
      priority: visit.priority,
      appointmentType: visit.appointmentType,
      clinicianId: visit.clinicianId,
      twilioRoomName: visit.twilioRoomName,
    },
    patient: patientResult[0],
    notes: notesResult.map((note) => ({
      id: note.id,
      note: note.note,
      content: note.content,
      status: note.status,
      finalizedBy: note.finalizedBy,
      finalizedAt: note.finalizedAt,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })),
    transcripts: transcriptsResult,
    documents: documentsResult.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      mimeType: doc.mimeType,
      size: doc.size.toString(),
      uploadedAt: doc.uploadedAt,
      storageUrl: doc.storageUrl,
    })),
    finalizedByName,
    auditLogs,
  };
}

/**
 * Get patient's open visit (In Progress or Waiting status)
 */
export async function getPatientOpenVisit(patientId: string) {
  const result = await db
    .select()
    .from(visits)
    .where(
      and(
        eq(visits.patientId, patientId),
        or(
          eq(visits.status, "In Progress"),
          eq(visits.status, "Waiting"),
          eq(visits.status, "in_progress"),
          eq(visits.status, "waiting")
        )
      )
    )
    .orderBy(desc(visits.createdAt))
    .limit(1);

  return result[0] || null;
}

export interface PatientLogHistoryResult {
  patient: {
    id: string;
    fullName: string;
  };
  entries: Array<{
    visitId: string;
    visitCreatedAt: Date;
    visitStatus: string | null;
    appointmentType: string | null;
    timestamp: Date;
    userId: string | null;
    userName: string | null;
    action: string;
    fromStatus: string | null;
    toStatus: string;
    reason?: string;
  }>;
}

export async function getPatientLogHistory(
  patientId: string
): Promise<PatientLogHistoryResult | null> {
  const patientResult = await db
    .select({
      id: patients.id,
      fullName: patients.fullName,
    })
    .from(patients)
    .where(eq(patients.id, patientId))
    .limit(1);

  if (!patientResult[0]) {
    return null;
  }

  const patientVisits = await db
    .select({
      id: visits.id,
      createdAt: visits.createdAt,
      status: visits.status,
      appointmentType: visits.appointmentType,
    })
    .from(visits)
    .where(eq(visits.patientId, patientId))
    .orderBy(desc(visits.createdAt));

  if (patientVisits.length === 0) {
    return {
      patient: patientResult[0],
      entries: [],
    };
  }

  const visitIds = patientVisits.map((visit) => visit.id);
  const notesResult = await db
    .select({
      visitId: notes.visitId,
      audit: notes.audit,
    })
    .from(notes)
    .where(inArray(notes.visitId, visitIds));

  const visitMap = new Map(patientVisits.map((visit) => [visit.id, visit]));
  const entries: PatientLogHistoryResult["entries"] = [];

  for (const note of notesResult) {
    if (!note.audit) {
      continue;
    }

    const audit = note.audit as {
      entries?: Array<{
        timestamp: string;
        userId: string | null;
        userName: string | null;
        action: string;
        fromStatus: string | null;
        toStatus: string;
        reason?: string;
      }>;
    } | null;

    if (!audit?.entries?.length) {
      continue;
    }

    const visit = visitMap.get(note.visitId);
    if (!visit) {
      continue;
    }

    for (const entry of audit.entries) {
      entries.push({
        visitId: note.visitId,
        visitCreatedAt: visit.createdAt,
        visitStatus: visit.status,
        appointmentType: visit.appointmentType,
        timestamp: new Date(entry.timestamp),
        userId: entry.userId,
        userName: entry.userName,
        action: entry.action,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        reason: entry.reason,
      });
    }
  }

  entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return {
    patient: patientResult[0],
    entries,
  };
}

/**
 * Get all open visits for a clinician
 */
export async function getClinicianOpenVisits(clinicianId: string) {
  const result = await db
    .select({
      visit: {
        id: visits.id,
        patientId: visits.patientId,
        status: visits.status,
        priority: visits.priority,
        appointmentType: visits.appointmentType,
        createdAt: visits.createdAt,
        patientJoinToken: visits.patientJoinToken,
        twilioRoomName: visits.twilioRoomName,
      },
      patient: {
        id: patients.id,
        fullName: patients.fullName,
      },
    })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .where(
      and(
        eq(visits.clinicianId, clinicianId),
        or(
          eq(visits.status, "In Progress"),
          eq(visits.status, "Waiting"),
          eq(visits.status, "in_progress"),
          eq(visits.status, "waiting")
        )
      )
    )
    .orderBy(desc(visits.createdAt));

  return result.map((row) => ({
    id: row.visit.id,
    patientId: row.visit.patientId,
    patientName: row.patient.fullName,
    status: row.visit.status,
    priority: row.visit.priority,
    appointmentType: row.visit.appointmentType,
    createdAt: row.visit.createdAt,
    patientJoinToken: row.visit.patientJoinToken,
    twilioRoomName: row.visit.twilioRoomName,
  }));
}
