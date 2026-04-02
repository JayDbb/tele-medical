"use server";

import { revalidateTag } from "next/cache";
import { requireUser } from "@/app/_lib/auth/get-current-user";
import {
  createVisitDraft,
  updateVisitDraft,
  finalizeVisit,
  getPatientOpenVisit,
  type CreateVisitDraftParams,
  type UpdateVisitDraftParams,
} from "@/app/_lib/db/drizzle/queries/visit";
import type { VisitNote } from "@/app/_lib/visit-note/schema";
import { db } from "@/app/_lib/db/drizzle/index";
import { patients, notes } from "@/app/_lib/db/drizzle/schema";
import { eq, desc } from "drizzle-orm";

/**
 * Create a visit draft (server action)
 */
export async function createVisitDraftAction(params: {
  patientId: string;
  notesJson?: VisitNote;
  audioPath?: string;
  transcript?: string;
  priority?: string;
  appointmentType?: string;
}) {
  const user = await requireUser(["doctor", "nurse"]);

  // Assign patient to the clinician - set both is_assigned and clinician_id
  await db
    .update(patients)
    .set({
      isAssigned: true,
      clinicianId: user.id,
    })
    .where(eq(patients.id, params.patientId));

  const visit = await createVisitDraft({
    patientId: params.patientId,
    createdByUserId: user.id,
    status: "In Progress",
    notesJson: params.notesJson,
    audioPath: params.audioPath,
    transcript: params.transcript,
    priority: params.priority,
    appointmentType: params.appointmentType,
  });

  // Invalidate cache tags
  revalidateTag(`patient:${params.patientId}`, "max");
  revalidateTag(`visits:${params.patientId}`, "max");
  revalidateTag("waiting-room", "max");
  revalidateTag("patients", "max");

  return { success: true, visitId: visit.id };
}

/**
 * Update visit draft (server action)
 */
export async function updateVisitDraftAction(
  visitId: string,
  params: {
    notesJson?: VisitNote;
    audioPath?: string;
    transcript?: string;
    priority?: string;
    appointmentType?: string;
  }
) {
  const user = await requireUser(["doctor", "nurse"]);

  // Get visit to get patientId
  const { getVisitById } = await import("@/app/_lib/db/drizzle/queries/visit");
  const visit = await getVisitById(visitId);

  if (visit) {
    // Assign patient to the clinician - set both is_assigned and clinician_id
    await db
      .update(patients)
      .set({
        isAssigned: true,
        clinicianId: user.id,
      })
      .where(eq(patients.id, visit.patientId));
  }

  await updateVisitDraft(visitId, {
    ...params,
    clinicianId: user.id, // Set clinician_id when updating visit
  });

  // Invalidate cache tags
  if (visit) {
    revalidateTag(`visit:${visitId}`, "max");
    revalidateTag(`visits:${visit.patientId}`, "max");
    revalidateTag(`patient:${visit.patientId}`, "max");
  }

  return { success: true };
}

/**
 * Finalize visit (server action)
 */
export async function finalizeVisitAction(
  visitId: string,
  status: "completed" | "signed" = "completed"
) {
  const user = await requireUser(["doctor", "nurse"]);

  // Verify the user is the clinician assigned to the patient (not the visit)
  const { getVisitById } = await import("@/app/_lib/db/drizzle/queries/visit");
  const visit = await getVisitById(visitId);

  if (!visit) {
    throw new Error("Visit not found");
  }

  // Assigned clinician on patient OR on visit (handoff: nurse may set patient; doctor assign sets both)
  const { patients } = await import("@/app/_lib/db/drizzle/schema");
  const patientResult = await db
    .select({ clinicianId: patients.clinicianId })
    .from(patients)
    .where(eq(patients.id, visit.patientId))
    .limit(1);

  const patientClinicianId = patientResult[0]?.clinicianId ?? null;
  const visitClinicianId = visit.clinicianId ?? null;
  const isAssignedClinician =
    patientClinicianId === user.id || visitClinicianId === user.id;

  if (!patientResult[0] || !isAssignedClinician) {
    throw new Error("Only the assigned clinician can sign this note");
  }

  // Finalize the visit
  await finalizeVisit(visitId, user.id, status);

  // Sync all visit note sections to patient record (only when signing)
  if (status === "signed") {
    try {
      // Get all notes for this visit, ordered by creation date (most recent first)
      const visitNotes = await db
        .select({ note: notes.note })
        .from(notes)
        .where(eq(notes.visitId, visitId))
        .orderBy(desc(notes.createdAt));

      // Extract visit note data from the most recent note (first in array after ordering by desc)
      if (visitNotes.length > 0) {
        const latestNote = visitNotes[0];
        if (latestNote.note && typeof latestNote.note === "object") {
          const noteData = latestNote.note as any;

          // Sync all sections from visit note to patient record
          const { syncVisitNoteToPatientAction } = await import(
            "@/app/_actions/visit-sync"
          );
          const syncResult = await syncVisitNoteToPatientAction(
            visit.patientId,
            {
              medications: noteData.medications,
              vaccines: noteData.vaccines,
              familyHistory: noteData.familyHistory,
              surgicalHistory: noteData.surgicalHistory,
              pastMedicalHistory: noteData.pastMedicalHistory,
              riskFlags: noteData.riskFlags,
              objective: noteData.objective,
            }
          );

          if (syncResult.success) {
            console.log(
              "Visit note sections synced to patient record:",
              syncResult.results
            );
          }
        }
      }
    } catch (error) {
      console.error("Error syncing visit note sections on sign:", error);
      // Don't fail the finalization if sync fails - data is already saved in the visit note
    }
  }

  // Invalidate cache tags
  revalidateTag(`visit:${visitId}`, "max");
  revalidateTag(`visits:${visit.patientId}`, "max");
  revalidateTag(`patient:${visit.patientId}`, "max");
  revalidateTag("waiting-room", "max");

  return { success: true };
}

