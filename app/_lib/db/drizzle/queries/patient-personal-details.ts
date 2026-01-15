import { eq } from "drizzle-orm";
import { db } from "../index";
import { patients, users } from "../schema";

/**
 * Get patient personal details including clinician information
 * @param patientId - UUID of the patient
 * @returns Patient personal details with clinician info if available
 */
export async function getPatientPersonalDetails(patientId: string) {
  // Get patient data
  const patientResult = await db
    .select()
    .from(patients)
    .where(eq(patients.id, patientId))
    .limit(1);

  if (!patientResult[0]) {
    return null;
  }

  const patient = patientResult[0];

  // If clinician_id exists, fetch clinician details
  let clinicianName: string | null = null;
  let clinicianEmail: string | null = null;

  if (patient.clinicianId) {
    const clinicianResult = await db
      .select({
        name: users.name,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, patient.clinicianId))
      .limit(1);

    if (clinicianResult[0]) {
      clinicianName = clinicianResult[0].name || null;
      clinicianEmail = clinicianResult[0].email || null;
    }
  }

  // Extract emergency contact from emergency_contact JSONB field
  let emergencyContactName: string | null = null;
  let emergencyContactRelationship: string | null = null;
  let emergencyContactPhone: string | null = null;

  if (
    patient.emergencyContact &&
    typeof patient.emergencyContact === "object"
  ) {
    const ec = patient.emergencyContact as Record<string, unknown>;
    emergencyContactName = (ec.name as string) || null;
    emergencyContactRelationship = (ec.relationship as string) || null;
    emergencyContactPhone = (ec.phone as string) || null;
  }

  return {
    id: patient.id,
    fullName: patient.fullName,
    dob: patient.dob,
    phone: patient.phone,
    email: patient.email,
    address: patient.address,
    sexAtBirth: patient.sexAtBirth,
    genderIdentity: patient.genderIdentity,
    primaryLanguage: patient.primaryLanguage,
    preferredCommMethod: patient.preferredCommMethod,
    emergencyContactName,
    emergencyContactRelationship,
    emergencyContactPhone,
    clinicianId: patient.clinicianId,
    clinicianName,
    clinicianEmail,
    createdAt: patient.createdAt,
    updatedAt: patient.updatedAt,
  };
}

/**
 * Create a new patient
 * @param data - Patient data to create
 * @returns Created patient data
 */
export async function createPatient(data: {
  id?: string; // Optional: if provided, use this ID instead of auto-generating
  fullName: string;
  preferredName?: string | null;
  dob?: string | null;
  sexAtBirth?: string | null;
  genderIdentity?: string | null;
  phone?: string | null;
  email?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  primaryLanguage?: string | null;
  preferredCommMethod?: string | null;
  emergencyContactName?: string | null;
  emergencyContactRelationship?: string | null;
  emergencyContactPhone?: string | null;
  primaryCareProvider?: string | null;
  consentSignatureUrl?: string | null;
}) {
  // Combine street address, city, state, zip into address field
  const addressParts: string[] = [];
  if (data.streetAddress) addressParts.push(data.streetAddress);
  if (data.city) addressParts.push(data.city);
  if (data.state) addressParts.push(data.state);
  if (data.zip) addressParts.push(data.zip);
  const address = addressParts.length > 0 ? addressParts.join(", ") : null;

  // Store additional data in JSONB fields
  const additionalData: Record<string, unknown> = {};
  if (data.preferredName) additionalData.preferredName = data.preferredName;
  if (data.primaryCareProvider)
    additionalData.primaryCareProvider = data.primaryCareProvider;

  // Prepare emergency contact for emergency_contact JSONB field
  let emergencyContact: unknown = null;
  if (
    data.emergencyContactName ||
    data.emergencyContactRelationship ||
    data.emergencyContactPhone
  ) {
    emergencyContact = {
      name: data.emergencyContactName || null,
      relationship: data.emergencyContactRelationship || null,
      phone: data.emergencyContactPhone || null,
    };
  }

  const result = await db
    .insert(patients)
    .values({
      ...(data.id && { id: data.id }), // Only include id if provided
      fullName: data.fullName,
      dob: data.dob || null,
      sexAtBirth: data.sexAtBirth || null,
      genderIdentity: data.genderIdentity || null,
      phone: data.phone || null,
      email: data.email || null,
      address: address,
      primaryLanguage: data.primaryLanguage || null,
      preferredCommMethod: data.preferredCommMethod || null,
      // Store additional metadata in socialHistory JSONB field
      socialHistory:
        Object.keys(additionalData).length > 0 ? additionalData : null,
      // Store emergency contact in emergency_contact JSONB field
      emergencyContact: emergencyContact,
      consentSignatureUrl: data.consentSignatureUrl || null,
    })
    .returning();

  if (!result[0]) {
    throw new Error("Failed to create patient");
  }

  return result[0];
}

