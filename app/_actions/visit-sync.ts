"use server";

import { redirect } from "next/navigation";
import { getServerSession } from "@/app/_lib/supabase/server";
import { revalidatePath } from "next/cache";
import { v4 as uuidv4 } from "uuid";

// Import patient record update functions
import {
  getPatientMedications,
  updatePatientMedications,
  type Medication,
} from "@/app/_lib/db/drizzle/queries/medications";
import {
  getPatientVaccines,
  updatePatientVaccines,
  type VaccineHistory,
} from "@/app/_lib/db/drizzle/queries/vaccines";
import {
  getPatientFamilyHistory,
  updatePatientFamilyHistory,
  type FamilyHistoryEntry,
} from "@/app/_lib/db/drizzle/queries/family-history";
import {
  getPatientSurgicalHistory,
  updatePatientSurgicalHistory,
  type SurgicalHistoryEntry,
} from "@/app/_lib/db/drizzle/queries/surgical-history";
import {
  getPatientPastMedicalHistory,
  updatePatientPastMedicalHistory,
  type PastMedicalHistoryData,
} from "@/app/_lib/db/drizzle/queries/past-medical-history";
import {
  getPatientSocialHistory,
  updatePatientSocialHistory,
  type SocialHistory,
} from "@/app/_lib/db/drizzle/queries/social-history";
import {
  getPatientVitals,
  updatePatientVitals,
  type VitalEntry,
} from "@/app/_lib/db/drizzle/queries/vitals";

/**
 * Sync all visit note sections to patient record
 */
export async function syncVisitNoteToPatientAction(
  patientId: string,
  visitNote: {
    medications?: Array<{
      id?: string;
      brandName?: string;
      genericName?: string;
      strength?: string;
      form?: string;
      dosage?: string;
      frequency?: string;
      status?: "Active" | "Inactive" | "Discontinued";
      notes?: string;
      createdAt?: string;
    }>;
    vaccines?: Array<{
      name?: string;
      date?: string;
      dose?: string;
      site?: string;
      route?: string;
      lotNumber?: string;
      manufacturer?: string;
    }>;
    familyHistory?: Array<{
      relationship?: string;
      status?: string;
      conditions?: string;
    }>;
    surgicalHistory?: Array<{
      procedure?: string;
      date?: string;
      site?: string;
      surgeon?: string;
      outcome?: string;
      source?: string;
    }>;
    pastMedicalHistory?: Array<{
      condition?: string;
      status?: string;
      diagnosedDate?: string;
      impact?: string;
      icd10?: string;
      source?: string;
    }>;
    riskFlags?: {
      tobaccoUse?: string;
      tobaccoAmount?: string;
      alcoholUse?: string;
      alcoholFrequency?: string;
      housingStatus?: string;
      occupation?: string;
    };
    objective?: {
      bp?: string;
      hr?: string;
      temp?: string;
      weight?: string;
      height?: string;
      bmi?: string;
      spo2?: string;
      rr?: string;
    };
  }
) {
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Allow doctors and nurses only
  if (session.role !== "doctor" && session.role !== "nurse") {
    throw new Error(
      "Unauthorized: Only doctors and nurses can sync visit notes"
    );
  }

  try {
    const results = {
      medications: { added: 0, updated: 0 },
      vaccines: { added: 0, updated: 0 },
      familyHistory: { added: 0, updated: 0 },
      surgicalHistory: { added: 0, updated: 0 },
      pastMedicalHistory: { added: 0, updated: 0 },
      socialHistory: { updated: false },
      vitals: { added: false },
    };

    // Sync Medications
    if (visitNote.medications && visitNote.medications.length > 0) {
      const medicationsResult = await syncMedications(
        patientId,
        visitNote.medications
      );
      results.medications = medicationsResult;
    }

    // Sync Vaccines
    if (visitNote.vaccines && visitNote.vaccines.length > 0) {
      const vaccinesResult = await syncVaccines(patientId, visitNote.vaccines);
      results.vaccines = vaccinesResult;
    }

    // Sync Family History
    if (visitNote.familyHistory && visitNote.familyHistory.length > 0) {
      const familyHistoryResult = await syncFamilyHistory(
        patientId,
        visitNote.familyHistory
      );
      results.familyHistory = familyHistoryResult;
    }

    // Sync Surgical History
    if (visitNote.surgicalHistory && visitNote.surgicalHistory.length > 0) {
      const surgicalHistoryResult = await syncSurgicalHistory(
        patientId,
        visitNote.surgicalHistory
      );
      results.surgicalHistory = surgicalHistoryResult;
    }

    // Sync Past Medical History
    if (
      visitNote.pastMedicalHistory &&
      visitNote.pastMedicalHistory.length > 0
    ) {
      const pmhResult = await syncPastMedicalHistory(
        patientId,
        visitNote.pastMedicalHistory
      );
      results.pastMedicalHistory = pmhResult;
    }

    // Sync Risk Flags (Social History)
    if (visitNote.riskFlags) {
      const socialHistoryResult = await syncSocialHistory(
        patientId,
        visitNote.riskFlags
      );
      results.socialHistory = { updated: socialHistoryResult };
    }

    // Sync Vitals from objective section
    if (visitNote.objective) {
      const vitalsResult = await syncVitals(patientId, visitNote.objective);
      results.vitals = { added: vitalsResult };
    }

    // Revalidate patient pages
    revalidatePath(`/patients/${patientId}`);
    revalidatePath(`/patients/${patientId}/medications`);
    revalidatePath(`/patients/${patientId}/vaccines`);
    revalidatePath(`/patients/${patientId}/past-medical-history`);
    revalidatePath(`/patients/${patientId}/vitals`);

    return { success: true, results };
  } catch (error) {
    console.error("Error syncing visit note to patient:", error);
    throw new Error(
      error instanceof Error
        ? error.message
        : "Failed to sync visit note to patient"
    );
  }
}

