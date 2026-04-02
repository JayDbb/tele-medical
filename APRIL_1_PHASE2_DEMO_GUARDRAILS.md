# April 1 Phase 2 Demo Guardrails

## Current State

These guardrails are written from the **live production validation** plus the **targeted repo fixes now present locally**.

**Important:** on the **current live deployment**, there is **no approved end-to-end presenter path**. Use this document to avoid false confidence and to define the exact smoke path after redeploy.

## Approved Accounts

- Nurse: `demonurse@telehealth.com`
- Doctor: `demodoctor@telehealth.com`
- Use **isolated sessions** only. Separate browsers or clean browser contexts are mandatory.

## Approved Patient / Visit Records

- **Validation record:** `Cora Mercer` (`/patients/cdfc2a9e-680b-406b-85b9-82d3d7274c66`)
- This record is **not yet approved for the live demo** because the full lifecycle did not validate successfully on current production.
- Do **not** claim any patient/visit pair is approved until a redeployed build passes:
  1. sign in
  2. continue or assign
  3. save
  4. reopen in history
  5. finalize/sign

## Approved Route Path

### On the current live deployment

- No approved full route path from sign-in to completion.

### On the next redeployed build, rehearse this exact sequence only

1. Nurse signs in.
2. Confirm nurse lands correctly on `/patients`.
3. Open the pre-approved patient/visit pair.
4. Use a **pre-seeded continue path**, not a fresh `Log New Visit`.
5. Doctor signs in separately.
6. Confirm doctor lands correctly on `/waiting-room` or approved doctor route.
7. Use only the handoff path that passed smoke that same day.
8. Reopen from history and finalize/sign only if the smoke proved it.

## Disallowed Branches

- Current live `Sign In` -> trust role landing.
- Current live patient chart `Visit History` click.
- Current live visit history `Log New Visit`.
- Current live waiting room `Assign To Me`.
- Current live open notes `Continue Note`.
- Any unrehearsed Twilio / patient join / recording / AI parse branch.
- Any fresh new-visit flow unless Save is explicitly proven on the deployed build you are demoing.

## What Not To Click

- `Assign To Me` on current production.
- `Continue Note` on current production.
- `Log New Visit` on current production.
- `Start Recording` unless the exact call flow has been rehearsed on the same deployed build.
- Any patient join link in front of an audience unless the full waiting-room -> assign -> call path has already passed.

## Fallback Wording For Twilio / AI / Recording

- **If waiting-room or call setup is unreliable:**  
  “The live chart and clinician workflow are the priority here; video and automation are available when the network/session path is healthy, but we can continue the visit flow directly in the chart.”

- **If recording / AI is unreliable:**  
  “The structured note workflow is the primary path. Audio capture and AI assist are best-effort in this build, so we’ll continue with the clinician-authored note.”

## What Not To Say

- Do not say the workflow is “fully automated end to end” unless save/reopen/finalize was proven on the deployed build you are presenting.
- Do not promise a live recording/transcription experience.
- Do not claim waiting-room handoff is stable unless `Assign To Me` has been re-tested after redeploy.

## Exact Rehearsal Sequence For Presenter

### Before audience

1. Open separate nurse and doctor sessions.
2. Sign in both users.
3. Verify role landing is correct without manual URL edits.
4. Verify the approved patient/visit pair.
5. Verify one real continue/save/reopen/finalize cycle on the deployed build.
6. If any step fails, drop back to static walkthrough or postpone the live handoff narrative.

### In front of audience

1. Keep the demo linear.
2. Use only the rehearsed patient/visit pair.
3. Avoid unrehearsed clicks, tabs, filters, or alternate branches.
4. If Twilio or AI is not part of the smoke-passed path, do not surface it.
