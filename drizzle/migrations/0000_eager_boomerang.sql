CREATE TYPE "public"."availability_status" AS ENUM('offline', 'online', 'away', 'busy');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" text NOT NULL,
	"storage_url" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"note" jsonb,
	"content" text,
	"status" text DEFAULT 'draft',
	"finalized_by" uuid,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"author_id" uuid,
	"audit" jsonb
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"dob" date,
	"sex_at_birth" text,
	"gender_identity" text,
	"phone" text,
	"email" text,
	"address" text,
	"primary_language" text,
	"preferred_comm_method" text,
	"allergies" jsonb,
	"current_medications" jsonb,
	"past_medical_history" jsonb,
	"clinician_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"vaccines" jsonb,
	"family_history" jsonb,
	"vitals" jsonb,
	"social_history" jsonb,
	"surgical_history" jsonb,
	"emergency_contact" jsonb,
	"is_assigned" boolean,
	"consent_signature_url" text
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"raw_text" text,
	"text" text,
	"segments" jsonb,
	"provider" text,
	"provider_metadata" jsonb,
	"status" text DEFAULT 'completed',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text DEFAULT 'patient',
	"avatar_url" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"availability" "availability_status" DEFAULT 'offline' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"availability_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"clinician_id" uuid,
	"audio_url" text,
	"status" text DEFAULT 'draft',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes_status" text DEFAULT 'draft',
	"notes_finalized_by" uuid,
	"notes_finalized_at" timestamp with time zone,
	"priority" text,
	"appointment_type" text,
	"twilio_room_name" text,
	"twilio_room_sid" text,
	"patient_join_token" text
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_documents_patient_id" ON "documents" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_documents_visit_id" ON "documents" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "idx_notes_visit_id" ON "notes" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "idx_transcripts_visit_id" ON "transcripts" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "idx_visits_patient_id" ON "visits" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_visits_clinician_id" ON "visits" USING btree ("clinician_id");