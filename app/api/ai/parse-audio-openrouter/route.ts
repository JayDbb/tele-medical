import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/app/_lib/auth/get-current-user";
import { transcribeAudio } from "@/app/_lib/ai/transcribe";

/**
 * Parse audio file using Replicate Whisper for transcription, then OpenRouter with OpenAI GPT-O1-120B
 * POST /api/ai/parse-audio-openrouter
 * Body: { audioPath: string, patientContext?: object, prompt?: string, previousTranscripts?: string[] }
 * 
 * Note: Audio is compressed to MP3 in the frontend before upload for faster transfer.
 * This endpoint uses Replicate Whisper for transcription, then GPT-O1-120B for parsing.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify auth
    await requireUser(["doctor", "nurse"]);

    const body = await request.json();
    const { audioPath, patientContext, prompt, previousTranscripts } = body;

    if (!audioPath || typeof audioPath !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid audioPath" },
        { status: 400 }
      );
    }

    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterApiKey) {
      throw new Error("Missing OPENROUTER_API_KEY environment variable");
    }

    // Step 1: Transcribe audio using Replicate Whisper
    console.log("Starting transcription with Replicate Whisper...");
    let transcript: string;
    try {
      const transcriptionResult = await transcribeAudio(audioPath);
      transcript = transcriptionResult.text || transcriptionResult.rawText || "";
      
      if (!transcript || transcript.trim().length === 0) {
        throw new Error("Transcription returned empty result");
      }
      
      console.log("Transcription completed:", transcript.substring(0, 100) + "...");
    } catch (error) {
      console.error("Transcription error:", error);
      throw new Error(
        error instanceof Error
          ? `Transcription failed: ${error.message}`
          : "Failed to transcribe audio"
      );
    }
    
    // Build the system prompt (same as parse-visit.ts)
    const systemPrompt = `You are a medical assistant that extracts structured visit note data from audio recordings. 
Return ONLY valid JSON matching this exact schema. Never omit required fields - use empty strings, false, or empty arrays for missing data.

CRITICAL ANTI-HALLUCINATION RULES:
1. Extract ONLY information that is EXPLICITLY stated in the audio recording
2. If information is NOT mentioned in the audio, use empty string "", false, or empty array []
3. DO NOT infer, assume, or guess any values - only extract what you actually hear
4. DO NOT use example values from this prompt - they are format examples only
5. DO NOT add medications, diagnoses, vitals, or any data that wasn't mentioned
6. When in doubt, use empty string "", false, or empty array []
7. Verify each piece of information against the audio before including it
8. If the audio is unclear or doesn't mention something, leave it empty

CRITICAL: DO NOT USE EXAMPLE VALUES FROM THIS PROMPT. 
- The examples below show FORMAT and STRUCTURE only - they are NOT real data
- Extract ONLY information that is explicitly mentioned in the actual audio recording
- Never include example values like "120/80", "72", "Metformin", "chest pain", "diabetes", etc. unless the audio actually says them
- If the audio does not mention a value, use empty string "", false, or empty array []
- DO NOT copy any numbers, names, medications, or diagnoses from the examples below
- DO NOT make up or infer information that wasn't stated

CRITICAL JSON FORMATTING RULES:
- Return ONLY valid JSON - no comments, no explanations, no markdown code blocks
- Do NOT include // comments in the JSON
- Do NOT include duplicate keys (each key must appear only once)
- Do NOT wrap the JSON in markdown code blocks or add explanatory text
- Return the raw JSON object only, starting with { and ending with }

CRITICAL EXTRACTION RULES:
1. EXTRACT ONLY INFORMATION that is EXPLICITLY mentioned in the audio recording
2. DO NOT include example values from the prompt - only extract what you actually hear
3. DO NOT infer, assume, or guess - only extract what is explicitly stated
4. If the audio mentions "blood pressure of 180/90", extract it as "bp": "180/90" - but ONLY if it's actually said
5. If the audio mentions "heart rate of 100", extract it as "hr": "100" - but ONLY if it's actually said
6. If the audio mentions "7 feet tall", convert to cm: 7 * 30.48 = 213.36, extract as "height": "213.36" - but ONLY if it's actually said
7. If the audio mentions weight, extract as pounds (numeric only, no "lbs" text) - but ONLY if it's actually said
8. If the audio mentions medications, create an array entry for EACH medication - but ONLY if medications are actually mentioned
9. If the audio mentions conditions, diagnoses, or complaints, extract them - but ONLY if they're actually mentioned
10. Extract measurements, vitals, and any numerical values mentioned - but ONLY if they're actually mentioned
11. If information is NOT mentioned in the audio, use empty strings "", false, or empty arrays [] - NEVER use example values
12. When uncertain if something was mentioned, default to empty string "", false, or empty array []
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
  * Example: "5'10\\"" = (5*30.48) + (10*2.54) = 152.4 + 25.4 = 177.8 cm → "177.8"
  * Example: "70 inches" = 70*2.54 = 177.8 cm → "177.8"

EXAMPLE FORMATS (STRUCTURE ONLY - DO NOT COPY THESE VALUES):
The following examples show the JSON STRUCTURE and FORMAT only. These are PLACEHOLDERS, not real data. 
Extract ONLY information that is actually mentioned in the audio recording.

Example format structure (DO NOT use these placeholder values):
- If audio mentions height/weight/vitals → Format: height: "{value}", weight: "{value}", bp: "{value}", hr: "{value}"
- If audio mentions medications → Format: medications: [{"brandName": "{medication name}", "dosage": "{dosage}", ...}]
- If audio mentions test results → Format: pointOfCare.hiv: "{result}" or pointOfCare.syphilis: {"result": "{result}", "reactivity": "{reactivity}"}
- If audio mentions complaints → Format: subjective.chiefComplaint: "{complaint text}"
- If audio mentions diagnoses → Format: assessmentPlan: [{"assessment": "{diagnosis}", "plan": "{plan}", ...}]

CRITICAL REMINDER: 
- Replace {value}, {medication name}, {dosage}, {result}, {complaint text}, {diagnosis}, {plan} with ACTUAL values from the audio
- If the audio does NOT mention something, use empty string "", false, or empty array []
- DO NOT use placeholder values like "120/80", "72", "Metformin", "chest pain", "diabetes" - these are just format examples
- Only extract what you actually hear in the audio recording

IMPORTANT INSTRUCTIONS:
- Extract ONLY information that is EXPLICITLY mentioned in the audio recording
- DO NOT infer, assume, or guess any information
- If something is NOT mentioned in the audio, use empty string "", false, or empty array []
- Extract medications ONLY if they are actually mentioned in the audio
- Extract vaccines ONLY if they are actually mentioned in the audio
- Extract family history ONLY if it is actually mentioned in the audio
- Extract surgical history ONLY if it is actually mentioned in the audio
- Extract past medical history ONLY if it is actually mentioned in the audio
- Extract orders ONLY if they are actually mentioned in the audio
- Extract point of care tests ONLY if they are actually mentioned in the audio
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
  Example format structure (DO NOT use these placeholder values): 
  [{"assessment": "{diagnosis with ICD-10 if mentioned}", "plan": "{treatment plan}", "medications": [{"brandName": "{medication name}", "dosage": "{dosage}", "frequency": "{frequency}"}], "orders": [], "followUp": "{follow-up instructions}", "education": "{patient education}", "coordination": "{care coordination}"}]
  → This shows the STRUCTURE only. Replace placeholders with ACTUAL values from the audio. Extract ONLY diagnoses, medications, and plans that are actually mentioned in the audio.
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
  "bp": "",              // Blood pressure - ONLY if mentioned in audio (format: "{systolic}/{diastolic}")
  "hr": "",              // Heart rate - ONLY if mentioned in audio (format: "{number}")
  "temp": "",            // Temperature - ONLY if mentioned in audio (format: "{number}")
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

    // Build user prompt with transcript
    const basePrompt =
      prompt ||
      `Extract structured visit note data from the following medical visit transcript into the JSON schema below.${contextPrompt}${previousTranscriptsContext}\n\nIMPORTANT: The NEW transcript takes precedence over any previous transcripts. Only use previous transcripts for additional context.\n\nCURRENT DATE: ${currentDateStr} - Use this date to calculate relative dates (e.g., "a month ago" = ${currentDateStr} minus 1 month).\n\nCRITICAL: Extract ONLY information that is EXPLICITLY stated in the transcript. Do NOT infer, assume, or guess. If information is not mentioned, use empty string "", false, or empty array []. Only extract what is actually written in the transcript.`;

    const combinedUserPrompt = `${basePrompt}\n\nTRANSCRIPT:\n${transcript}\n\nNow extract the structured visit note data from the transcript above. Extract ONLY information that is EXPLICITLY stated in the transcript. Do NOT infer, assume, or guess. If something is not mentioned, use empty string "", false, or empty array []. Only extract what is actually written - nothing more, nothing less.`;

    const openRouterRequest = {
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
      temperature: 0.1, // Lower temperature to reduce hallucination
      max_tokens: 16000, // Increased for large visit notes with full schema
    };

    // Call OpenRouter API
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        "X-Title": "Tele-Medical",
      },
      body: JSON.stringify(openRouterRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenRouter API error:", {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      throw new Error(
        `OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const result = await response.json();
    
    // Extract the JSON content from the response
    let content = "";
    if (result.choices && result.choices[0] && result.choices[0].message) {
      content = result.choices[0].message.content || "";
    }

    if (!content) {
      throw new Error("OpenRouter returned empty response");
    }

    // Check if response was truncated
    const finishReason = result.choices?.[0]?.finish_reason;
    if (finishReason === "length") {
      console.warn("Response was truncated due to token limit. Consider increasing max_tokens.");
    }

    // Extract JSON from response (may be wrapped in markdown code blocks)
    let jsonContent = content.trim();
    
    // Remove markdown code blocks if present
    const jsonBlockMatch = jsonContent.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonBlockMatch) {
      jsonContent = jsonBlockMatch[1];
    } else {
      // Try to find JSON object in the content
      const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonContent = jsonMatch[0];
      }
    }
    
    // Try to fix incomplete JSON if it was truncated
    if (!jsonContent.endsWith("}") && !jsonContent.endsWith("]")) {
      // Count open braces/brackets and try to close them
      const openBraces = (jsonContent.match(/{/g) || []).length;
      const closeBraces = (jsonContent.match(/}/g) || []).length;
      const openBrackets = (jsonContent.match(/\[/g) || []).length;
      const closeBrackets = (jsonContent.match(/\]/g) || []).length;
      
      // If we're in the middle of a string, try to close it
      if (jsonContent.match(/"[^"]*$/)) {
        jsonContent += '"';
      }
      
      // Close any open arrays
      for (let i = 0; i < openBrackets - closeBrackets; i++) {
        jsonContent += "]";
      }
      
      // Close any open objects
      for (let i = 0; i < openBraces - closeBraces; i++) {
        jsonContent += "}";
      }
      
      console.warn("Attempted to fix incomplete JSON response");
    }

    // Parse the JSON response
    let parsed;
    try {
      parsed = JSON.parse(jsonContent);
    } catch (parseError) {
      console.error("Failed to parse JSON response:", {
        content: content.substring(0, 500), // Log first 500 chars
        contentLength: content.length,
        finishReason,
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      throw new Error(
        `Failed to parse JSON response from OpenRouter${finishReason === "length" ? " (response was truncated)" : ""}`
      );
    }

    // Add metadata
    parsed.aiGeneratedAt = new Date().toISOString();
    parsed.model = "openai/gpt-oss-120b";

    return NextResponse.json({
      parsed,
      transcript, // Return the transcript from Replicate Whisper
      warnings: [],
    });
  } catch (error) {
    console.error("Parse audio error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    const isTranscriptionUnavailable = errorMessage.includes(
      "Audio transcription is unavailable"
    );
    const isOpenRouterUnavailable = errorMessage.includes(
      "Missing OPENROUTER_API_KEY"
    );

    return NextResponse.json(
      {
        error: errorMessage,
        code: isTranscriptionUnavailable
          ? "TRANSCRIPTION_UNAVAILABLE"
          : isOpenRouterUnavailable
            ? "PARSING_UNAVAILABLE"
            : "INTERNAL_ERROR",
        ...(process.env.NODE_ENV === "development" && {
          details: error instanceof Error ? error.stack : String(error),
        }),
      },
      {
        status:
          isTranscriptionUnavailable || isOpenRouterUnavailable ? 503 : 500,
      }
    );
  }
}