/**
 * Sync medications from visit to patient
 */
async function syncMedications(
  patientId: string,
  visitMedications: Array<{
    id?: string;
    brandName?: string;
    genericName?: string;
    strength?: string;
    form?: string;
    dosage?: string;
    frequency?: string;
    status?: "Active" | "Inactive" | "Discontinued";
    notes?: string;
    createdAt?: string;
  }>
) {
  const existingMedications = await getPatientMedications(patientId);
  const updatedMedications = [...existingMedications];

  const medicationsMatch = (
    med1: Medication,
    med2: {
      brandName?: string;
      genericName?: string;
      strength?: string;
    }
  ): boolean => {
    const name1 = (med1.brandName || "")
      .toLowerCase()
      .trim();
    const name2 = (med2.brandName || "")
      .toLowerCase()
      .trim();

    if (!name1 || !name2) return false;

    const namesMatch = name1 === name2;

    if (!namesMatch) return false;

    if (
      med1.strength &&
      med2.strength &&
      med1.strength.toLowerCase().trim() !== med2.strength.toLowerCase().trim()
    ) {
      return false;
    }

    return true;
  };

  let added = 0;
  let updated = 0;

  for (const visitMed of visitMedications) {
    if (!visitMed.brandName?.trim()) {
      continue;
    }

    const existingIndex = updatedMedications.findIndex((existing) =>
      medicationsMatch(existing, visitMed)
    );

    if (existingIndex >= 0) {
      updatedMedications[existingIndex] = {
        ...updatedMedications[existingIndex],
        brandName:
          visitMed.brandName || updatedMedications[existingIndex].brandName,
        genericName: updatedMedications[existingIndex].genericName, // Preserve existing genericName if present
        strength:
          visitMed.strength || updatedMedications[existingIndex].strength,
        form: visitMed.form || updatedMedications[existingIndex].form,
        dosage: visitMed.dosage || updatedMedications[existingIndex].dosage,
        frequency:
          visitMed.frequency || updatedMedications[existingIndex].frequency,
        status: visitMed.status || updatedMedications[existingIndex].status,
        notes: visitMed.notes || updatedMedications[existingIndex].notes,
      };
      updated++;
    } else {
      const newMedication: Medication = {
        id: visitMed.id || uuidv4(),
        brandName: visitMed.brandName,
        genericName: undefined, // Not used in visit notes anymore
        strength: visitMed.strength,
        form: visitMed.form,
        dosage: visitMed.dosage,
        frequency: visitMed.frequency,
        status: visitMed.status || "Active",
        notes: visitMed.notes,
        createdAt: visitMed.createdAt || new Date().toISOString(),
      };
      updatedMedications.push(newMedication);
      added++;
    }
  }

  await updatePatientMedications(patientId, updatedMedications);
  return { added, updated };
}

