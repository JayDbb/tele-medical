import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

loadEnvFile(path.join(projectRoot, ".env.local"));
loadEnvFile(path.join(projectRoot, ".env"));

const requiredEnvVars = [
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  ssl: "require",
  prepare: false,
  connect_timeout: 15,
  idle_timeout: 20,
});

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

const demoUsers = [
  {
    email: "doctor.demo@telemedical.local",
    password: "DemoPass123!",
    name: "Dr. Maya Thompson",
    role: "doctor",
  },
  {
    email: "nurse.demo@telemedical.local",
    password: "DemoPass123!",
    name: "Nurse Adrian Blake",
    role: "nurse",
  },
  {
    email: "patient.demo@telemedical.local",
    password: "DemoPass123!",
    name: "Alicia Grant",
    role: "patient",
  },
];

const demoPatients = [
  {
    fullName: "Alicia Grant",
    dob: "1992-07-14",
    sexAtBirth: "female",
    genderIdentity: "female",
    phone: "+1-876-555-0101",
    email: "patient.demo@telemedical.local",
    address: "12 Hope Road, Kingston",
    primaryLanguage: "English",
    preferredCommMethod: "phone",
    allergies: ["Penicillin"],
    currentMedications: ["Metformin 500mg"],
    familyHistory: ["Type 2 diabetes"],
    socialHistory: ["Non-smoker"],
    surgicalHistory: ["Appendectomy (2014)"],
    vaccines: ["Influenza (2025)"],
    clinicianEmail: "doctor.demo@telemedical.local",
  },
  {
    fullName: "Marcus Bennett",
    dob: "1985-03-22",
    sexAtBirth: "male",
    genderIdentity: "male",
    phone: "+1-876-555-0102",
    email: "marcus.bennett.demo@telemedical.local",
    address: "8 Lady Musgrave Road, Kingston",
    primaryLanguage: "English",
    preferredCommMethod: "email",
    allergies: ["Shellfish"],
    currentMedications: ["Lisinopril 10mg"],
    familyHistory: ["Hypertension"],
    socialHistory: ["Occasional alcohol use"],
    surgicalHistory: [],
    vaccines: ["COVID-19 Booster (2025)"],
    clinicianEmail: "nurse.demo@telemedical.local",
  },
];