/**
 * Update patient personal details
 * @param patientId - UUID of the patient
 * @param data - Patient data to update
 * @returns Updated patient data
 */
export async function updatePatientPersonalDetails(
  patientId: string,
  data: {
    fullName?: string;
    dob?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    sexAtBirth?: string | null;
    genderIdentity?: string | null;
    primaryLanguage?: string | null;
    preferredCommMethod?: string | null;
    emergencyContactName?: string | null;
    emergencyContactRelationship?: string | null;
    emergencyContactPhone?: string | null;
  }
) {
  // Get existing patient data to preserve socialHistory
  const existingPatient = await db
    .select()
    .from(patients)
    .where(eq(patients.id, patientId))
    .limit(1);

  if (!existingPatient[0]) {
    throw new Error("Patient not found");
  }

  // Build update object with only provided fields
  const updateData: {
    fullName?: string;
    dob?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    sexAtBirth?: string | null;
    genderIdentity?: string | null;
    primaryLanguage?: string | null;
    preferredCommMethod?: string | null;
    emergencyContact?: unknown;
    socialHistory?: unknown;
    updatedAt: Date;
  } = {
    updatedAt: new Date(),
  };

  // Only include fields that are provided (not undefined)
  if (data.fullName !== undefined) updateData.fullName = data.fullName;
  if (data.dob !== undefined) updateData.dob = data.dob;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.sexAtBirth !== undefined) updateData.sexAtBirth = data.sexAtBirth;
  if (data.genderIdentity !== undefined)
    updateData.genderIdentity = data.genderIdentity;
  if (data.primaryLanguage !== undefined)
    updateData.primaryLanguage = data.primaryLanguage;
  if (data.preferredCommMethod !== undefined)
    updateData.preferredCommMethod = data.preferredCommMethod;

  // Handle emergency contact in emergency_contact JSONB field
  if (
    data.emergencyContactName !== undefined ||
    data.emergencyContactRelationship !== undefined ||
    data.emergencyContactPhone !== undefined
  ) {
    // Get existing emergency contact or create new object
    const existingEmergencyContact =
      (existingPatient[0].emergencyContact as Record<string, unknown>) || {};

    // Update emergency contact fields
    const updatedEmergencyContact = { ...existingEmergencyContact };
    if (data.emergencyContactName !== undefined) {
      updatedEmergencyContact.name = data.emergencyContactName;
    }
    if (data.emergencyContactRelationship !== undefined) {
      updatedEmergencyContact.relationship = data.emergencyContactRelationship;
    }
    if (data.emergencyContactPhone !== undefined) {
      updatedEmergencyContact.phone = data.emergencyContactPhone;
    }

    // Only set emergency_contact if there's at least one field with a value
    const hasAnyValue =
      updatedEmergencyContact.name ||
      updatedEmergencyContact.relationship ||
      updatedEmergencyContact.phone;

    updateData.emergencyContact = hasAnyValue ? updatedEmergencyContact : null;
  }

  const result = await db
    .update(patients)
    .set(updateData)
    .where(eq(patients.id, patientId))
    .returning();

  if (!result[0]) {
    throw new Error("Patient not found or update failed");
  }

  return result[0];
}
