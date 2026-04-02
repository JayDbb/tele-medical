# April 2 Demo Runbook

**App:** `tele-medical` (Next.js)  
**Prep:** `cd tele-medical && npm install && npm run dev` — open `http://localhost:3000` (or staging URL).

## Environment

| Variable | Role |
|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Required |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required |
| `DATABASE_URL` | Required (Drizzle / server data) |
| `SUPABASE_SERVICE_ROLE_KEY` | Storage + some server paths |
| `REPLICATE_API_KEY` | Transcription (optional for demo) |
| `OPENROUTER_API_KEY` | Structured parse (optional) |
| `TWILIO_*`, `NEXT_PUBLIC_APP_URL` | Virtual visit + links |

If transcription keys are missing: demo **chart navigation, continue note, save, finalize, handoff** without live AI.

## Suggested narrative order

1. **Nurse** (or doctor): Sign in → land on `/patients` (nurse) or `/waiting-room` (doctor).  
2. **Patients** → pick a patient → **Visit Log** (sidebar) shows **Visit History** (no 404).  
3. **Log New Visit** or waiting room assign → document intake; use **Continue Visit** from **Open Notes** (doctor) for in-progress visits.  
4. Show **Save Visit** completing (online); status badges read clearly (**In Progress**, **Signed & Complete**, etc.).  
5. **Handoff:** Nurse starts; doctor assigns / opens from Open Notes; doctor **signs** — works when user matches **patient or visit** `clinicianId`.  
6. **Social history** (optional): edit one occupation field; reload — siblings not wiped.

## Smoke (5 min before audience)

- [ ] Login both roles  
- [ ] One full patient chart lap including **Visit Log**  
- [ ] Continue Note + save  
- [ ] No duplicate sign-out during fast clicks  

## If something breaks

- **Sign-in loop:** Check Supabase env; hard refresh; try incognito.  
- **404 on chart:** Confirm URL is `/patients/{uuid}/...` not stale bookmark.  
- **Cannot sign:** Ensure doctor used **assign** / is `clinicianId` on patient or visit.  

See [April 1 Demo Stabilization Tracker.md](./April%201%20Demo%20Stabilization%20Tracker.md) for fix history.