/**
 * Update patient is_assigned field (server action)
 */
export async function updatePatientAssignedAction(
  patientId: string,
  isAssigned: boolean | null
) {
  await requireUser(["doctor", "nurse"]);

  await db
    .update(patients)
    .set({ isAssigned: isAssigned ?? null })
    .where(eq(patients.id, patientId));

  return { success: true };
}

/**
 * Mark visit as in progress when editing a signed note (server action)
 */
export async function markVisitInProgressAction(
  visitId: string,
  reason?: string
) {
  const user = await requireUser(["doctor", "nurse"]);

  const { markVisitInProgress } = await import(
    "@/app/_lib/db/drizzle/queries/visit"
  );
  await markVisitInProgress(visitId, user.id, reason);

  return { success: true };
}

/**
 * Save transcript immediately after recording (server action)
 */
export async function saveTranscriptAction(params: {
  visitId: string;
  text: string;
  rawText?: string;
}) {
  await requireUser(["doctor", "nurse"]);

  const { createTranscript } = await import(
    "@/app/_lib/db/drizzle/queries/transcripts"
  );
  await createTranscript({
    visitId: params.visitId,
    text: params.text,
    rawText: params.rawText || params.text,
  });

  return { success: true };
}

/**
 * Update visit with triage level and appointment type (server action)
 */
