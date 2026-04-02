# April 1 Demo Stabilization Tracker

**Repo:** `tele-medical`  
**Sources:** [April 1 Audit.md](./April%201%20Audit.md), Atlas Telemedicine Platform Operating Document (PDF), codebase.  
**Demo target:** Thursday, April 2, 2026  

---

## Objective

Stabilize demo-critical flows: auth/role landing, patient chart navigation (no dead 404s), new visit / continue note, save/finalize, nurse–provider handoff / open notes, core chart sections, optional AI/recording smoke when env keys exist.

**Standard:** No existential workflow breaks, no embarrassing dead routes, no misleading primary labels, no silent “logged out” bursts from server session bugs.

---

## P0 items (must-address)

| ID | Issue | Owner (agent) | Status |
|----|--------|---------------|--------|
| P0-1 | `getServerSession()` global 5s cooldown → valid user seen as logged out | Agent 1 | **Fixed** |
| P0-2 | Middleware skipped auth during cooldown → false redirect to `/sign-in` | Agent 1 | **Fixed** |
| P0-3 | Sidebar “Log History” → `/log-history` (404) | Agent 2 | **Fixed** (→ `/visit-history`, label “Visit Log”) |
| P0-4 | Continue note screen titled “New Visit” | Agent 3 | **Fixed** |
| P0-5 | Save Visit blocked on continue path (reviewed sections cleared) | Agent 3 | **Fixed** |
| P0-6 | Finalize/sign only checked `patient.clinicianId` → handoff edge cases | Agent 3 | **Fixed** (patient **or** visit `clinicianId`) |
| P0-7 | Demo multi-login same account invalidates session | — | **By design** (Supabase); use **separate demo users** per device |
| P0-8 | Vitals edit / PMH / orders intermittent 404 or crash | Agent 2 | **Not reproduced in code review** — session fixes may reduce; needs manual QA |
| P0-9 | Log New Visit “does nothing” | Agent 2 | **Not reproduced** — `visit-history-content.tsx` uses `<Link>`; verify overlay/JS errors in QA |

---

## P1 items

| ID | Issue | Owner | Status |
|----|--------|-------|--------|
| P1-1 | Social history occupation partial update clobbered nested fields | Agent 4 | **Fixed** (`mergeSocialHistoryPatch`) |
| P1-2 | Raw visit status strings in UI | Agent 3 / shared util | **Fixed** (`formatVisitStatusLabel` + badge styling) |
| P1-3 | Save Visit vs autosave UX confusion | Agent 3 | **Partially addressed** (continue path unblocked); new visit still requires all sections reviewed — intentional unless product changes |

---

## P2 items (defer until P0/P1 green)

- Duplicate search bars across shells  
- AI capture visual prominence  
- Sidebar hierarchy / New Patient CTA placement  
- Unified patient dashboard during note entry  
- Input field spacing  

---

## Agent assignments and outputs

### Agent 0 — Release Lead / Integration Controller

- Created this tracker; sequenced Agent 1 → 2 → 3 → 4 before status/AI docs.  
- **Files touched (integration):** this file, [April 2 Demo Runbook.md](./April%202%20Demo%20Runbook.md), [Known Risks to Avoid in Demo.md](./Known%20Risks%20to%20Avoid%20in%20Demo.md).

### Agent 1 — Session / Auth Stabilization

**Root cause:** `getServerSession` returned `null` for **all** callers for 5s after any rate-limit signal. Middleware also **skipped** `getUser()` for 10s, leaving `isAuthenticated === false` and redirecting protected routes to `/sign-in`.

**Fix applied:**

- [`app/_lib/supabase/server.ts`](app/_lib/supabase/server.ts): Removed global cooldown block. On 429, return `null` for that request only; throttle log line (~10s).  
- [`middleware.ts`](middleware.ts): Removed cooldown skip; always call `getUser()`. On 429, return `response` early (no forced sign-in redirect).

**Files changed:** `app/_lib/supabase/server.ts`, `middleware.ts`

**Validation:** Rapid navigation across patient pages and `/open-notes` should not bounce to `/sign-in` without a real logout. Re-test under Supabase rate limits if demos spike traffic.

**Residual risk:** A single request during 429 may still see `getServerSession() === null` in RSC; less likely now that we do not amplify with a global cooldown. `getCurrentUser` unchanged — consider converging helpers in a later refactor.

---

### Agent 2 — Routing / Navigation / 404 Recovery

**Routes audited (all have `page.tsx` under `app/(app)/patients/[id]/`):** overview, personal-details, visit-history, vitals, allergies, medications, vaccines, family-history, social-history, surgical-history, past-medical-history, orders, documents, new-visit, send-to-waiting-room.

**Dead route fixed:** [`components/side-nav.tsx`](components/side-nav.tsx) — `log` entry `href` changed from `/log-history` to `/visit-history`; label **Visit Log** (alias for visit list per Atlas workflow).

**Files changed:** `components/side-nav.tsx`

**Remaining route risks:** Dynamic `notFound()` if patient UUID invalid — expected. Vitals/PMH 404 reports: no missing route found; suspect session or bad ID — **Agent 6** to confirm.

---

### Agent 3 — Visit Workflow Stabilization

**Root cause (Save blocked):** Loading `existingVisitId` + server note reset `reviewedSections` to `∅`, so `allSectionsReviewed` stayed false until user clicked every stepper section (POC easy to miss).

