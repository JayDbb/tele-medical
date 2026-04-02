# April 1 Demo Stabilization Tracker

**Repo:** `tele-medical`  
**Demo target:** April 2, 2026  
**Sources:** [April 1 Audit.md](./April%201%20Audit.md), April 1 hotspot stabilization prompt, prior tracker ([April 1 Demo Stabilization Tracker.md](./April%201%20Demo%20Stabilization%20Tracker.md)).

---

## Phase 1 — Demo workflows → routes / components

| Actor / goal | Primary routes | Key components / APIs |
|--------------|----------------|------------------------|
| Sign in | `/sign-in` | `app/(auth)/sign-in/sign-in-form.tsx`, `getServerSession`, middleware |
| Patient list & search | `/patients` | `app/(app)/patients/patients-list.tsx`, patients page |
| Open chart | `/patients/[id]`, sub-routes | Side nav, patient layout |
| New / continue visit | `/patients/[id]/new-visit?visitId=…` | `new-visit-form.tsx`, `app/_actions/visits.ts` |
| Open notes (handoff) | `/open-notes` | `open-notes-content.tsx` |
| Visit history / detail | `/patients/[id]/visit-history`, `/patients/[id]/visit-history/[visitId]` | `visit-history-content.tsx`, `visit-details-content.tsx` |
| Social history | `/patients/[id]/social-history` | `social-history-content.tsx`, `app/_actions/social-history.ts` |
| Waiting room | `/waiting-room` | `waiting-room-list.tsx`, `use-waiting-room-realtime.ts` |
| Join (patient token) | `/join/[token]` | `join-call-content.tsx`, `page.tsx` |
| Provider call | `/visit/[visitId]/call` | `call-page-content.tsx`, `use-call-recorder.ts`, Twilio token API |
| Recording finalize | `POST /api/visits/[visitId]/recording/finalize` | `recording/finalize/route.ts`, storage + transcribe + parse |

---

## Phase 1 — First five P0 blockers (hotspot + audit alignment)

| # | Blocker | Agent | Status |
|---|---------|-------|--------|
| 1 | Global session cooldown / middleware skip → false logouts | Agent 2 (session) | **Fixed earlier** — see entry H-1 |
| 2 | Dead nav: Visit Log → `/log-history` 404 | Agent 2 (routes) | **Fixed earlier** — see H-2 |
| 3 | Continue visit UX + Save blocked (reviewed sections cleared) | Agent 3 (visit) | **Fixed earlier** — see H-3 |
| 4 | Finalize / handoff only `patient.clinicianId` (server + UI + recording API mismatch) | Agent 3 / 4 / 6 | **Partially fixed earlier**; **extended this pass** — H-4, **NEW-2** |
| 5 | `patients-list.tsx`: `setState` inside `useMemo` (React defect / unpredictable pagination) | Agent 2 | **Fixed this pass** — **NEW-1** |

---

## Issue log (append-only)

### H-1 — Session rate-limit amplification (inherited)

- **Severity:** P0  
- **File(s):** `app/_lib/supabase/server.ts`, `middleware.ts`  
- **Root cause:** Global cooldown after 429 made many RSC/actions see `null` session; middleware skipped `getUser()` during cooldown → redirects to `/sign-in`.  
- **Fix:** Per-request 429 handling; middleware always calls `getUser()`, returns response on 429 without forced sign-out.  
- **Validation:** Code review + architecture alignment with audit; live QA under rate limit recommended.  
- **Residual risk:** Single request during 429 may still get `null` session for that navigation.  
- **Status:** Fixed (prior pass).

### H-2 — Sidebar dead route (inherited)

- **Severity:** P0  
- **File(s):** `components/side-nav.tsx`  
- **Root cause:** `href` pointed to non-existent `/log-history`.  
- **Fix:** `/visit-history`, label “Visit Log”.  
- **Validation:** Route exists under `app/(app)/`.  
- **Residual risk:** Low.  
- **Status:** Fixed (prior pass).

### H-3 — Continue visit / Save Visit gating (inherited)

