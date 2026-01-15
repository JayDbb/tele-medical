"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "@/app/_lib/supabase/server";
import { createPatient } from "@/app/_lib/db/drizzle/queries/patient-personal-details";
import { findExistingPatients } from "@/app/_lib/db/drizzle/queries/patients";
import { db } from "@/app/_lib/db/drizzle/index";
import { patients } from "@/app/_lib/db/drizzle/schema";
import { eq } from "drizzle-orm";

export interface CreatePatientPayload {
  patientId?: string; // Optional: if provided, use this ID for the patient
  firstName: string;
  lastName: string;
  preferredName?: string;
  dob?: string;
  sexAtBirth?: string;
  genderIdentity?: string;
  phone?: string;
  email?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
  primaryLanguage?: string;
  preferredCommMethod?: string;
  emergencyContactName?: string;
  emergencyContactRelationship?: string;
  emergencyContactPhone?: string;
  primaryCareProvider?: string;
  consentSignatureUrl?: string;
}

export async function createPatientAction(payload: CreatePatientPayload) {
  // Check authentication and role
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Allow doctors and nurses only
  if (session.role !== "doctor" && session.role !== "nurse") {
    throw new Error(
      "Unauthorized: Only doctors and nurses can create patients"
    );
  }

  try {
    // Check for existing patients with the same phone or email
    const existingPatients = await findExistingPatients(payload.phone, payload.email);
    
    if (existingPatients.length > 0) {
      return {
        success: false,
        error: "DUPLICATE",
        existingPatients: existingPatients.map(p => ({
          id: p.id,
          fullName: p.fullName,
          phone: p.phone,
          email: p.email,
          dob: p.dob,
          createdAt: p.createdAt,
        })),
      };
    }

    // Combine first and last name
    const fullName = `${payload.firstName} ${payload.lastName}`.trim();

    // Create patient in database
    const patient = await createPatient({
      fullName,
      preferredName: payload.preferredName || null,
      dob: payload.dob || null,
      sexAtBirth: payload.sexAtBirth || null,
      genderIdentity: payload.genderIdentity || null,
      phone: payload.phone || null,
      email: payload.email || null,
      streetAddress: payload.streetAddress || null,
      city: payload.city || null,
      state: payload.state || null,
      zip: payload.zip || null,
      primaryLanguage: payload.primaryLanguage || null,
      preferredCommMethod: payload.preferredCommMethod || null,
      emergencyContactName: payload.emergencyContactName || null,
      emergencyContactRelationship:
        payload.emergencyContactRelationship || null,
      emergencyContactPhone: payload.emergencyContactPhone || null,
      primaryCareProvider: payload.primaryCareProvider || null,
      consentSignatureUrl: payload.consentSignatureUrl || null,
    });

    // Revalidate the patients list page
    revalidatePath("/patients");

    return { success: true, patientId: patient.id };
  } catch (error) {
    console.error("Error creating patient:", error);
    throw new Error(
      error instanceof Error ? error.message : "Failed to create patient"
    );
  }
}

/**
 * Update patient assignment after creation
 */
export async function updatePatientAssignmentAction(
  patientId: string,
  action: "close" | "start-visit" | "send-to-waiting-room"
) {
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Allow doctors and nurses only
  if (session.role !== "doctor" && session.role !== "nurse") {
    throw new Error(
      "Unauthorized: Only doctors and nurses can update patient assignment"
    );
  }

  try {
    let updateData: { isAssigned: boolean | null; clinicianId: string | null } =
      {
        isAssigned: null,
        clinicianId: null,
      };

    if (action === "close") {
      // Close: is_assigned = null, clinician_id = null
      updateData = { isAssigned: null, clinicianId: null };
    } else if (action === "start-visit") {
      // Start Visit: is_assigned = true, clinician_id = current user
      updateData = { isAssigned: true, clinicianId: session.id };
    } else if (action === "send-to-waiting-room") {
      // Send to Waiting Room: is_assigned = false, clinician_id = null
      updateData = { isAssigned: false, clinicianId: null };
    }

    await db.update(patients).set(updateData).where(eq(patients.id, patientId));

    // Revalidate the patients list page
    revalidatePath("/patients");
    revalidatePath(`/patients/${patientId}`);

    return { success: true };
  } catch (error) {
    console.error("Error updating patient assignment:", error);
    throw new Error(
      error instanceof Error
        ? error.message
        : "Failed to update patient assignment"
    );
  }
}

/**
 * Update patient consent signature URL
 */
export async function updatePatientConsentSignatureAction(
  patientId: string,
  consentSignatureUrl: string
) {
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Allow doctors and nurses only
  if (session.role !== "doctor" && session.role !== "nurse") {
    throw new Error(
      "Unauthorized: Only doctors and nurses can update patient consent signature"
    );
  }

  try {
    await db
      .update(patients)
      .set({ consentSignatureUrl, updatedAt: new Date() })
      .where(eq(patients.id, patientId));

    // Revalidate the patients list page
    revalidatePath("/patients");
    revalidatePath(`/patients/${patientId}`);

    return { success: true };
  } catch (error) {
    console.error("Error updating patient consent signature:", error);
    throw new Error(
      error instanceof Error
        ? error.message
        : "Failed to update patient consent signature"
    );
  }
}
