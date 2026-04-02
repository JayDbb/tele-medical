# Tele-Medical

Tele-Medical is a Next.js 16 app for managing patients, visits, recordings, notes, and clinical documents with Supabase and Drizzle.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your local environment file from the template:

```bash
copy .env.local.example .env.local
```

3. Fill in the Supabase and database values in `.env.local`.

4. In Supabase Storage, create these buckets:

- `telehealth_audio`
- `tele-med-docs`

5. Run the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `DATABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`
- `STORAGE_BUCKET`
- `DOCUMENTS_STORAGE_BUCKET`

Optional:

- `REPLICATE_API_KEY`
- `OPENROUTER_API_KEY`

Default bucket values expected by the app:

- `STORAGE_BUCKET=telehealth_audio`
- `DOCUMENTS_STORAGE_BUCKET=tele-med-docs`

## Seed Demo Data

Seed the database and demo auth users with:

```bash
npm run seed
```

Demo credentials created by the seed script:

- `doctor.demo@telemedical.local` / `DemoPass123!`
- `nurse.demo@telemedical.local` / `DemoPass123!`
- `patient.demo@telemedical.local` / `DemoPass123!`

## Notes

- Audio chunks, finalized recordings, and transcription lookups now all use the same audio bucket configured by `STORAGE_BUCKET`.
- Documents and signature uploads use `DOCUMENTS_STORAGE_BUCKET`.
- `.env.local` is ignored by git. The committed setup template is `.env.local.example`.
