import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Enum for user availability status.
 * NOTE: This must match the database enum exactly.
 * Values: 'offline', 'online', 'away', 'busy'
 */
export const availabilityStatusEnum = pgEnum("availability_status", [
  "offline",
  "online",
  "away",
  "busy",
]);

/**
 * Patients table
 */
export const patients = pgTable("patients", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  dob: date("dob"),
  sexAtBirth: text("sex_at_birth"),
  genderIdentity: text("gender_identity"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  primaryLanguage: text("primary_language"),
  preferredCommMethod: text("preferred_comm_method"),
  allergies: jsonb("allergies"),
  currentMedications: jsonb("current_medications"),
  pastMedicalHistory: jsonb("past_medical_history"),
  clinicianId: uuid("clinician_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  vaccines: jsonb("vaccines"),
  familyHistory: jsonb("family_history"),
  vitals: jsonb("vitals"),
  socialHistory: jsonb("social_history"),
  surgicalHistory: jsonb("surgical_history"),
  emergencyContact: jsonb("emergency_contact"),
  isAssigned: boolean("is_assigned"),
  consentSignatureUrl: text("consent_signature_url"),
});

/**
 * Visits table
 */
export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    clinicianId: uuid("clinician_id"),
    audioUrl: text("audio_url"),
    status: text("status").default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    notesStatus: text("notes_status").default("draft"),
    notesFinalizedBy: uuid("notes_finalized_by"),
    notesFinalizedAt: timestamp("notes_finalized_at", { withTimezone: true }),
    priority: text("priority"),
    appointmentType: text("appointment_type"),
    twilioRoomName: text("twilio_room_name"),
    twilioRoomSid: text("twilio_room_sid"),
    patientJoinToken: text("patient_join_token"),
  },
  (table) => ({
    patientIdIdx: index("idx_visits_patient_id").on(table.patientId),
    clinicianIdIdx: index("idx_visits_clinician_id").on(table.clinicianId),
  })
);

/**
 * Notes table
 */
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    note: jsonb("note"),
    content: text("content"),
    status: text("status").default("draft"),
    finalizedBy: uuid("finalized_by"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    authorId: uuid("author_id"),
    audit: jsonb("audit"),
  },
  (table) => ({
    visitIdIdx: index("idx_notes_visit_id").on(table.visitId),
  })
);

/**
 * Transcripts table
 */
export const transcripts = pgTable(
  "transcripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    rawText: text("raw_text"),
    text: text("text"),
    segments: jsonb("segments"),
    provider: text("provider"),
    providerMetadata: jsonb("provider_metadata"),
    status: text("status").default("completed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    visitIdIdx: index("idx_transcripts_visit_id").on(table.visitId),
  })
);

/**
 * Users table
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name"),
  role: text("role").default("patient"),
  avatarUrl: text("avatar_url"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  availability: availabilityStatusEnum("availability")
    .notNull()
    .default("offline"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  availabilityUpdatedAt: timestamp("availability_updated_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
});

/**
 * Drizzle relations
 */
export const patientsRelations = relations(patients, ({ many }) => ({
  visits: many(visits),
}));

export const visitsRelations = relations(visits, ({ one, many }) => ({
  patient: one(patients, {
    fields: [visits.patientId],
    references: [patients.id],
  }),
  notes: many(notes),
  transcripts: many(transcripts),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  visit: one(visits, {
    fields: [notes.visitId],
    references: [visits.id],
  }),
}));

export const transcriptsRelations = relations(transcripts, ({ one }) => ({
  visit: one(visits, {
    fields: [transcripts.visitId],
    references: [visits.id],
  }),
}));

/**
 * Documents table
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").references(() => visits.id, {
      onDelete: "cascade",
    }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: text("size").notNull(), // Store as string to handle large numbers
    storageUrl: text("storage_url").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    uploadedBy: uuid("uploaded_by"), // References users.id
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    patientIdIdx: index("idx_documents_patient_id").on(table.patientId),
    visitIdIdx: index("idx_documents_visit_id").on(table.visitId),
  })
);

export const documentsRelations = relations(documents, ({ one }) => ({
  patient: one(patients, {
    fields: [documents.patientId],
    references: [patients.id],
  }),
  visit: one(visits, {
    fields: [documents.visitId],
    references: [visits.id],
  }),
}));