async function main() {
  console.log("Seeding demo data...");

  const demoUserIdsByEmail = new Map();

  for (const demoUser of demoUsers) {
    const userId = await upsertDemoAuthUser(demoUser);
    demoUserIdsByEmail.set(demoUser.email, userId);
  }

  await sql`delete from users where email in ${sql(demoUsers.map((user) => user.email))}`;

  await sql`
    insert into users ${sql(
      demoUsers.map((user) => ({
        id: demoUserIdsByEmail.get(user.email),
        email: user.email,
        name: user.name,
        role: user.role,
        metadata: JSON.stringify({
          demo: true,
          seededBy: "scripts/seed.mjs",
        }),
      })),
      "id",
      "email",
      "name",
      "role",
      "metadata"
    )}
  `;

  const patientEmails = demoPatients.map((patient) => patient.email);
  await sql`delete from patients where email in ${sql(patientEmails)}`;

  const insertedPatients = [];

  for (const patient of demoPatients) {
    const patientId = randomUUID();
    const clinicianId = demoUserIdsByEmail.get(patient.clinicianEmail) ?? null;

    await sql`
      insert into patients (
        id,
        full_name,
        dob,
        sex_at_birth,
        gender_identity,
        phone,
        email,
        address,
        primary_language,
        preferred_comm_method,
        allergies,
        current_medications,
        family_history,
        social_history,
        surgical_history,
        vaccines,
        clinician_id,
        emergency_contact,
        is_assigned
      ) values (
        ${patientId},
        ${patient.fullName},
        ${patient.dob},
        ${patient.sexAtBirth},
        ${patient.genderIdentity},
        ${patient.phone},
        ${patient.email},
        ${patient.address},
        ${patient.primaryLanguage},
        ${patient.preferredCommMethod},
        ${JSON.stringify(patient.allergies)},
        ${JSON.stringify(patient.currentMedications)},
        ${JSON.stringify(patient.familyHistory)},
        ${JSON.stringify(patient.socialHistory)},
        ${JSON.stringify(patient.surgicalHistory)},
        ${JSON.stringify(patient.vaccines)},
        ${clinicianId},
        ${JSON.stringify({
          name: "Jordan Grant",
          relationship: "Sibling",
          phone: "+1-876-555-0199",
        })},
        ${true}
      )
    `;

    insertedPatients.push({
      id: patientId,
      clinicianId,
      fullName: patient.fullName,
    });
  }

  for (const patient of insertedPatients) {
    const visitId = randomUUID();

    await sql`
      insert into visits (
        id,
        patient_id,
        clinician_id,
        status,
        notes_status,
        priority,
        appointment_type,
        twilio_room_name,
        patient_join_token
      ) values (
        ${visitId},
        ${patient.id},
        ${patient.clinicianId},
        ${"in-progress"},
        ${"draft"},
        ${"routine"},
        ${"follow-up"},
        ${`demo-room-${patient.id.slice(0, 8)}`},
        ${`demo-token-${patient.id.slice(0, 8)}`}
      )
    `;

    await sql`
      insert into notes (
        id,
        visit_id,
        content,
        status,
        author_id,
        note,
        audit
      ) values (
        ${randomUUID()},
        ${visitId},
        ${`Demo visit notes for ${patient.fullName}. Symptoms stable, continue monitoring.`},
        ${"draft"},
        ${patient.clinicianId},
        ${JSON.stringify({
          subjective: "Patient reports mild fatigue and good medication adherence.",
          objective: "Vitals stable. No acute distress.",
          assessment: "Chronic condition remains controlled.",
          plan: "Continue current medications and review in two weeks.",
        })},
        ${JSON.stringify({
          source: "seed-script",
        })}
      )
    `;

    await sql`
      insert into transcripts (
        id,
        visit_id,
        raw_text,
        text,
        provider,
        provider_metadata
      ) values (
        ${randomUUID()},
        ${visitId},
        ${`Transcript placeholder for ${patient.fullName}`},
        ${`Follow-up consultation transcript for ${patient.fullName}`},
        ${"seed-script"},
        ${JSON.stringify({
          demo: true,
        })}
      )
    `;

    await sql`
      insert into documents (
        id,
        patient_id,
        visit_id,
        filename,
        mime_type,
        size,
        storage_url,
        uploaded_by
      ) values (
        ${randomUUID()},
        ${patient.id},
        ${visitId},
        ${"demo-lab-summary.pdf"},
        ${"application/pdf"},
        ${"24576"},
        ${`seed://documents/${patient.id}/demo-lab-summary.pdf`},
        ${patient.clinicianId}
      )
    `;
  }

  console.log("");
  console.log("Demo users created:");
  for (const user of demoUsers) {
    console.log(`- ${user.role}: ${user.email} / ${user.password}`);
  }
  console.log("");
  console.log(`Patients seeded: ${insertedPatients.length}`);
}

async function upsertDemoAuthUser(user) {
  const existingUsers = await listAuthUsersByEmail(user.email);

  for (const existingUser of existingUsers) {
    await supabaseAdmin.auth.admin.deleteUser(existingUser.id);
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: {
      name: user.name,
      role: user.role,
      demo: true,
      seededBy: "scripts/seed.mjs",
    },
  });

  if (error || !data.user) {
    throw new Error(error?.message || `Failed to create auth user for ${user.email}`);
  }

  return data.user.id;
}

async function listAuthUsersByEmail(email) {
  const matches = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw new Error(error.message || "Failed to list auth users");
    }

    const users = data.users ?? [];
    matches.push(...users.filter((user) => user.email === email));

    if (users.length < 200) {
      break;
    }

    page += 1;
  }

  return matches;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    let value = trimmedLine.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
