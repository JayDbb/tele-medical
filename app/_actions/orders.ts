"use server";

import { requireUser } from "@/app/_lib/auth/get-current-user";
import { db } from "@/app/_lib/db/drizzle/index";
import { visits, notes, users } from "@/app/_lib/db/drizzle/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import type { VisitNote } from "@/app/_lib/visit-note/schema";

export interface Order {
  id: string; // visitId + index for uniqueness
  visitId: string;
  type: string;
  priority: string;
  details: string;
  status: string;
  dateOrdered: string;
  orderedBy: string | null;
  orderedByName: string | null;
  visitDate: Date;
}

/**
 * Server action to get all orders for a patient
 * Aggregates orders from all visit notes
 */
export async function getPatientOrdersAction(patientId: string): Promise<Order[]> {
  try {
    await requireUser(["doctor", "nurse"]);
    
    // Get all visits for this patient
    const patientVisits = await db
      .select({
        id: visits.id,
        clinicianId: visits.clinicianId,
        createdAt: visits.createdAt,
      })
      .from(visits)
      .where(eq(visits.patientId, patientId))
      .orderBy(desc(visits.createdAt));

    if (patientVisits.length === 0) {
      return [];
    }

    // Get all notes for these visits
    const visitIds = patientVisits.map(v => v.id);
    
    if (visitIds.length === 0) {
      return [];
    }

    const allNotesProper = await db
      .select({
        id: notes.id,
        visitId: notes.visitId,
        note: notes.note,
        authorId: notes.authorId,
      })
      .from(notes)
      .where(inArray(notes.visitId, visitIds));

    // Get clinician names
    const clinicianIds = [
      ...new Set([
        ...patientVisits.map(v => v.clinicianId).filter((id): id is string => id !== null),
        ...allNotesProper.map(n => n.authorId).filter((id): id is string => id !== null),
      ])
    ];

    const clinicians = clinicianIds.length > 0
      ? await db
          .select({
            id: users.id,
            name: users.name,
          })
          .from(users)
          .where(inArray(users.id, clinicianIds))
      : [];

    const clinicianMap = new Map(clinicians.map(c => [c.id, c.name || null]));

    // Create visit map for dates
    const visitMap = new Map(patientVisits.map(v => [v.id, v]));

    // Extract orders from all notes
    const allOrders: Order[] = [];
    
    for (const note of allNotesProper) {
      if (!note.note || typeof note.note !== 'object') continue;
      
      const visitNote = note.note as VisitNote;
      if (!visitNote.orders || !Array.isArray(visitNote.orders)) continue;

      const visit = visitMap.get(note.visitId);
      const orderedByName = note.authorId ? clinicianMap.get(note.authorId) || null : null;

      visitNote.orders.forEach((order, index) => {
        allOrders.push({
          id: `${note.visitId}-${index}`,
          visitId: note.visitId,
          type: order.type || "",
          priority: order.priority || "",
          details: order.details || "",
          status: order.status || "",
          dateOrdered: order.dateOrdered || "",
          orderedBy: note.authorId || null,
          orderedByName,
          visitDate: visit?.createdAt || new Date(),
        });
      });
    }

    // Sort by date ordered (most recent first), fallback to visit date
    allOrders.sort((a, b) => {
      const dateA = a.dateOrdered ? new Date(a.dateOrdered).getTime() : a.visitDate.getTime();
      const dateB = b.dateOrdered ? new Date(b.dateOrdered).getTime() : b.visitDate.getTime();
      return dateB - dateA;
    });

    return allOrders;
  } catch (error) {
    console.error("Error fetching orders:", error);
    throw new Error(
      error instanceof Error ? error.message : "Failed to fetch orders"
    );
  }
}
