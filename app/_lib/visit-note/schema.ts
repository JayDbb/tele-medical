import { z } from "zod";

/**
 * Visit Note Schema - matches the form structure
 * All fields are optional strings/booleans to allow partial data
 */
export const visitNoteSchema = z.object({
  // Subjective
  subjective: z
    .object({
      chiefComplaint: z.string().default(""),
      hpi: z.string().default(""),
    })
    .default({ chiefComplaint: "", hpi: "" }),

  // Objective
  objective: z
    .object({
      bp: z.string().default(""),
      hr: z.string().default(""),
      temp: z.string().default(""),
      weight: z.string().default(""),
      height: z.string().default(""),
      bmi: z.string().default(""),
      examFindings: z
        .object({
          general: z.string().default(""),
          heent: z.string().default(""),
          neck: z.string().default(""),
          cardiovascular: z.string().default(""),
          lungs: z.string().default(""),
          abdomen: z.string().default(""),
          musculoskeletal: z.string().default(""),
          neurologic: z.string().default(""),
          skin: z.string().default(""),
          psychological: z.string().default(""),
        })
        .default({
          general: "",
          heent: "",
          neck: "",
          cardiovascular: "",
          lungs: "",
          abdomen: "",
          musculoskeletal: "",
          neurologic: "",
          skin: "",
          psychological: "",
        }),
      visionOd: z.string().default(""),
      visionOs: z.string().default(""),
      visionOu: z.string().default(""),
      visionCorrection: z.string().default(""),
      visionBlurry: z.string().default(""),
      visionFloaters: z.string().default(""),
      visionPain: z.string().default(""),
      visionLastExamDate: z.string().default(""),
    })
    .default({
      bp: "",
      hr: "",
      temp: "",
      weight: "",
      height: "",
      bmi: "",
      examFindings: {
        general: "",
        heent: "",
        neck: "",
        cardiovascular: "",
        lungs: "",
        abdomen: "",
        musculoskeletal: "",
        neurologic: "",
        skin: "",
        psychological: "",
      },
      visionOd: "",
      visionOs: "",
      visionOu: "",
      visionCorrection: "",
      visionBlurry: "",
      visionFloaters: "",
      visionPain: "",
      visionLastExamDate: "",
    }),

  // Point of Care
  pointOfCare: z
    .object({
      diabetes: z
        .object({
          fastingGlucose: z.string().default(""),
          randomGlucose: z.string().default(""),
          hbA1cValue: z.string().default(""),
          hbA1cDate: z.string().default(""),
          homeMonitoring: z.string().default(""),
          averageReadings: z.string().default(""),
          hypoglycemiaEpisodes: z.string().default(""),
          hyperglycemiaSymptoms: z.string().default(""),
          footExam: z.string().default(""),
          eyeExamDue: z.string().default(""),
        })
        .default({
          fastingGlucose: "",
          randomGlucose: "",
          hbA1cValue: "",
          hbA1cDate: "",
          homeMonitoring: "",
          averageReadings: "",
          hypoglycemiaEpisodes: "",
          hyperglycemiaSymptoms: "",
          footExam: "",
          eyeExamDue: "",
        }),
      hiv: z.string().default("Unknown"), // "negative", "positive", or "Unknown"
      syphilis: z
        .object({
          result: z.string().default("Unknown"), // "positive", "negative", or "Unknown"
          reactivity: z.string().default("Unknown"), // "reactive", "non-reactive", or "Unknown"
        })
        .default({
          result: "Unknown",
          reactivity: "Unknown",
        }),
    })
    .default({
      diabetes: {
        fastingGlucose: "",
        randomGlucose: "",
        hbA1cValue: "",
        hbA1cDate: "",
        homeMonitoring: "",
        averageReadings: "",
        hypoglycemiaEpisodes: "",
        hyperglycemiaSymptoms: "",
        footExam: "",
        eyeExamDue: "",
      },
      hiv: "Unknown",
      syphilis: {
        result: "Unknown",
        reactivity: "Unknown",
      },
    }),

  // Medications (array of medication records) - matches patient medications structure
  medications: z
    .array(
      z.object({
        id: z.string().optional(), // Optional for new medications, required when syncing to patient
        brandName: z.string().optional().default(""),
        strength: z.string().optional().default(""),
        form: z.string().optional().default(""),
        dosage: z.string().optional().default(""),
        frequency: z.string().optional().default(""),
        status: z
          .enum(["Active", "Inactive", "Discontinued"])
          .default("Active"),
        notes: z.string().optional().default(""), // Can include linked diagnosis
        createdAt: z.string().optional(),
      })
    )
    .default([]),

  // Assessment & Plan - array of detailed assessment-plan entries
  assessmentPlan: z
    .array(
      z.object({
        assessment: z.string().default(""), // Diagnosis/assessment with ICD-10 (e.g., "Acute Otitis Media – New (H66.90)")
        plan: z.string().default(""),       // Treatment plan summary
        medications: z
          .array(
            z.object({
              brandName: z.string().default(""),
              strength: z.string().default(""),
              form: z.string().default(""),
              dosage: z.string().default(""),
              frequency: z.string().default(""),
            })
          )
          .default([]), // Medications linked to this diagnosis
        orders: z
          .array(
            z.object({
              type: z.string().default(""),
              priority: z.string().default(""),
              details: z.string().default(""),
              status: z.string().default(""),
              dateOrdered: z.string().default(""),
            })
          )
          .default([]), // Orders linked to this diagnosis
        followUp: z.string().default(""), // Follow-up instructions
        education: z.string().default(""), // Patient education provided
        coordination: z.string().default(""), // Care coordination notes
      })
    )
    .default([]),

  // Vaccines (array of vaccine records)
  vaccines: z
    .array(
      z.object({
        name: z.string().default(""),
        date: z.string().default(""),
        dose: z.string().default(""),
        site: z.string().default(""),
        route: z.string().default(""),
        lotNumber: z.string().default(""),
        manufacturer: z.string().default(""),
      })
    )
    .default([]),

  // Family History (array)
  familyHistory: z
    .array(
      z.object({
        relationship: z.string().default(""),
        status: z.string().default(""),
        conditions: z.string().default(""),
      })
    )
    .default([]),

  // Risk Flags
  riskFlags: z
    .object({
      tobaccoUse: z.string().default(""),
      tobaccoAmount: z.string().default(""),
      alcoholUse: z.string().default(""),
      alcoholFrequency: z.string().default(""),
      housingStatus: z.string().default(""),
      occupation: z.string().default(""),
    })
    .default({
      tobaccoUse: "",
      tobaccoAmount: "",
      alcoholUse: "",
      alcoholFrequency: "",
      housingStatus: "",
      occupation: "",
    }),

  // Surgical History (array)
  surgicalHistory: z
    .array(
      z.object({
        procedure: z.string().default(""),
        date: z.string().default(""),
        site: z.string().default(""),
        surgeon: z.string().default(""),
        outcome: z.string().default(""),
        source: z.string().default(""),
      })
    )
    .default([]),

  // Past Medical History (array)
  pastMedicalHistory: z
    .array(
      z.object({
        condition: z.string().default(""),
        status: z.string().default(""),
        diagnosedDate: z.string().default(""),
        impact: z.string().default(""),
        icd10: z.string().default(""),
        source: z.string().default(""),
      })
    )
    .default([]),

  // Orders (array)
  orders: z
    .array(
      z.object({
        type: z.string().default(""),
        priority: z.string().default(""),
        details: z.string().default(""),
        status: z.string().default(""),
        dateOrdered: z.string().default(""),
      })
    )
    .default([]),

  // Documents (array)
  docs: z
    .object({
      uploadedDocuments: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            type: z.string(),
            size: z.number(),
            uploadedAt: z.string(),
            dataUrl: z.string().optional(), // Client preview only, not stored in DB
            storageUrl: z.string().optional(), // Storage path for DB persistence
          })
        )
        .default([]),
    })
    .default({ uploadedDocuments: [] }),

  // Metadata
  transcript: z.string().optional(),
  audioPath: z.string().optional(),
  aiGeneratedAt: z.string().optional(),
});

