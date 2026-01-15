import { type VisitNote, createEmptyVisitNote, parseVisitNote } from "./schema";

/**
 * Merge AI-parsed note into existing note
 * Most recent (AI) values always take precedence - no conflict detection
 */
export function mergeVisitNote(existing: VisitNote, aiParsed: Partial<VisitNote>): VisitNote {
  const merged = { ...existing };

  // Helper to check if a value is "meaningful" (non-empty)
  const isMeaningful = (value: any): boolean => {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (typeof value === "boolean") return true;
    if (typeof value === "number") return true;
    return false;
  };

  // Helper to merge with precedence to new (AI) values
  const mergeValue = (existingValue: any, newValue: any): any => {
    // If new value is meaningful, use it (most recent takes precedence)
    if (isMeaningful(newValue)) {
      return newValue;
    }
    // Otherwise keep existing
    return existingValue || "";
  };

  // Merge subjective
  if (aiParsed.subjective && typeof aiParsed.subjective === "object") {
    const existingSubjective =
      existing.subjective || createEmptyVisitNote().subjective;
    merged.subjective = {
      chiefComplaint: mergeValue(
        existingSubjective.chiefComplaint,
        aiParsed.subjective.chiefComplaint
      ),
      hpi: mergeValue(
        existingSubjective.hpi,
        aiParsed.subjective.hpi
      ),
    };
  }

  // Merge objective
  if (aiParsed.objective && typeof aiParsed.objective === "object") {
    const existingObjective =
      existing.objective || createEmptyVisitNote().objective;
    const emptyObjective = createEmptyVisitNote().objective;
    
    // Handle examFindings specially if it's an object
    let mergedExamFindings = existingObjective.examFindings || emptyObjective.examFindings;
    if (aiParsed.objective.examFindings) {
      if (typeof aiParsed.objective.examFindings === "object" && !Array.isArray(aiParsed.objective.examFindings)) {
        // New structured format
        const existingExamFindings = typeof existingObjective.examFindings === "object" && !Array.isArray(existingObjective.examFindings)
          ? existingObjective.examFindings
          : emptyObjective.examFindings;
        mergedExamFindings = {
          general: mergeValue(existingExamFindings.general, aiParsed.objective.examFindings.general),
          heent: mergeValue(existingExamFindings.heent, aiParsed.objective.examFindings.heent),
          neck: mergeValue(existingExamFindings.neck, aiParsed.objective.examFindings.neck),
          cardiovascular: mergeValue(existingExamFindings.cardiovascular, aiParsed.objective.examFindings.cardiovascular),
          lungs: mergeValue(existingExamFindings.lungs, aiParsed.objective.examFindings.lungs),
          abdomen: mergeValue(existingExamFindings.abdomen, aiParsed.objective.examFindings.abdomen),
          musculoskeletal: mergeValue(existingExamFindings.musculoskeletal, aiParsed.objective.examFindings.musculoskeletal),
          neurologic: mergeValue(existingExamFindings.neurologic, aiParsed.objective.examFindings.neurologic),
          skin: mergeValue(existingExamFindings.skin, aiParsed.objective.examFindings.skin),
          psychological: mergeValue(existingExamFindings.psychological, aiParsed.objective.examFindings.psychological),
        };
      } else if (typeof aiParsed.objective.examFindings === "string") {
        // Backward compatibility: if AI returns a string, keep existing structured format or convert
        mergedExamFindings = typeof existingObjective.examFindings === "object" && !Array.isArray(existingObjective.examFindings)
          ? existingObjective.examFindings
          : { ...emptyObjective.examFindings, general: aiParsed.objective.examFindings };
      }
    }
    
    merged.objective = {
      ...existingObjective,
      ...Object.fromEntries(
        Object.entries(aiParsed.objective)
          .filter(([key]) => key !== "examFindings")
          .map(([key, value]) => {
            const existingValue = existingObjective[key as keyof typeof existingObjective];
            return [key, mergeValue(existingValue, value)];
          })
      ),
      examFindings: mergedExamFindings,
    };
  }

  // Merge pointOfCare
  if (aiParsed.pointOfCare && typeof aiParsed.pointOfCare === "object") {
    const existingPointOfCare =
      existing.pointOfCare || createEmptyVisitNote().pointOfCare;
    const emptyPointOfCare = createEmptyVisitNote().pointOfCare;
    
    // Merge diabetes subsection
    let mergedDiabetes = existingPointOfCare.diabetes || emptyPointOfCare.diabetes;
    if (aiParsed.pointOfCare.diabetes && typeof aiParsed.pointOfCare.diabetes === "object") {
      mergedDiabetes = {
        ...mergedDiabetes,
        ...Object.fromEntries(
          Object.entries(aiParsed.pointOfCare.diabetes).map(([key, value]) => {
            const existingValue = mergedDiabetes[key as keyof typeof mergedDiabetes];
            return [key, mergeValue(existingValue, value)];
          })
        ),
      };
    }

    // Merge HIV
    const mergedHiv = aiParsed.pointOfCare.hiv !== undefined
      ? mergeValue(existingPointOfCare.hiv, aiParsed.pointOfCare.hiv)
      : (existingPointOfCare.hiv || "");

    // Merge syphilis
    let mergedSyphilis = existingPointOfCare.syphilis || emptyPointOfCare.syphilis;
    if (aiParsed.pointOfCare.syphilis && typeof aiParsed.pointOfCare.syphilis === "object") {
      mergedSyphilis = {
        result: mergeValue(mergedSyphilis.result, aiParsed.pointOfCare.syphilis.result),
        reactivity: mergeValue(mergedSyphilis.reactivity, aiParsed.pointOfCare.syphilis.reactivity),
      };
    }

    // Combine all merged subsections
    merged.pointOfCare = {
      diabetes: mergedDiabetes,
      hiv: mergedHiv,
      syphilis: mergedSyphilis,
    };
  }

  // Merge medications - append new medications to existing array
  if (aiParsed.medications && Array.isArray(aiParsed.medications)) {
    const existingMedications = existing.medications || [];
    merged.medications = [...existingMedications, ...aiParsed.medications];
  }

  // Merge assessmentPlan - handle both old format (object) and new format (array)
  if (aiParsed.assessmentPlan) {
    const existingAssessmentPlan = existing.assessmentPlan || createEmptyVisitNote().assessmentPlan;
    const emptyAssessmentPlan = createEmptyVisitNote().assessmentPlan;
    
    if (Array.isArray(aiParsed.assessmentPlan)) {
      // New format: array of assessment-plan pairs
      const existingArray = Array.isArray(existingAssessmentPlan) ? existingAssessmentPlan : [];
      // Append new entries from AI
      merged.assessmentPlan = [...existingArray, ...aiParsed.assessmentPlan];
    } else {
      // Old format: object with assessment/plan, or migration case
      // Use type assertion since we're handling legacy data that might be in old format
      const oldFormat = aiParsed.assessmentPlan as any;
      if (oldFormat && typeof oldFormat === "object" && ("assessment" in oldFormat || "plan" in oldFormat)) {
        // Convert old format to new array format
        // Ensure existing array entries have all required properties
        const existingArray = Array.isArray(existingAssessmentPlan) 
          ? existingAssessmentPlan.map(entry => ({
              assessment: entry.assessment || "",
              plan: entry.plan || "",
              medications: entry.medications || [],
              orders: entry.orders || [],
              followUp: entry.followUp || "",
              education: entry.education || "",
              coordination: entry.coordination || "",
            }))
          : (existingAssessmentPlan && typeof existingAssessmentPlan === "object" && "assessment" in existingAssessmentPlan
              ? [{
                  assessment: (existingAssessmentPlan as any).assessment || "",
                  plan: (existingAssessmentPlan as any).plan || "",
                  medications: (existingAssessmentPlan as any).medications || [],
                  orders: (existingAssessmentPlan as any).orders || [],
                  followUp: (existingAssessmentPlan as any).followUp || "",
                  education: (existingAssessmentPlan as any).education || "",
                  coordination: (existingAssessmentPlan as any).coordination || "",
                }]
              : []);
        
        const newEntry = {
          assessment: oldFormat.assessment || "",
          plan: oldFormat.plan || "",
          medications: oldFormat.medications || [],
          orders: oldFormat.orders || [],
          followUp: oldFormat.followUp || "",
          education: oldFormat.education || "",
          coordination: oldFormat.coordination || "",
        };
        
        // Only add if it has content
        if (newEntry.assessment || newEntry.plan) {
          merged.assessmentPlan = [...existingArray, newEntry];
        } else {
          merged.assessmentPlan = existingArray;
        }
      } else {
        merged.assessmentPlan = Array.isArray(existingAssessmentPlan) ? existingAssessmentPlan : emptyAssessmentPlan;
      }
    }
  }

  // Append arrays (new items are added, but we could deduplicate if needed)
  const emptyNote = createEmptyVisitNote();
  if (aiParsed.vaccines && aiParsed.vaccines.length > 0) {
    merged.vaccines = [
      ...(existing.vaccines || emptyNote.vaccines),
      ...aiParsed.vaccines,
    ];
  }
  if (aiParsed.familyHistory && aiParsed.familyHistory.length > 0) {
    merged.familyHistory = [
      ...(existing.familyHistory || emptyNote.familyHistory),
      ...aiParsed.familyHistory,
    ];
  }
  if (aiParsed.surgicalHistory && aiParsed.surgicalHistory.length > 0) {
    merged.surgicalHistory = [
      ...(existing.surgicalHistory || emptyNote.surgicalHistory),
      ...aiParsed.surgicalHistory,
    ];
  }
  if (aiParsed.pastMedicalHistory && aiParsed.pastMedicalHistory.length > 0) {
    merged.pastMedicalHistory = [
      ...(existing.pastMedicalHistory || emptyNote.pastMedicalHistory),
      ...aiParsed.pastMedicalHistory,
    ];
  }
  if (aiParsed.orders && aiParsed.orders.length > 0) {
    merged.orders = [
      ...(existing.orders || emptyNote.orders),
      ...aiParsed.orders,
    ];
  }

  // Merge riskFlags
  if (aiParsed.riskFlags && typeof aiParsed.riskFlags === "object") {
    const existingRiskFlags =
      existing.riskFlags || createEmptyVisitNote().riskFlags;
    merged.riskFlags = {
      ...existingRiskFlags,
      ...Object.fromEntries(
        Object.entries(aiParsed.riskFlags).map(([key, value]) => {
          const existingValue = existingRiskFlags[key as keyof typeof existingRiskFlags];
          return [key, mergeValue(existingValue, value)];
        })
      ),
    };
  }

  // Merge metadata
  if (aiParsed.transcript) merged.transcript = aiParsed.transcript;
  if (aiParsed.audioPath) merged.audioPath = aiParsed.audioPath;
  if (aiParsed.aiGeneratedAt) merged.aiGeneratedAt = aiParsed.aiGeneratedAt;

  return parseVisitNote(merged);
}