- **Severity:** P0  
- **File(s):** `app/_components/visit/new-visit-form.tsx`, related actions  
- **Root cause:** Continue path reset `reviewedSections` so save stayed blocked; title always “New Visit”.  
- **Fix:** Pre-mark sections reviewed on continue; heading **Continue Visit** when `existingVisitId`.  
- **Validation:** Manual script in prior tracker.  
- **Residual risk:** Nurse vs doctor finalize policy may still differ from product ideal.  
- **Status:** Fixed (prior pass).

### H-4 — Finalize visit clinician check (inherited)

- **Severity:** P0  
- **File(s):** `app/_actions/visits.ts`  
- **Root cause:** Finalize allowed only when `patient.clinicianId === user`.  
- **Fix:** Allow `patient.clinicianId === user.id` **or** `visit.clinicianId === user.id`.  
- **Validation:** Aligns with handoff scenarios.  
- **Residual risk:** Recording finalize route and visit-details UI were still stricter until **NEW-2**.  
- **Status:** Fixed (prior pass); **NEW-2** aligns API + UI.

### NEW-1 — Patients list: state update in `useMemo`

- **Severity:** P0  
- **File(s):** `app/(app)/patients/patients-list.tsx`  
- **Root cause:** `useMemo(() => setCurrentPage(1), [searchQuery])` runs a side effect during render; violates React rules and can cause inconsistent pagination / warnings.  
- **Fix:** Replaced with `React.useEffect(() => setCurrentPage(1), [searchQuery])`.  
- **Validation:** `npx tsc --noEmit` (pass). ESLint on file: no errors (mount effect documented with exhaustive-deps exception).  
- **Residual risk:** Low.  
- **Status:** Fixed.

### NEW-2 — Recording finalize + visit details Sign: assignee parity

- **Severity:** P0  
- **File(s):** `app/api/visits/[visitId]/recording/finalize/route.ts`, `app/(app)/patients/[id]/visit-history/[visitId]/visit-details-content.tsx`  
- **Root cause:** Finalize API and “Sign Note” button only honored `visit.clinicianId`, blocking assigned provider on patient row (and vice versa) relative to `finalizeVisitAction`.  
- **Fix:** Load `patients.clinicianId` for the visit’s patient; allow finalize when `visit.clinicianId === session.id` **or** `patient.clinicianId === session.id`. UI uses `canSignNote` with same OR rule.  
- **Validation:** `npx tsc --noEmit` (pass). ESLint: finalize route clean; visit-details still has **pre-existing** `no-explicit-any` errors elsewhere in file (not introduced by this change).  
- **Residual risk:** Visit-details rendering still relies on loose `any` in note JSON paths — deferred typing pass.  
- **Status:** Fixed (authorization / visibility).

### P1-INHERIT — Social history nested merge (inherited)

- **Severity:** P1  
- **File(s):** `app/_actions/social-history.ts`  
- **Root cause:** Partial patches could clobber nested occupation / lifestyle fields.  
- **Fix:** `mergeSocialHistoryPatch` deep-merge for known nested keys.  
- **Validation:** Code review.  
- **Residual risk:** Other JSON merge sites not all audited.  
- **Status:** Fixed (prior pass).

---

## Deferred (explicit)

- **P2 / hygiene:** Repo-wide ~331 ESLint issues; not demo blockers.  
- **visit-details-content.tsx:** 17× `no-explicit-any` + a11y/img warnings — **not** fixed in this pass (large surface; no new runtime bug identified).  
- **call-page-content / join-call-content / use-call-recorder:** Twilio `any` types and complexity — containment only if demo hits errors; no code change this pass beyond auth parity above.  
- **Offline / sync:** Only if demo script touches offline flows.  

---

## Phase 4 — Regression walkthrough (checklist)

| # | Workflow | Owner | Evidence |
|---|----------|-------|----------|
| 1 | Sign in → `/patients` | Manual | Pending full env QA |
| 2 | Search / paginate patients (search resets page) | Manual | **NEW-1** fixes render pattern |
| 3 | Continue visit → Save | Manual | Prior pass + audit |
| 4 | Sign / finalize as assigned provider (patient or visit row) | Manual | **NEW-2** + H-4 |
| 5 | Recording finalize after call (assigned provider) | Manual | **NEW-2** |
| 6 | Join token → call; waiting room | Manual | Not changed this pass |

*Note:* End-to-end verification requires running app with Supabase + DB + Twilio as configured.

---

_Last updated: April 1, 2026 (hotspot pass + tracker format)._