export type VisitNote = z.infer<typeof visitNoteSchema>;

/**
 * Create an empty visit note with all defaults
 */
export function createEmptyVisitNote(): VisitNote {
  return visitNoteSchema.parse({});
}

/**
 * Migrate old format data to new format
 * Handles backward compatibility for examFindings (string -> object)
 */
function migrateVisitNoteData(data: any): any {
  if (!data || typeof data !== "object") {
    return data;
  }

  const migrated = { ...data };

  // Ensure objective exists
  if (!migrated.objective) {
    migrated.objective = {};
  }

  // Migrate examFindings from string to object format
  if (typeof migrated.objective === "object") {
    const examFindings = migrated.objective.examFindings;
    
    if (typeof examFindings === "string") {
      // Convert old string format to new object format
      // Put the old string in the "general" category
      migrated.objective = {
        ...migrated.objective,
        examFindings: {
          general: examFindings || "",
          heent: "",
          neck: "",
          cardiovascular: "",
          lungs: "",
          abdomen: "",
          musculoskeletal: "",
          neurologic: "",
          skin: "",
        },
      };
    } else if (
      !examFindings ||
      typeof examFindings !== "object" ||
      examFindings.general === undefined
    ) {
      // Ensure examFindings exists and has the correct structure
      migrated.objective = {
        ...migrated.objective,
        examFindings: {
          general: examFindings?.general || "",
          heent: examFindings?.heent || "",
          neck: examFindings?.neck || "",
          cardiovascular: examFindings?.cardiovascular || "",
          lungs: examFindings?.lungs || "",
          abdomen: examFindings?.abdomen || "",
          musculoskeletal: examFindings?.musculoskeletal || "",
          neurologic: examFindings?.neurologic || "",
          skin: examFindings?.skin || "",
          psychological: examFindings?.psychological || "",
        },
      };
    }
  }

  // Migrate assessmentPlan from old format (object) to new format (array)
  if (migrated.assessmentPlan) {
    if (typeof migrated.assessmentPlan === "object" && !Array.isArray(migrated.assessmentPlan)) {
      // Old format: object with assessment/plan
      if ("assessment" in migrated.assessmentPlan || "plan" in migrated.assessmentPlan) {
        const old = migrated.assessmentPlan as { assessment?: string; plan?: string };
        if (old.assessment || old.plan) {
          migrated.assessmentPlan = [{ 
            assessment: old.assessment || "", 
            plan: old.plan || "",
            medications: [],
            orders: [],
            followUp: "",
            education: "",
            coordination: "",
          }];
        } else {
          migrated.assessmentPlan = [];
        }
      }
    } else if (Array.isArray(migrated.assessmentPlan)) {
      // Ensure all entries have the new structure
      migrated.assessmentPlan = migrated.assessmentPlan.map((entry: any) => ({
        assessment: entry.assessment || "",
        plan: entry.plan || "",
        medications: entry.medications || [],
        orders: entry.orders || [],
        followUp: entry.followUp || "",
        education: entry.education || "",
        coordination: entry.coordination || "",
      }));
    }
  } else {
    migrated.assessmentPlan = [];
  }

  return migrated;
}

/**
 * Validate and parse a visit note (from AI or user input)
 * Returns the parsed note or throws if invalid
 */
export function parseVisitNote(data: unknown): VisitNote {
  const migrated = migrateVisitNoteData(data);
  return visitNoteSchema.parse(migrated);
}
