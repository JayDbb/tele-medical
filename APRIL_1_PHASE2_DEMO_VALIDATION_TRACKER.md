# April 1 Phase 2 Demo Validation Tracker

**Repo:** `tele-medical`  
**Live target tested:** `https://tele-medical.vercel.app/sign-in?redirect=%2F`  
**Validation window:** April 1, 2026, ~19:58 UTC  
**Evidence bundle:** `phase2_artifacts/phase2-demo-validation-report.json`

## Workflow Map

| Workflow | Intended route path | Validation result |
|---|---|---|
| Nurse sign-in | `/sign-in` -> `/patients` | Failed on current prod: lands on `/` |
| Doctor sign-in | `/sign-in` -> `/waiting-room` | Failed on current prod: lands on `/` |
| Nurse patient chart | `/patients` -> `/patients/[id]` | Pass via direct route after login |
| Nurse visit history | `/patients/[id]` -> `/patients/[id]/visit-history` | Sidebar click failed; direct route pass |
| Nurse new visit | `/patients/[id]/visit-history` -> `/patients/[id]/new-visit` | `Log New Visit` click failed; direct route pass |
| Nurse save | `/patients/[id]/new-visit` | Failed for tested record: Save disabled |
| Doctor waiting room | `/waiting-room` | Pass via direct route after login |
| Doctor assign from waiting room | `/waiting-room` -> `/patients/[id]/new-visit?...` | Failed: button stuck on loading / fetch error |
| Doctor open notes fallback | `/open-notes` | Page loads, `Continue Note` visible |
| Doctor continue note | `/open-notes` -> `/patients/[id]/new-visit?visitId=...` | Failed: click did not navigate |
| History / reopen / finalize / persistence | history detail routes | Not proven end-to-end on current prod |
| Social history merge | patient social history route | Not behaviorally proven due earlier blockers |
| Twilio / recording path | waiting-room -> assign -> call -> finalize | Not behaviorally reachable; treat as unproven |

## Tested Record / Sessions

- **Nurse account:** `demonurse@telehealth.com`
- **Doctor account:** `demodoctor@telehealth.com`
- **Isolated sessions:** yes
- **Patient used for cross-role attempt:** `Cora Mercer`
- **Patient route used:** `/patients/cdfc2a9e-680b-406b-85b9-82d3d7274c66`
- **Visit id proven in UI:** none; `Log New Visit` never client-navigated on current prod

## Role-by-Role Validation Grid

### Nurse Path

| Step | Starting URL | Action | Expected | Actual | Verdict | Evidence |
|---|---|---|---|---|---|---|
| N1 | `/sign-in?redirect=%2F` | Sign in | land on `/patients` | landed on `/` | **FAIL / P0** | `phase2_artifacts/1775073517592-nurse-login.png` |
| N2 | `/` | Direct-load `/patients` | patients list visible | `/patients` rendered successfully | PASS | `phase2_artifacts/1775073519143-nurse-direct-landing-check.png` |
| N3 | `/patients` | Open `Cora Mercer` | patient chart visible | patient chart loaded | PASS | `phase2_artifacts/1775073521324-nurse-patient-chart.png` |
| N4 | patient chart | Click `Visit History` | `/visit-history` route opens | stayed on patient overview | **FAIL / P0** | `phase2_artifacts/1775073521397-nurse-visit-history.png` |
| N5 | direct route | Load `/patients/.../visit-history` | visit history opens | direct route works | PASS | `phase2_artifacts/1775073523623-nurse-visit-history-direct.png` |
| N6 | visit history | Click `Log New Visit` | `/new-visit` route opens | stayed on visit history | **FAIL / P0** | `phase2_artifacts/1775073523713-nurse-visit-form.png` |
| N7 | direct route | Load `/patients/.../new-visit` | visit form opens | route renders | PASS | `phase2_artifacts/1775073526111-nurse-visit-form-direct.png` |
| N8 | new visit | Edit note content | clear editable note field visible | no visible textarea; only structured form | **FAIL / P1** | `phase2_artifacts/1775073526173-nurse-no-textarea.png` |
| N9 | new visit | Save visit | save available for realistic demo path | Save button visible but disabled | **FAIL / P0** | `phase2_artifacts/1775073526215-nurse-save-disabled.png` |

### Doctor Path

