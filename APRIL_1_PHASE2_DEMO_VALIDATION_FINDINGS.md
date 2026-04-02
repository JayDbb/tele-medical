# April 1 Phase 2 Demo Validation Findings

## Executive Summary

The **current production deployment** at `tele-medical.vercel.app` is **not stable enough for tomorrow’s demo in its present state**.

The live validation proved that both demo accounts can authenticate, but the app fails the first presenter-facing expectation: **nurse and doctor both land on `/` instead of their role home routes**. After forcing direct route loads, the server-rendered pages themselves are reachable, but **client-side navigation breaks on demo-critical screens**. The tested flow then dead-ended before a full save -> history -> reopen -> finalize cycle could be proven.

## What Passed Cleanly

- Sign-in credentials are valid for both demo users.
- Nurse can access `/patients` **by direct URL after login**.
- Doctor can access `/waiting-room` **by direct URL after login**.
- `Cora Mercer` is visible on nurse patients list and doctor waiting room, so the dataset itself is usable.
- `/patients/[id]/visit-history` renders by direct route.
- `/patients/[id]/new-visit` renders by direct route.
- `/open-notes` renders for doctor and shows at least one `Continue Note` CTA.

## What Failed

- **Post-login landing:** nurse did not land on `/patients`; doctor did not land on `/waiting-room`.
- **Patient chart -> Visit History:** clicking `Visit History` did not navigate.
- **Visit History -> Log New Visit:** clicking `Log New Visit` did not navigate.
- **Waiting Room -> Assign To Me:** button entered loading state and remained on `/waiting-room`; console logged `TypeError: Failed to fetch`.
- **Open Notes -> Continue Note:** link/button was visible but did not navigate off `/open-notes`.
- **Save / finalize / reopen / history persistence:** not proven end-to-end on current production.

## What Is Flaky

- Client-side navigation on hydrated pages is not trustworthy right now.
- Runtime evidence strongly suggests hydration mismatch on:
  - `/patients`
  - `/patients/[id]/visit-history`
  - `/open-notes`

## What Is Only Safe With Guardrails

- Directly loading known routes after login is more reliable than trusting the app to land in the right place.
- Rendering route pages server-side works better than client-side navigation within those pages.
- Fresh new-visit workflows are unsafe for a short demo because Save stays disabled until enough sections are reviewed.

## Exact Recommended Demo Path

### For the **current live deployment**

There is **no approved full demo path** from sign-in to completion on current production.

### For the repo **after redeploy + smoke**

Use this only after the current repo changes are deployed and re-validated:

1. Sign in in isolated sessions for nurse and doctor.
2. Let the server choose the landing route after login.
3. Use a **pre-seeded in-progress visit** instead of a fresh `Log New Visit` path.
4. Prefer a **doctor continuation path** only after `Continue Note` is confirmed working in smoke.
5. Avoid Twilio/recording/AI unless the exact patient/visit pair has been re-tested successfully on the new build.

## Exact Forbidden Demo Paths

- Current production `Sign In` -> trust landing route.
- Current production patient chart `Visit History` click.
- Current production visit history `Log New Visit` click.
- Current production waiting room `Assign To Me`.
- Current production `Open Notes` -> `Continue Note`.
- Any current production path that depends on call assignment, recording, AI parsing, or finalize persistence without a fresh smoke test.

## Final Confidence Level

**Low confidence on current production.**

The live run proved enough to say the deployment is **not currently demo-safe**. The repo now contains targeted fixes for the login landing bug and the likely hydration mismatch behind dead client navigation, but those fixes still require redeploy + one more production smoke test before confidence can move to acceptable.