export async function updateVisitWaitingRoomAction(params: {
  visitId: string;
  triageLevel: string;
  appointmentType: string;
}) {
  const user = await requireUser(["doctor", "nurse"]);

  // Get current visit status before updating
  const { db } = await import("@/app/_lib/db/drizzle/index");
  const { visits, notes, users } = await import("@/app/_lib/db/drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const currentVisit = await db
    .select()
    .from(visits)
    .where(eq(visits.id, params.visitId))
    .limit(1);

  if (!currentVisit[0]) {
    throw new Error("Visit not found");
  }

  const fromStatus = currentVisit[0].status;

  // Get user name for audit log
  const userResult = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const userName = userResult[0]?.name || userResult[0]?.email || null;

  // Get patient ID from visit
  const patientId = currentVisit[0].patientId;

  // Update patient - set is_assigned to false when sending to waiting room
  const { patients } = await import("@/app/_lib/db/drizzle/schema");
  await db
    .update(patients)
    .set({
      isAssigned: false, // Set to false when sending to waiting room
      clinicianId: null, // Clear clinician assignment
    })
    .where(eq(patients.id, patientId));

  // Update visit - set clinician_id to null so it doesn't appear in anyone's open notes
  // Also reset createdAt to reset wait time when sending to waiting room
  await db
    .update(visits)
    .set({
      priority: params.triageLevel, // Save triage level to priority column
      appointmentType: params.appointmentType,
      status: "Waiting", // Set visit status to Waiting
      clinicianId: null, // Clear clinician assignment when sending to waiting room
      createdAt: new Date(), // Reset wait time when sending to waiting room
    })
    .where(eq(visits.id, params.visitId));

  // Also call updateVisitDraft for consistency
  await updateVisitDraft(params.visitId, {
    priority: params.triageLevel,
    appointmentType: params.appointmentType,
    status: "Waiting",
    clinicianId: null,
  });

  // Add audit log entry for status change to Waiting
  const visitNotes = await db
    .select()
    .from(notes)
    .where(eq(notes.visitId, params.visitId));

  for (const note of visitNotes) {
    const { addAuditLogEntry } = await import(
      "@/app/_lib/db/drizzle/queries/visit"
    );
    // Map status for display
    const fromStatusDisplay =
      fromStatus === "draft" || fromStatus === "in_progress"
        ? "In Progress"
        : fromStatus === "finalized" || fromStatus === "signed"
        ? "Signed & Complete"
        : fromStatus;
    await addAuditLogEntry(
      note.id,
      user.id,
      userName,
      "sent_to_waiting_room",
      fromStatusDisplay,
      "Waiting",
      `Triage: ${params.triageLevel}, Appointment: ${params.appointmentType}`
    );
  }

  return { success: true };
}

/**
 * Get patient's open visit (server action)
 */
export async function getPatientOpenVisitAction(patientId: string) {
  await requireUser(["doctor", "nurse"]);

  const openVisit = await getPatientOpenVisit(patientId);

  return { visit: openVisit };
}

/**
 * Assign visit to current user (server action)
 * Updates visit status to "In Progress", sets patient is_assigned to true, and sets clinician_id
 */
export async function assignVisitToMeAction(visitId: string) {
  const user = await requireUser(["doctor", "nurse"]);

  // Get visit to get patientId
  const { getVisitById } = await import("@/app/_lib/db/drizzle/queries/visit");
  const visit = await getVisitById(visitId);

  if (!visit) {
    throw new Error("Visit not found");
  }

  const fromStatus = visit.status;

  // Get user name for audit log
  const { db: dbImport } = await import("@/app/_lib/db/drizzle/index");
  const { users } = await import("@/app/_lib/db/drizzle/schema");
  const { eq: eqImport } = await import("drizzle-orm");

  const userResult = await dbImport
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eqImport(users.id, user.id))
    .limit(1);
  const userName = userResult[0]?.name || userResult[0]?.email || null;

  // Update patient assignment - mark as assigned when doctor takes the visit
  await db
    .update(patients)
    .set({
      isAssigned: true, // Mark patient as assigned when visit is assigned to doctor
      clinicianId: user.id, // Set clinician assignment
    })
    .where(eq(patients.id, visit.patientId));

  // Update visit: set status to "In Progress", set clinician_id, and reset createdAt to reset wait time
  // Use direct database update to ensure createdAt is properly updated
  const { visits } = await import("@/app/_lib/db/drizzle/schema");
  await dbImport
    .update(visits)
    .set({
      status: "In Progress",
      clinicianId: user.id, // Always set clinician_id for the visit
      createdAt: new Date(), // Reset wait time by updating createdAt
    })
    .where(eqImport(visits.id, visitId));

  // Also update via updateVisitDraft for consistency (though we already did the direct update above)
  await updateVisitDraft(visitId, {
    status: "In Progress",
    clinicianId: user.id,
  });

  // Add audit log entry for assignment
  const { notes } = await import("@/app/_lib/db/drizzle/schema");
  const visitNotes = await dbImport
    .select()
    .from(notes)
    .where(eqImport(notes.visitId, visitId));

  for (const note of visitNotes) {
    const { addAuditLogEntry } = await import(
      "@/app/_lib/db/drizzle/queries/visit"
    );
    // Map status for display
    const fromStatusDisplay =
      fromStatus === "draft" || fromStatus === "in_progress"
        ? "In Progress"
        : fromStatus === "Waiting" || fromStatus === "waiting"
        ? "Waiting"
        : fromStatus === "finalized" || fromStatus === "signed"
        ? "Signed & Complete"
        : fromStatus;
    await addAuditLogEntry(
      note.id,
      user.id,
      userName,
      "assigned_to_me",
      fromStatusDisplay,
      "In Progress",
      `Visit assigned to ${userName || user.id}`
    );
  }

  // Handle virtual appointments - create Twilio room and generate join link
  let joinUrl: string | null = null;
  let patientJoinToken: string | null = null;

  if (visit.appointmentType?.toLowerCase() === "virtual") {
    try {
      const { ensureTwilioRoom } = await import("@/app/_lib/twilio/video");
      const { generatePatientJoinToken } = await import(
        "@/app/_lib/twilio/video"
      );
      const { sendPatientSMS, sendPatientEmail } = await import(
        "@/app/_lib/twilio/messaging"
      );

      // Create or get Twilio room
      const roomName = `visit-${visitId}`;
      const { roomSid, roomName: finalRoomName } = await ensureTwilioRoom(
        roomName
      );

      // Generate patient join token
      patientJoinToken = generatePatientJoinToken(visitId, "24h");
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      joinUrl = `${baseUrl}/join/${patientJoinToken}`;

      // Update visit with Twilio room info
      await dbImport
        .update(visits)
        .set({
          twilioRoomName: finalRoomName,
          twilioRoomSid: roomSid,
          patientJoinToken: patientJoinToken,
        })
        .where(eqImport(visits.id, visitId));

      // Send join link to patient
      await Promise.all([
        sendPatientSMS(visit.patientId, joinUrl),
        sendPatientEmail(visit.patientId, joinUrl),
      ]);
    } catch (error) {
      console.error("Error setting up Twilio room:", error);
      // Don't fail the assignment if Twilio setup fails
    }
  }

  // Revalidate waiting room page to refresh the list
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/waiting-room");

  return {
    success: true,
    isVirtual: visit.appointmentType?.toLowerCase() === "virtual",
    joinUrl: joinUrl || null,
  };
}

/**
 * Get clinician's open visits (server action)
 */
export async function getClinicianOpenVisitsAction() {
  const user = await requireUser(["doctor", "nurse"]);

  const { getClinicianOpenVisits } = await import(
    "@/app/_lib/db/drizzle/queries/visit"
  );
  const visits = await getClinicianOpenVisits(user.id);

  return { visits };
}