/**
 * Sync vaccines from visit to patient
 */
async function syncVaccines(
  patientId: string,
  visitVaccines: Array<{
    name?: string;
    date?: string;
    dose?: string;
    site?: string;
    route?: string;
    lotNumber?: string;
    manufacturer?: string;
  }>
) {
  const existingVaccines = await getPatientVaccines(patientId);
  const updatedHistory = [...existingVaccines.history];

  const vaccinesMatch = (
    v1: VaccineHistory,
    v2: { name?: string; date?: string }
  ): boolean => {
    const name1 = (v1.vaccineName || "").toLowerCase().trim();
    const name2 = (v2.name || "").toLowerCase().trim();

    if (!name1 || !name2) return false;
    if (name1 !== name2) return false;

    // If dates are provided, they should match
    if (v1.dateAdministered && v2.date && v1.dateAdministered !== v2.date) {
      return false;
    }

    return true;
  };

  let added = 0;
  let updated = 0;

  for (const visitVaccine of visitVaccines) {
    if (!visitVaccine.name?.trim()) {
      continue;
    }

    const existingIndex = updatedHistory.findIndex((existing) =>
      vaccinesMatch(existing, visitVaccine)
    );

    if (existingIndex >= 0) {
      updatedHistory[existingIndex] = {
        ...updatedHistory[existingIndex],
        vaccineName:
          visitVaccine.name || updatedHistory[existingIndex].vaccineName,
        dateAdministered:
          visitVaccine.date || updatedHistory[existingIndex].dateAdministered,
        doseNumber:
          visitVaccine.dose || updatedHistory[existingIndex].doseNumber,
        administrationSite:
          visitVaccine.site || updatedHistory[existingIndex].administrationSite,
        route: visitVaccine.route || updatedHistory[existingIndex].route,
        lotNumber:
          visitVaccine.lotNumber || updatedHistory[existingIndex].lotNumber,
        manufacturer:
          visitVaccine.manufacturer ||
          updatedHistory[existingIndex].manufacturer,
      };
      updated++;
    } else {
      const newVaccine: VaccineHistory = {
        id: uuidv4(),
        vaccineName: visitVaccine.name || "",
        dateAdministered: visitVaccine.date || "",
        doseNumber: visitVaccine.dose,
        administrationSite: visitVaccine.site,
        route: visitVaccine.route,
        lotNumber: visitVaccine.lotNumber,
        manufacturer: visitVaccine.manufacturer,
        createdAt: new Date().toISOString(),
      };
      updatedHistory.push(newVaccine);
      added++;
    }
  }

  await updatePatientVaccines(patientId, {
    history: updatedHistory,
    scheduled: existingVaccines.scheduled,
  });
  return { added, updated };
}

/**
 * Sync family history from visit to patient
 */
