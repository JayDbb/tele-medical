import { parseVisitNote, type VisitNote } from "@/app/_lib/visit-note/schema";

interface ParseVisitOptions {
  transcript: string;
  prompt?: string;
  patientContext?: {
    allergies?: unknown[];
    meds?: unknown[];
    pmh?: unknown[];
  };
  previousTranscripts?: string[];
}

/**
 * Clean JSON content by removing comments, extracting JSON from markdown, etc.
 */
function cleanJsonContent(rawContent: string): string {
  let cleaned = rawContent;

  // Extract JSON from markdown code blocks
  const jsonMatch =
    cleaned.match(/```json\s*([\s\S]*?)\s*```/) ||
    cleaned.match(/```\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    cleaned = jsonMatch[1];
  }

  // Extract JSON object (from first { to last })
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  // Remove single-line comments
  const lines = cleaned.split("\n");
  const cleanedLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comment-only lines
    if (trimmed.startsWith("//")) {
      continue;
    }

    // Remove inline comments
    const commentMatch = line.match(/(.*?)(\/\/.*)$/);
    if (commentMatch) {
      const beforeComment = commentMatch[1].trim();
      // Check if the part before // looks like valid JSON (ends with quote, number, bracket, etc.)
      // Check if it ends with valid JSON tokens: quote, digit, ], }, comma, whitespace
      // Place ] at the start of character class to avoid escaping issues
      const endsWithValidJson = /[\]"}\d,]\s*$/.test(beforeComment.trim());
      if (endsWithValidJson) {
        cleanedLines.push(beforeComment);
        continue;
      }
    }

    cleanedLines.push(line);
  }
  cleaned = cleanedLines.join("\n");

  // Remove remaining inline comments
  cleaned = cleaned.replace(/(["\d\]\}\]])\s*\/\/[^\n]*/g, "$1");

  // Remove multi-line comments
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");

  // Remove trailing commas
  cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1");

  return cleaned;
}

/**
 * Remove duplicate keys from JSON string
 */
function removeDuplicateKeys(jsonStr: string): string {
  const duplicatePattern = /,\s*"familyHistory"\s*:\s*\[[\s\S]*?\]\s*(?=,|\})/g;
  const matches = [...jsonStr.matchAll(duplicatePattern)];
  if (matches.length > 0) {
    // Remove all but the first occurrence
    for (let i = matches.length - 1; i > 0; i--) {
      const match = matches[i];
      if (match.index !== undefined) {
        jsonStr =
          jsonStr.substring(0, match.index) +
          jsonStr.substring(match.index + match[0].length);
      }
    }
  }
  return jsonStr;
}

/**
 * Aggressively clean and parse JSON with fallback strategies
 */
function parseJsonWithFallback(content: string): unknown {
  try {
    let jsonContent = cleanJsonContent(content);

    try {
      return JSON.parse(jsonContent);
    } catch {
      // Try removing duplicate keys
      jsonContent = removeDuplicateKeys(jsonContent);
      jsonContent = cleanJsonContent(jsonContent);
      return JSON.parse(jsonContent);
    }
  } catch (parseError) {
    console.error("Failed to parse JSON from AI response");
    console.error("Parse error:", parseError);
    console.error("Content length:", content.length);
    console.error(
      "Content preview (first 1000 chars):",
      content.substring(0, 1000)
    );
    console.error(
      "Content preview (last 1000 chars):",
      content.substring(Math.max(0, content.length - 1000))
    );

    // Last resort: aggressive cleanup
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      throw parseError;
    }

    let cleanedJson = content.substring(jsonStart, jsonEnd + 1);

    // Remove all comments
    cleanedJson = cleanedJson.replace(/\/\/[^\n\r]*(?:\n|\r|$)/gm, "");
    cleanedJson = cleanedJson.replace(/\/\*[\s\S]*?\*\//g, "");

    // Remove trailing commas
    cleanedJson = cleanedJson.replace(/,(\s*[}\]])/g, "$1");

    // Remove duplicate familyHistory key
    const lastFamilyHistoryIndex = cleanedJson.lastIndexOf('"familyHistory"');
    if (lastFamilyHistoryIndex > 0) {
      const firstFamilyHistoryIndex = cleanedJson.indexOf('"familyHistory"');
      if (lastFamilyHistoryIndex !== firstFamilyHistoryIndex) {
        // Find the matching closing bracket for the duplicate
        let bracketCount = 0;
        let removeStart = lastFamilyHistoryIndex;
        let removeEnd = lastFamilyHistoryIndex;

        // Find the start (go back to find the comma or opening brace)
        for (let i = lastFamilyHistoryIndex - 1; i >= 0; i--) {
          if (cleanedJson[i] === ",") {
            removeStart = i;
            break;
          } else if (cleanedJson[i] === "{" || cleanedJson[i] === "}") {
            removeStart = i + 1;
            break;
          }
        }

        // Find the end (find matching ])
        for (let i = lastFamilyHistoryIndex; i < cleanedJson.length; i++) {
          if (cleanedJson[i] === "[") bracketCount++;
          if (cleanedJson[i] === "]") bracketCount--;
          if (bracketCount === 0 && cleanedJson[i] === "]") {
            removeEnd = i + 1;
            // Also remove trailing comma if present
            if (i + 1 < cleanedJson.length && cleanedJson[i + 1] === ",") {
              removeEnd = i + 2;
            }
            break;
          }
        }

        // Remove the duplicate
        cleanedJson =
          cleanedJson.substring(0, removeStart) +
          cleanedJson.substring(removeEnd);
      }
    }

    const parsed = JSON.parse(cleanedJson);
    console.log("Successfully parsed after aggressive cleanup");
    return parsed;
  }
}

/**
 * Parse transcript into structured visit note
 * This is the core parsing logic that can be called directly from server code
 * without going through the HTTP API.
 */
export async function parseVisitNoteFromTranscript(
  options: ParseVisitOptions
): Promise<VisitNote> {
  const { transcript, prompt, patientContext, previousTranscripts } = options;

  if (!transcript || typeof transcript !== "string") {
    throw new Error("Missing or invalid transcript");
  }

  const replicateApiKey = process.env.REPLICATE_API_KEY;
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;

  // Build the system prompt with schema
  const systemPrompt = `You are a medical assistant that extracts structured visit note data from transcripts. 
Return ONLY valid JSON matching this exact schema. Never omit required fields - use empty strings, false, or empty arrays for missing data.
Never hallucinate values - if information is not in the transcript, use empty string, false, or empty array.

CRITICAL JSON FORMATTING RULES:
- Return ONLY valid JSON - no comments, no explanations, no markdown code blocks
- Do NOT include // comments in the JSON
- Do NOT include duplicate keys (each key must appear only once)
- Do NOT wrap the JSON in markdown code blocks or add explanatory text
- Return the raw JSON object only, starting with { and ending with }

CRITICAL EXTRACTION RULES:
1. EXTRACT ALL INFORMATION that is explicitly mentioned in the transcript
2. Be thorough - if the transcript mentions "blood pressure of 180/90", extract it as "bp": "180/90"
3. If the transcript mentions "heart rate of 100", extract it as "hr": "100"
4. If the transcript mentions "7 feet tall", convert to cm: 7 * 30.48 = 213.36, extract as "height": "213.36"
5. If the transcript mentions weight, extract as pounds (numeric only, no "lbs" text)
6. If the transcript mentions medications, create an array entry for EACH medication
7. If the transcript mentions conditions, diagnoses, or complaints, extract them to the appropriate fields
8. Extract measurements, vitals, and any numerical values mentioned
9. DATE CONVERSION: Convert relative dates to actual dates in YYYY-MM-DD format:
   - The current date will be provided in the prompt - use it to calculate relative dates
   - Calculate dates relative to TODAY (the current date provided)
   - Examples of relative date conversions:
     * "a month ago" or "1 month ago" → Subtract 1 month from current date (e.g., if today is 2024-12-15, "a month ago" = 2024-11-15)
     * "2 months ago" → Subtract 2 months from current date
     * "about a month ago" → Subtract 1 month from current date
     * "a week ago" or "1 week ago" → Subtract 7 days from current date
     * "2 weeks ago" → Subtract 14 days from current date
     * "3 weeks ago" → Subtract 21 days from current date
     * "a year ago" or "1 year ago" → Subtract 1 year from current date
     * "2 years ago" → Subtract 2 years from current date
     * "last month" → First day of previous month (e.g., if today is 2024-12-15, "last month" = 2024-11-01)
     * "last year" → Same date in previous year (e.g., if today is 2024-12-15, "last year" = 2023-12-15)
     * "yesterday" → Subtract 1 day from current date
     * "last week" → Subtract 7 days from current date
     * "a few months ago" → Approximate as 2-3 months ago (use 2 months for calculation)
     * "several weeks ago" → Approximate as 3-4 weeks ago (use 3 weeks for calculation)
   - Always use YYYY-MM-DD format (e.g., "2024-01-15")
   - If only a month/year is mentioned (e.g., "January 2024"), use the first day: "2024-01-01"
   - If an exact date is mentioned (e.g., "January 15th, 2024"), convert to: "2024-01-15"
   - Be smart about context: "got a vaccine about a month ago" means calculate the date 1 month before the current date

UNIT REQUIREMENTS:
- Weight: Always extract as POUNDS (numeric only, no "lbs" text). If given in kg, convert (1 kg = 2.20462 lbs)
- Height: Always extract as CENTIMETERS (numeric only, no "cm" text). Convert from feet/inches if needed:
  * 1 foot = 30.48 cm
  * 1 inch = 2.54 cm
  * Example: "6 feet" = 182.88 cm → "182.88"
  * Example: "5'10\"" = (5*30.48) + (10*2.54) = 152.4 + 25.4 = 177.8 cm → "177.8"
  * Example: "70 inches" = 70*2.54 = 177.8 cm → "177.8"

EXAMPLES:
- Transcript: "Patient is 6 feet tall, weighs 180 pounds, BP 120/80, HR 72" 
  → Extract: height: "182.88", weight: "180", bp: "120/80", hr: "72"
- Transcript: "Patient is 5'10\" and weighs 170 lbs" 
  → Extract: height: "177.8", weight: "170"
- Transcript: "Patient takes Metformin 500mg twice daily" 
  → Extract: medications: [{"name": "Metformin 500mg", "dosage": "twice daily", ...}]
- Transcript: "Patient complains of chest pain" 
  → Extract: subjective.chiefComplaint: "chest pain"
- Transcript: "Fasting glucose was 95, HbA1c is 7.2% from last month" 
  → Extract: pointOfCare.diabetes.fastingGlucose: "95", pointOfCare.diabetes.hbA1cValue: "7.2", pointOfCare.diabetes.hbA1cDate: "YYYY-MM-DD" (calculate: today minus 1 month)
- Transcript: "Patient got the flu vaccine about a month ago" 
  → Extract: vaccines: [{"name": "Flu vaccine", "date": "YYYY-MM-DD"}] (calculate: today minus 1 month)
- Transcript: "Surgery was done 2 years ago" 
  → Extract: surgicalHistory: [{"procedure": "...", "date": "YYYY-MM-DD"}] (calculate: today minus 2 years)
- Transcript: "Diagnosed with diabetes 3 weeks ago" 
  → Extract: pastMedicalHistory: [{"condition": "diabetes", "diagnosedDate": "YYYY-MM-DD"}] (calculate: today minus 21 days)
- Transcript: "HIV test came back negative" 
  → Extract: pointOfCare.hiv: "negative"
- Transcript: "Syphilis test was positive and reactive" 
  → Extract: pointOfCare.syphilis: {"result": "positive", "reactivity": "reactive"}
- Transcript: "Syphilis screening was non-reactive" 
  → Extract: pointOfCare.syphilis: {"result": "", "reactivity": "non-reactive"}
- Transcript: "Physical exam: Patient appears well. Heart regular rate and rhythm, no murmurs. Lungs clear bilaterally. Abdomen soft, non-tender. Skin clear." 
  → Extract: examFindings: {"general": "Patient appears well", "cardiovascular": "Regular rate and rhythm, no murmurs", "lungs": "Clear bilaterally", "abdomen": "Soft, non-tender", "skin": "Clear", "heent": "", "neck": "", "musculoskeletal": "", "neurologic": "", "psychological": ""}

IMPORTANT INSTRUCTIONS:
- Extract ALL information mentioned in the transcript, including medications, vaccines, family history, surgical history, past medical history, orders, and point of care tests
- For medications: Create an array entry for EACH medication mentioned. Include brand name, dosage, frequency, and any related information. If a medication is linked to a specific diagnosis, you can include that in the notes field. Note: Medications can also be included within assessmentPlan entries for diagnosis-specific medications.
- For vaccines: Extract each vaccine mentioned with its details (name, date, dose, site, route, lot number, manufacturer). Convert relative dates (e.g., "a month ago", "2 weeks ago") to actual dates in YYYY-MM-DD format
- For family history: Extract each family member's medical history mentioned
- For surgical history: Extract each surgery/procedure mentioned. Convert relative dates (e.g., "2 years ago", "last year") to actual dates in YYYY-MM-DD format
- For past medical history: Extract each condition mentioned. Convert relative dates (e.g., "diagnosed 3 weeks ago", "a year ago") to actual dates in YYYY-MM-DD format for diagnosedDate
- For orders: Extract each order/prescription/test ordered
- For assessment & plan: Create an array entry for EACH diagnosis/condition mentioned. Each entry should include:
  * assessment: Diagnosis with ICD-10 code if mentioned (e.g., "Acute Otitis Media – New (H66.90)")
  * plan: Treatment plan summary (e.g., "Start antibiotics.")
  * medications: Array of medications prescribed for this diagnosis (include full details: name, dosage, frequency)
  * orders: Array of orders/prescriptions/tests for this diagnosis
  * followUp: Follow-up instructions (e.g., "PRN if no improvement in 48 hours")
  * education: Patient education provided (e.g., "Discussed expected course and return precautions.")
  * coordination: Care coordination notes (e.g., "None" or referral details)
  Example: [{"assessment": "Acute Otitis Media – New (H66.90)", "plan": "Start antibiotics.", "medications": [{"brandName": "Amoxicillin 400 mg/5 mL", "dosage": "7.5 mL", "frequency": "PO BID x 10 days"}], "orders": [], "followUp": "PRN if no improvement in 48 hours", "education": "Discussed expected course and return precautions.", "coordination": "None"}]
- For point of care tests:
  * Diabetes: Extract all diabetes-related information (glucose levels, HbA1c, monitoring, exams, etc.)
  * HIV: Extract HIV test results as "negative" or "positive" (e.g., "HIV test was negative" → "hiv": "negative")
  * Syphilis: Extract syphilis test results - result should be "positive" or "negative", reactivity should be "reactive" or "non-reactive" (e.g., "Syphilis test was positive and reactive" → "syphilis": {"result": "positive", "reactivity": "reactive"})
- For physical examination findings: Organize findings into appropriate categories:
  * General: General appearance, alertness, level of distress, nutritional status, etc.
  * HEENT: Head, Eyes (pupils, EOM, fundoscopic), Ears (tympanic membranes), Nose, Throat examination
  * Neck: Neck examination, lymph nodes, thyroid, masses, range of motion, etc.
  * Cardiovascular: Heart sounds, rhythm, murmurs, pulses, JVD, peripheral edema, etc.
  * Lungs: Respiratory rate, breath sounds, wheezes, rales, percussion, etc.
  * Abdomen: Inspection, auscultation (bowel sounds), palpation, percussion, organomegaly, etc.
  * Musculoskeletal: Range of motion, strength, deformities, gait, etc.
  * Neurologic: Mental status, cranial nerves, reflexes, sensation, coordination, gait, etc.
  * Skin: Rashes, lesions, color, temperature, turgor, etc.
  * Psychological: Mood, affect, thought process, judgment, insight, behavior, etc.

Schema:
{
  "subjective": { 
    "chiefComplaint": "",  // Primary reason for visit
    "hpi": ""              // History of present illness
  },
  "objective": { 
    "bp": "",              // Blood pressure (e.g., "120/80")
    "hr": "",              // Heart rate (e.g., "72")
    "temp": "",            // Temperature (e.g., "98.6")
    "weight": "",          // Weight in POUNDS - numeric value only, NO unit text (e.g., "170" not "170 lbs")
    "height": "",          // Height in CENTIMETERS - numeric value only, NO unit text (e.g., "178" not "178 cm"). Convert from feet/inches if needed (1 foot = 30.48 cm, 1 inch = 2.54 cm)
    "examFindings": {     // Physical examination findings organized by system
      "general": "",      // General appearance, alertness, distress, etc.
      "heent": "",        // Head, Eyes, Ears, Nose, Throat examination
      "neck": "",         // Neck examination, lymph nodes, thyroid, etc.
      "cardiovascular": "", // Heart, pulses, JVD, edema, etc.
      "lungs": "",        // Respiratory examination, breath sounds, etc.
      "abdomen": "",      // Abdominal examination, bowel sounds, etc.
      "musculoskeletal": "", // Musculoskeletal examination, range of motion, etc.
      "neurologic": "",   // Neurologic examination, reflexes, sensation, etc.
      "skin": "",         // Skin examination, rashes, lesions, etc.
      "psychological": "" // Psychological examination, mood, affect, thought process, etc.
    },
    "visionOd": "",        // Vision right eye
    "visionOs": "",        // Vision left eye
    "visionOu": "",        // Vision both eyes
    "visionCorrection": "", // "With correction" | "Without correction" | ""
    "visionBlurry": "",     // "Yes" | "No" | ""
    "visionFloaters": "",   // "Yes" | "No" | ""
    "visionPain": "",       // "Yes" | "No" | ""
    "visionLastExamDate": "" // YYYY-MM-DD format
  },
  "pointOfCare": {
    "diabetes": { 
      "fastingGlucose": "",      // Fasting blood glucose
      "randomGlucose": "",       // Random blood glucose
      "hbA1cValue": "",          // HbA1c value (e.g., "7.2")
      "hbA1cDate": "",           // HbA1c date (YYYY-MM-DD)
      "homeMonitoring": "",      // Home glucose monitoring info
      "averageReadings": "",     // Average glucose readings
      "hypoglycemiaEpisodes": "", // Hypoglycemia episodes
      "hyperglycemiaSymptoms": "", // Hyperglycemia symptoms
      "footExam": "",            // Foot exam findings
      "eyeExamDue": ""           // Eye exam due date (YYYY-MM-DD)
    },
    "hiv": "",                    // "negative" or "positive"
    "syphilis": {
      "result": "",              // "positive" or "negative"
      "reactivity": ""           // "reactive" or "non-reactive"
    }
  },
  "medications": [  // ARRAY: One entry per medication mentioned (can include linked diagnosis in notes)
    {
      "brandName": "",         // Medication name (e.g., "Metformin 500mg")
      "strength": "",          // Strength if separate
      "form": "",              // Form if separate
      "dosage": "",            // Dosage instructions (e.g., "1 tablet twice daily")
      "frequency": "",         // Frequency if separate
      "status": "Active",      // "Active" | "Inactive" | "Discontinued"
      "notes": ""              // Notes (can include linked diagnosis if mentioned)
    }
  ],
  "assessmentPlan": [  // ARRAY: One entry per diagnosis/condition with detailed plan
    {
      "assessment": "",  // Clinical assessment/diagnosis with ICD-10 (e.g., "Acute Otitis Media – New (H66.90)")
      "plan": "",        // Treatment plan summary (e.g., "Start antibiotics.")
      "medications": [   // Medications linked to this diagnosis
        {
          "brandName": "",  // Medication name (e.g., "Amoxicillin 400 mg/5 mL")
          "strength": "",   // Strength if separate
          "form": "",       // Form if separate
          "dosage": "",     // Dosage (e.g., "7.5 mL")
          "frequency": ""   // Frequency (e.g., "PO BID x 10 days")
        }
      ],
      "orders": [        // Orders linked to this diagnosis
        {
          "type": "",
          "priority": "",
          "details": "",
          "status": "",
          "dateOrdered": ""
        }
      ],
      "followUp": "",    // Follow-up instructions (e.g., "PRN if no improvement in 48 hours")
      "education": "",    // Patient education (e.g., "Discussed expected course and return precautions.")
      "coordination": "" // Care coordination (e.g., "None")
    }
  ],
  "vaccines": [  // ARRAY: One entry per vaccine mentioned
    {
      "name": "",        // Vaccine name (e.g., "COVID-19", "Flu")
      "date": "",        // Date given (YYYY-MM-DD) - Convert relative dates like "a month ago" to actual date
      "dose": "",        // Dose number (e.g., "1st dose", "Booster")
      "site": "",        // Injection site (e.g., "Left deltoid")
      "route": "",       // Route (e.g., "IM", "Subcutaneous")
      "lotNumber": "",   // Lot number if mentioned
      "manufacturer": "" // Manufacturer if mentioned
    }
  ],
  "familyHistory": [  // ARRAY: One entry per family member mentioned
    {
      "relationship": "",  // Relationship (e.g., "Father", "Mother", "Sibling")
      "status": "",        // Status (e.g., "Alive", "Deceased")
      "conditions": ""     // Medical conditions
    }
  ],
  "riskFlags": { 
    "tobaccoUse": "",         // Tobacco use status (e.g., "Never", "Former", "Current")
    "tobaccoAmount": "",      // Amount if current user (e.g., "1 pack/day")
    "alcoholUse": "",         // Alcohol use status
    "alcoholFrequency": "",   // Frequency (e.g., "Daily", "Weekly", "Occasionally")
    "housingStatus": "",      // Housing status
    "occupation": ""          // Occupation
  },
  "surgicalHistory": [  // ARRAY: One entry per surgery/procedure mentioned
    {
      "procedure": "",    // Procedure name
      "date": "",         // Date (YYYY-MM-DD) - Convert relative dates like "2 years ago" to actual date
      "site": "",         // Site/location
      "surgeon": "",      // Surgeon name if mentioned
      "outcome": "",      // Outcome/results
      "source": ""        // Source of information
    }
  ],
  "pastMedicalHistory": [  // ARRAY: One entry per condition mentioned
    {
      "condition": "",      // Condition name
      "status": "",         // Status (e.g., "Active", "Resolved", "Chronic")
      "diagnosedDate": "",  // Date diagnosed (YYYY-MM-DD) - Convert relative dates like "3 weeks ago" to actual date
      "impact": "",         // Impact on patient
      "icd10": "",          // ICD-10 code if mentioned
      "source": ""          // Source of information
    }
  ],
  "orders": [  // ARRAY: One entry per order/prescription/test mentioned
    {
      "type": "",        // Order type (e.g., "Lab", "Imaging", "Medication", "Referral")
      "priority": "",    // Priority (e.g., "Routine", "Urgent", "STAT")
      "details": "",     // Detailed description of the order
      "status": "",      // Status (e.g., "Ordered", "Pending", "Completed")
      "dateOrdered": ""  // Date ordered (YYYY-MM-DD)
    }
  ]
}`;

  // Build context prompt if patient context provided
  const contextPrompt = patientContext
    ? `\n\nPatient Context:\n- Allergies: ${JSON.stringify(
        patientContext.allergies || []
      )}\n- Current Medications: ${JSON.stringify(
        patientContext.meds || []
      )}\n- Past Medical History: ${JSON.stringify(patientContext.pmh || [])}`
    : "";

  // Build previous transcripts context if provided
  const previousTranscriptsContext =
    previousTranscripts && previousTranscripts.length > 0
      ? `\n\nPrevious Transcripts (for context, but new transcript takes precedence):\n${previousTranscripts
          .map((t: string, i: number) => `Previous Recording ${i + 1}:\n${t}`)
          .join("\n\n")}`
      : "";

  // Get current date for relative date calculations
  const today = new Date();
  const currentDateStr = today.toISOString().split("T")[0]; // YYYY-MM-DD format

  // Build user prompt
  const basePrompt =
    prompt ||
    `Parse this medical visit transcript into the structured JSON schema below.${contextPrompt}${previousTranscriptsContext}\n\nIMPORTANT: The NEW transcript below takes precedence over any previous transcripts. Only use previous transcripts for additional context.\n\nCURRENT DATE: ${currentDateStr} - Use this date to calculate relative dates (e.g., "a month ago" = ${currentDateStr} minus 1 month).`;

  // Combine prompts
  const combinedUserPrompt = `${basePrompt}\n\nNEW Transcript (takes precedence - extract all information from this):\n${transcript}\n\nNow extract all information from the transcript above and populate the JSON schema. Be thorough and extract ALL mentioned information including vitals, measurements, medications, diagnoses, point of care test results (diabetes, HIV, syphilis), etc.`;

  const fullPrompt = `${systemPrompt}\n\n${combinedUserPrompt}\n\nRemember: Return ONLY valid JSON with no comments, no duplicate keys, and no explanatory text. Just the raw JSON object starting with { and ending with }.`;

  if (openRouterApiKey) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        "X-Title": "Tele-Medical",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: combinedUserPrompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 16000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    if (!content) {
      throw new Error("OpenRouter returned empty response");
    }

    const parsed = parseJsonWithFallback(content);
    return parseVisitNote(parsed);
  }

  if (!replicateApiKey) {
    throw new Error(
      "Missing AI provider configuration. Set OPENROUTER_API_KEY for transcript parsing or REPLICATE_API_KEY for Replicate."
    );
  }

  const deepSeekModel = "deepseek-ai/deepseek-v3.1";

  const combinedInput = {
    prompt: fullPrompt,
    max_tokens: 3000,
    response_format: "json",
    temperature: 0.2,
  };

  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Token ${replicateApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: deepSeekModel, // Replicate will resolve the model version
      input: combinedInput,
    }),
  });

  if (!response.ok) {
    let errorMessage = `Replicate API error: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.detail || errorData.error || errorMessage;
      console.error("Replicate API error details:", errorData);
    } catch {
      const errorText = await response.text();
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  const prediction = await response.json();
  const predictionId = prediction.id;

  // Poll for completion
  let completed = false;
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes max
  const pollInterval = 5000; // 5 seconds

  while (!completed && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const statusResponse = await fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      {
        headers: {
          Authorization: `Token ${replicateApiKey}`,
        },
      }
    );

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      console.error(
        `Failed to check prediction status: ${statusResponse.status} ${statusResponse.statusText}`,
        errorText
      );
      throw new Error(
        `Failed to check prediction status: ${statusResponse.status} ${
          errorText || statusResponse.statusText
        }`
      );
    }

    const status = await statusResponse.json();

    if (status.status === "succeeded") {
      completed = true;
      let content = "";

      // Extract content from output
      const output = status.output;
      if (typeof output === "string") {
        content = output;
      } else if (Array.isArray(output)) {
        content = output.join("");
      } else {
        content = JSON.stringify(output);
      }

      if (!content) {
        throw new Error("Parsing timed out or returned empty result");
      }

      // Parse and validate JSON
      const parsed = parseJsonWithFallback(content);
      return parseVisitNote(parsed);
    } else if (status.status === "failed" || status.status === "canceled") {
      const errorDetails =
        status.error || status.logs?.join("\n") || "Unknown error";
      console.error("Replicate prediction failed:", {
        status: status.status,
        error: status.error,
        logs: status.logs,
      });
      throw new Error(`Parsing failed: ${errorDetails}`);
    }

    attempts++;
  }

  throw new Error("Parsing timed out");
}