**Fix:** For `existingVisitId && existingVisitData` with no Dexie draft, pre-mark **all** `getSectionsForRole` section IDs as reviewed.

**Root cause (title):** Hardcoded “New Visit”.

**Fix:** Heading uses **Continue Visit** when `existingVisitId` is set ([`new-visit-form.tsx`](app/_components/visit/new-visit-form.tsx)).

**Handoff / signing:** [`finalizeVisitAction`](app/_actions/visits.ts) now allows finalize when `patient.clinicianId === user.id` **or** `visit.clinicianId === user.id`.

**Files changed:** `app/_components/visit/new-visit-form.tsx`, `app/_actions/visits.ts`, `app/_lib/utils/visit-status-label.ts`, `app/(app)/patients/[id]/visit-history/visit-history-content.tsx`, `app/(app)/open-notes/open-notes-content.tsx`

**Test script (manual):**

1. Nurse/doctor: open patient → New visit → save (new path still requires section review or use continue path for smoke).  
2. Open Notes → Continue Note → header **Continue Visit**; footer **Save Visit** enabled when online and all sections reviewed (pre-filled on continue).  
3. Doctor signs after assign: finalize succeeds when assigned on patient or visit row.

**Residual risk:** Nurse role can still call finalize in code (Atlas: only provider should sign) — product may want doctor-only finalize later.

---

### Agent 4 — Patient Data Integrity

**Fix:** [`app/_actions/social-history.ts`](app/_actions/social-history.ts) — `mergeSocialHistoryPatch` deep-merges nested objects (`occupation`, `tobacco`, `alcohol`, `livingSituation`, `lifestyle`, `psychosocial`, `sexualHealth`); arrays `otherSubstances` still replace when provided.

**Files changed:** `app/_actions/social-history.ts`

**Residual risk:** Other `_actions` with JSON merge not all audited; PMH CRUD uses dedicated patterns — spot-check if bugs reported.

---

### Agent 5 — Recording / AI / Infrastructure Smoke

**Env requirements (from audit):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `REPLICATE_API_KEY` (transcribe), `OPENROUTER_API_KEY` (parse), optional `STORAGE_BUCKET`, Twilio vars for video.

**Smoke (when keys present):**

1. `GET /api/health-check`  
2. New visit → record or upload → chunk/finalize APIs if used  
3. `POST /api/ai/transcribe` with valid `audioPath`  
4. Parse route after transcript  

**If keys missing:** Treat AI/recording as **demo-optional**; narrate structured note + manual entry.

**Recommendation:** See [April 2 Demo Runbook.md](./April%202%20Demo%20Runbook.md).

---

### Agent 6 — QA / Regression / Demo Script

See **Final Demo Readiness Assessment** below and **Repro/test checklist**.

---

## Files touched (summary)

| File | Change |
|------|--------|
| `app/_lib/supabase/server.ts` | Remove global session cooldown |
| `middleware.ts` | Remove auth skip window; always verify session |
| `components/side-nav.tsx` | Visit Log → `/visit-history` |
| `app/_components/visit/new-visit-form.tsx` | Continue title; pre-review sections on continue |
| `app/_actions/visits.ts` | Finalize if patient or visit clinician matches |
| `app/_actions/social-history.ts` | Nested merge for social history |
| `app/_lib/utils/visit-status-label.ts` | **New** — human-readable status |
| `app/(app)/patients/[id]/visit-history/visit-history-content.tsx` | Status label + badge variants |
| `app/(app)/open-notes/open-notes-content.tsx` | Status label + badge variants |

---

## Repro / test checklist

- [ ] Sign in doctor → `/waiting-room`; nurse → `/patients`  
- [ ] Rapid click 15+ internal links → no spurious `/sign-in`  
- [ ] Patient chart → **Visit Log** (sidebar) → loads visit list (not 404)  
- [ ] Open Notes → Continue Note → **Continue Visit**; Save enabled (online)  
- [ ] Social history → occupation tab → partial save → reload → other occupation fields preserved  
- [ ] Visit history / Open Notes → status chips read as plain English  
- [ ] Finalize visit as assigned doctor after handoff  
- [ ] (Optional) Transcribe/parse with keys  

---

## Remaining risks

- Same-account multi-device demo → use **two accounts** (e.g. demodoctor / demonurse per Atlas PDF).  
- Single-request 429 on `getUser` may still flash empty session on one navigation.  
- `Log New Visit` unresponsive: needs console/network repro if it persists.  
- Documents page errors (Atlas bug list): not addressed in this pass — verify separately.  
- Orders “New Order” inert: P1 from Atlas — not fixed here.  

---

## Recommendation for demo readiness

**Demo ready with cautions:** Core navigation, continue/save path, session stability, and social merge are improved. Run **Agent 6** checklist on staging with real Supabase + DB before live demo. Prepare **fallback narrative** if AI keys absent.

---

## Final Demo Readiness Assessment

**Verdict:** **Demo ready with cautions** (pending 30–60 min QA on your deployed environment).

**Known risks to avoid in demo:** See [Known Risks to Avoid in Demo.md](./Known%20Risks%20to%20Avoid%20in%20Demo.md).

**Recommended demo path:** See [April 2 Demo Runbook.md](./April%202%20Demo%20Runbook.md).

---

## Rollback notes

- Revert commits touching `server.ts` / `middleware.ts` if auth behaves worse in production (unlikely).  
- Visit form: reverting continue-path `reviewedSections` change restores strict section gate.  

---

*Update this tracker as QA completes.*