async function syncFamilyHistory(
  patientId: string,
  visitFamilyHistory: Array<{
    relationship?: string;
    status?: string;
    conditions?: string;
  }>
) {
  const existingFamilyHistory = await getPatientFamilyHistory(patientId);
  const updatedFamilyHistory = [...existingFamilyHistory];

  const familyHistoryMatch = (
    f1: FamilyHistoryEntry,
    f2: { relationship?: string; conditions?: string }
  ): boolean => {
    const rel1 = (f1.relationship || "").toLowerCase().trim();
    const rel2 = (f2.relationship || "").toLowerCase().trim();

    if (!rel1 || !rel2) return false;
    if (rel1 !== rel2) return false;

    // Check if conditions overlap
    const conditions1 = (
      Array.isArray(f1.conditions) ? f1.conditions : [f1.conditions]
    )
      .join(" ")
      .toLowerCase();
    const conditions2 = (f2.conditions || "").toLowerCase();

    if (conditions2 && conditions1.includes(conditions2)) {
      return true;
    }

    return false;
  };

  let added = 0;
  let updated = 0;

  for (const visitEntry of visitFamilyHistory) {
    if (!visitEntry.relationship?.trim()) {
      continue;
    }

    const existingIndex = updatedFamilyHistory.findIndex((existing) =>
      familyHistoryMatch(existing, visitEntry)
    );

    const conditionsArray = visitEntry.conditions
      ? visitEntry.conditions
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
      : [];

    if (existingIndex >= 0) {
      // Merge conditions
      const existingConditions = Array.isArray(
        updatedFamilyHistory[existingIndex].conditions
      )
        ? updatedFamilyHistory[existingIndex].conditions
        : [updatedFamilyHistory[existingIndex].conditions].filter(Boolean);

      const mergedConditions = Array.from(
        new Set([...existingConditions, ...conditionsArray])
      );

      updatedFamilyHistory[existingIndex] = {
        ...updatedFamilyHistory[existingIndex],
        relationship:
          visitEntry.relationship ||
          updatedFamilyHistory[existingIndex].relationship,
        status:
          (visitEntry.status as "Living" | "Deceased") ||
          updatedFamilyHistory[existingIndex].status,
        conditions: mergedConditions,
      };
      updated++;
    } else {
      const newEntry: FamilyHistoryEntry = {
        id: uuidv4(),
        relationship: visitEntry.relationship,
        status: (visitEntry.status as "Living" | "Deceased") || "Living",
        conditions: conditionsArray.length > 0 ? conditionsArray : [],
        createdAt: new Date().toISOString(),
      };
      updatedFamilyHistory.push(newEntry);
      added++;
    }
  }

  await updatePatientFamilyHistory(patientId, updatedFamilyHistory);
  return { added, updated };
}

/**
 * Sync surgical history from visit to patient
 */
async function syncSurgicalHistory(
  patientId: string,
  visitSurgicalHistory: Array<{
    procedure?: string;
    date?: string;
    site?: string;
    surgeon?: string;
    outcome?: string;
    source?: string;
  }>
) {
  const existingSurgicalHistory = await getPatientSurgicalHistory(patientId);
  const updatedSurgicalHistory = [...existingSurgicalHistory];

  const surgicalHistoryMatch = (
    s1: SurgicalHistoryEntry,
    s2: { procedure?: string; date?: string }
  ): boolean => {
    const proc1 = (s1.procedure || "").toLowerCase().trim();
    const proc2 = (s2.procedure || "").toLowerCase().trim();

    if (!proc1 || !proc2) return false;
    if (proc1 !== proc2) return false;

    // If dates are provided, they should match
    if (s1.date && s2.date && s1.date !== s2.date) {
      return false;
    }

    return true;
  };

  let added = 0;
  let updated = 0;

  for (const visitEntry of visitSurgicalHistory) {
    if (!visitEntry.procedure?.trim()) {
      continue;
    }

    const existingIndex = updatedSurgicalHistory.findIndex((existing) =>
      surgicalHistoryMatch(existing, visitEntry)
    );

    if (existingIndex >= 0) {
      updatedSurgicalHistory[existingIndex] = {
        ...updatedSurgicalHistory[existingIndex],
        procedure:
          visitEntry.procedure ||
          updatedSurgicalHistory[existingIndex].procedure,
        date: visitEntry.date || updatedSurgicalHistory[existingIndex].date,
        site: visitEntry.site || updatedSurgicalHistory[existingIndex].site,
        surgeon:
          visitEntry.surgeon || updatedSurgicalHistory[existingIndex].surgeon,
        outcome:
          visitEntry.outcome || updatedSurgicalHistory[existingIndex].outcome,
        source:
          (visitEntry.source as
            | "Patient Reported"
            | "Medical Records"
            | "Other") || updatedSurgicalHistory[existingIndex].source,
      };
      updated++;
    } else {
      const newEntry: SurgicalHistoryEntry = {
        id: uuidv4(),
        procedure: visitEntry.procedure,
        date: visitEntry.date,
        site: visitEntry.site,
        surgeon: visitEntry.surgeon,
        outcome: visitEntry.outcome,
        source:
          (visitEntry.source as
            | "Patient Reported"
            | "Medical Records"
            | "Other") || "Patient Reported",
        createdAt: new Date().toISOString(),
      };
      updatedSurgicalHistory.push(newEntry);
      added++;
    }
  }

  await updatePatientSurgicalHistory(patientId, updatedSurgicalHistory);
  return { added, updated };
}

