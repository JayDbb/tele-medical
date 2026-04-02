"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "@/app/_lib/supabase/server";
import {
  getPatientSocialHistory,
  updatePatientSocialHistory,
  type SocialHistory,
} from "@/app/_lib/db/drizzle/queries/social-history";

/** Shallow-merge nested objects so partial form tabs do not wipe sibling fields (e.g. occupation). */
function mergeSocialHistoryPatch(
  existing: SocialHistory,
  updates: Partial<SocialHistory>
): SocialHistory {
  const mergeObj = <T extends Record<string, unknown> | undefined>(
    base: T,
    patch: T | undefined
  ): T | undefined => {
    if (patch === undefined) return base;
    if (base === undefined || base === null) return patch;
    return { ...base, ...patch } as T;
  };

  return {
    ...existing,
    tobacco: mergeObj(existing.tobacco, updates.tobacco),
    alcohol: mergeObj(existing.alcohol, updates.alcohol),
    otherSubstances:
      updates.otherSubstances !== undefined
        ? updates.otherSubstances
        : existing.otherSubstances,
    occupation: mergeObj(existing.occupation, updates.occupation),
    livingSituation: mergeObj(
      existing.livingSituation,
      updates.livingSituation
    ),
    lifestyle: mergeObj(existing.lifestyle, updates.lifestyle),
    psychosocial: mergeObj(existing.psychosocial, updates.psychosocial),
    sexualHealth: mergeObj(existing.sexualHealth, updates.sexualHealth),
    clinicianNotes:
      updates.clinicianNotes !== undefined
        ? updates.clinicianNotes
        : existing.clinicianNotes,
    lastUpdated: new Date().toISOString(),
  };
}

export async function getPatientSocialHistoryAction(patientId: string) {
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Allow doctors and nurses only
  if (session.role !== "doctor" && session.role !== "nurse") {
    throw new Error(
      "Unauthorized: Only doctors and nurses can view social history"
    );
  }

  try {
    const socialHistory = await getPatientSocialHistory(patientId);
    return { success: true, socialHistory };
  } catch (error) {
    console.error("Error fetching social history:", error);
    throw new Error(
      error instanceof Error ? error.message : "Failed to fetch social history"
    );
  }
}

export async function updateSocialHistoryAction(
  patientId: string,
  updates: Partial<SocialHistory>
) {
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Allow doctors and nurses only
  if (session.role !== "doctor" && session.role !== "nurse") {
    throw new Error(
      "Unauthorized: Only doctors and nurses can update social history"
    );
  }

  try {
    const existing = (await getPatientSocialHistory(patientId)) || {};
    const updated = mergeSocialHistoryPatch(existing, updates);

    await updatePatientSocialHistory(patientId, updated);

    revalidatePath(`/patients/${patientId}/social-history`);
    revalidatePath(`/patients/${patientId}`);

    return { success: true };
  } catch (error) {
    console.error("Error updating social history:", error);
    throw new Error(
      error instanceof Error
        ? error.message
        : "Failed to update social history"
    );
  }
}