| Step | Starting URL | Action | Expected | Actual | Verdict | Evidence |
|---|---|---|---|---|---|---|
| D1 | `/sign-in?redirect=%2F` | Sign in | land on `/waiting-room` | landed on `/` | **FAIL / P0** | `phase2_artifacts/1775073530206-doctor-login.png` |
| D2 | `/` | Direct-load `/waiting-room` | waiting room visible | `/waiting-room` rendered successfully | PASS | `phase2_artifacts/1775073532032-doctor-direct-landing-check.png` |
| D3 | `/waiting-room` | Confirm `Cora Mercer` visible | intended handoff patient visible | patient + `Assign To Me` button visible | PASS | `phase2_artifacts/1775073532577-doctor-waiting-room-patient-check.png` |
| D4 | `/waiting-room` | Click `Assign To Me` | route into patient visit workflow | stayed on `/waiting-room`; loading/fetch failure | **FAIL / P0** | `phase2_artifacts/1775073532648-doctor-assigned-visit.png` |
| D5 | `/waiting-room` | Fallback to `/open-notes` | at least one continuation path visible | page opened; `Continue Note` visible | PASS | `phase2_artifacts/1775073534194-doctor-open-notes-fallback.png` |
| D6 | `/open-notes` | Click `Continue Note` | route into editable visit | stayed on `/open-notes` | **FAIL / P0** | `phase2_artifacts/1775073534265-doctor-open-notes-continue.png` |

## Session / Auth Observations

- Authentication itself succeeded for both demo users; protected role pages were accessible by direct URL after login.
- The **post-login landing decision is wrong** on current production. Both roles land on `/` instead of role home.
- This is a **client redirect bug**, not a total session failure, because direct `/patients` and `/waiting-room` access worked immediately afterward.

## Route / UI Observations

- Patient list and waiting room render, but multiple client-driven actions did not transition routes.
- Proven dead UI actions on current production:
  - patient chart `Visit History`
  - visit history `Log New Visit`
  - waiting room `Assign To Me`
  - open notes `Continue Note`
- Direct route loads work where tested, which strongly suggests a client hydration/navigation problem rather than missing pages.

## Persistence Observations

- No end-to-end save succeeded on current production during this pass.
- No finalize/sign completed on current production during this pass.
- No history reopen path was behaviorally proven beyond direct route rendering.
- Social history merge behavior was **not** live-validated because the workflow never reached a stable save/reopen cycle.

## Console / Runtime Observations

- Repeated runtime hydration errors were captured:
  - `/patients`: `Minified React error #418`
  - `/patients/[id]/visit-history`: `Minified React error #418`
  - `/open-notes`: `Minified React error #418`
- Waiting-room assignment also logged:
  - `Error assigning visit: TypeError: Failed to fetch`
- Sign-in page also emitted 404s for `sign-up?_rsc=...` and `reset-password?_rsc=...`; these did not appear to be the primary blocker.

## Confirmed Blockers

1. **Role landing broken after sign-in** on current production.
2. **Client navigation broken on demo-critical screens** (`Visit History`, `Log New Visit`, `Continue Note`).
3. **Waiting-room assignment broken** (`Assign To Me` stays loading / fetch fails).
4. **No proven save/finalize persistence path** on current production.

## Deferred / Non-Blockers

- Fresh new-visit save being disabled on a clean form is likely workflow gating, not necessarily a product bug, but it is unsafe for a short demo unless a pre-seeded continue path is used.
- Twilio / recording / AI were not behaviorally validated because handoff broke earlier; treat as unproven, not green.

## Repo Fixes Applied During Phase 2

- `app/(auth)/sign-in/sign-in-form.tsx`
  - switched post-login redirect to a **full navigation** using safe `redirect` param or `/`, so the server decides role landing from the real session/DB role
- `app/_lib/utils/format-date.ts`
  - added deterministic UTC-based `formatDate()` / `formatDateTime()` helpers
- `app/(app)/patients/patients-list.tsx`
  - switched list timestamps to shared deterministic formatter
- `app/(app)/patients/[id]/visit-history/visit-history-content.tsx`
  - switched visit-history timestamps to shared deterministic formatter

**Important:** these repo fixes were linted/typechecked locally, but **not re-validated on the live site** because production has not been redeployed from this workspace.

## Final Validation Status

**Current live production status:** **NOT VALIDATED SAFE FOR DEMO**  
**Reason:** critical role landing and clinician workflow navigation failed on the live production build.