/**
 * Sync past medical history from visit to patient
 */
async function syncPastMedicalHistory(
  patientId: string,
  visitPMH: Array<{
    condition?: string;
    status?: string;
    diagnosedDate?: string;
    impact?: string;
    icd10?: string;
    source?: string;
  }>
) {
  const existingPMH = await getPatientPastMedicalHistory(patientId);
  const updatedEntries = [...existingPMH.entries];

  const pmhMatch = (
    p1: PastMedicalHistoryData["entries"][0],
    p2: { condition?: string; icd10?: string }
  ): boolean => {
    const cond1 = (p1.condition || "").toLowerCase().trim();
    const cond2 = (p2.condition || "").toLowerCase().trim();

    if (!cond1 || !cond2) return false;
    if (cond1 === cond2) return true;

    // Also check by ICD-10 code if available
    if (
      p1.icd10 &&
      p2.icd10 &&
      p1.icd10.toLowerCase().trim() === p2.icd10.toLowerCase().trim()
    ) {
      return true;
    }

    return false;
  };

  let added = 0;
  let updated = 0;

  for (const visitEntry of visitPMH) {
    if (!visitEntry.condition?.trim()) {
      continue;
    }

    const existingIndex = updatedEntries.findIndex((existing) =>
      pmhMatch(existing, visitEntry)
    );

    if (existingIndex >= 0) {
      updatedEntries[existingIndex] = {
        ...updatedEntries[existingIndex],
        condition:
          visitEntry.condition || updatedEntries[existingIndex].condition,
        status: visitEntry.status || updatedEntries[existingIndex].status,
        diagnosedDate:
          visitEntry.diagnosedDate ||
          updatedEntries[existingIndex].diagnosedDate,
        impact: visitEntry.impact || updatedEntries[existingIndex].impact,
        icd10: visitEntry.icd10 || updatedEntries[existingIndex].icd10,
        source: visitEntry.source || updatedEntries[existingIndex].source,
        // Preserve verification status if exists
      };
      updated++;
    } else {
      const newEntry: PastMedicalHistoryData["entries"][0] = {
        id: uuidv4(),
        condition: visitEntry.condition,
        status: visitEntry.status || "Active",
        diagnosedDate: visitEntry.diagnosedDate,
        impact: visitEntry.impact,
        icd10: visitEntry.icd10,
        source: visitEntry.source || "Patient Reported",
        verified: false,
        createdAt: new Date().toISOString(),
      };
      updatedEntries.push(newEntry);
      added++;
    }
  }

  await updatePatientPastMedicalHistory(patientId, {
    entries: updatedEntries,
    noSignificantPMH: existingPMH.noSignificantPMH,
    lastUpdated: new Date().toISOString(),
  });
  return { added, updated };
}

/**
 * Sync risk flags (social history) from visit to patient
 */
async function syncSocialHistory(
  patientId: string,
  riskFlags: {
    tobaccoUse?: string;
    tobaccoAmount?: string;
    alcoholUse?: string;
    alcoholFrequency?: string;
    housingStatus?: string;
    occupation?: string;
  }
): Promise<boolean> {
  const existingSocialHistory = await getPatientSocialHistory(patientId);
  const updated: SocialHistory = existingSocialHistory || {};

  let hasChanges = false;

  // Update tobacco use
  if (riskFlags.tobaccoUse) {
    const tobaccoStatus = riskFlags.tobaccoUse as
      | "Never"
      | "Former"
      | "Current";
    if (!updated.tobacco || updated.tobacco.status !== tobaccoStatus) {
      updated.tobacco = {
        status: tobaccoStatus,
        amount: riskFlags.tobaccoAmount || updated.tobacco?.amount,
      };
      hasChanges = true;
    } else if (
      riskFlags.tobaccoAmount &&
      updated.tobacco.amount !== riskFlags.tobaccoAmount
    ) {
      updated.tobacco.amount = riskFlags.tobaccoAmount;
      hasChanges = true;
    }
  }

  // Update alcohol use
  if (riskFlags.alcoholUse) {
    const alcoholStatus = riskFlags.alcoholUse as
      | "Never"
      | "Occasional"
      | "Regular"
      | "Former";
    if (!updated.alcohol || updated.alcohol.status !== alcoholStatus) {
      updated.alcohol = {
        status: alcoholStatus,
        frequency: riskFlags.alcoholFrequency || updated.alcohol?.frequency,
      };
      hasChanges = true;
    } else if (
      riskFlags.alcoholFrequency &&
      updated.alcohol.frequency !== riskFlags.alcoholFrequency
    ) {
      updated.alcohol.frequency = riskFlags.alcoholFrequency;
      hasChanges = true;
    }
  }

  // Update housing status
  if (riskFlags.housingStatus) {
    const housingStatus = riskFlags.housingStatus as
      | "Stable"
      | "Unstable"
      | "Homeless"
      | "Other";
    if (
      !updated.livingSituation ||
      updated.livingSituation.status !== housingStatus
    ) {
      updated.livingSituation = {
        status: housingStatus,
        description: updated.livingSituation?.description,
      };
      hasChanges = true;
    }
  }

  // Update occupation
  if (riskFlags.occupation) {
    if (
      !updated.occupation ||
      updated.occupation.title !== riskFlags.occupation
    ) {
      updated.occupation = {
        title: riskFlags.occupation,
        description: updated.occupation?.description,
      };
      hasChanges = true;
    }
  }

  if (hasChanges) {
    updated.lastUpdated = new Date().toISOString();
    await updatePatientSocialHistory(patientId, updated);
  }

  return hasChanges;
}

/**
 * Sync vitals from objective section to patient vitals
 */
async function syncVitals(
  patientId: string,
  objective: {
    bp?: string;
    hr?: string;
    temp?: string;
    weight?: string;
    height?: string;
    bmi?: string;
    spo2?: string;
    rr?: string;
  }
): Promise<boolean> {
  // Only create a vital entry if at least one vital measurement is present
  const hasVitalData =
    objective.bp?.trim() ||
    objective.hr?.trim() ||
    objective.temp?.trim() ||
    objective.weight?.trim() ||
    objective.height?.trim() ||
    objective.bmi?.trim() ||
    objective.spo2?.trim() ||
    objective.rr?.trim();

  if (!hasVitalData) {
    return false;
  }

  const existingVitals = await getPatientVitals(patientId);

  // Create new vital entry with current date
  const newVital: VitalEntry = {
    id: uuidv4(),
    date: new Date().toISOString().split("T")[0], // ISO date string (YYYY-MM-DD)
    bp: objective.bp?.trim() || undefined,
    hr: objective.hr?.trim() || undefined,
    temp: objective.temp?.trim() || undefined,
    weight: objective.weight?.trim() || undefined,
    height: objective.height?.trim() || undefined,
    bmi: objective.bmi?.trim() || undefined,
    spo2: objective.spo2?.trim() || undefined,
    rr: objective.rr?.trim() || undefined,
  };

  // Calculate BMI if weight and height are provided but BMI is not
  if (newVital.weight && newVital.height && !newVital.bmi) {
    const weightNum = parseFloat(newVital.weight);
    const heightNum = parseFloat(newVital.height);
    if (weightNum > 0 && heightNum > 0) {
      const weightKg = weightNum * 0.453592; // Convert lbs to kg
      const heightM = heightNum / 100; // Convert cm to m
      if (heightM > 0) {
        const bmi = (weightKg / (heightM * heightM)).toFixed(1);
        newVital.bmi = bmi;
      }
    }
  }

  // Add new vital entry and sort by date (most recent first)
  const updatedVitals = [...existingVitals, newVital].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  await updatePatientVitals(patientId, updatedVitals);
  return true;
}
