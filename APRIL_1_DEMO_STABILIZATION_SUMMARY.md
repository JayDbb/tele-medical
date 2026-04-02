# April 1 Demo Stabilization — Final Summary

**Date:** April 1, 2026  
**Repo:** `tele-medical`  
**Companion:** [APRIL_1_DEMO_STABILIZATION_TRACKER.md](./APRIL_1_DEMO_STABILIZATION_TRACKER.md)

---

## What was fixed (this pass + inherited)

1. **Patients list runtime pattern (P0):** Replaced illegal `setState` inside `useMemo` with `useEffect` so pagination resets safely when search changes (`patients-list.tsx`).
2. **Recording finalization authorization (P0):** Finalize API now matches visit finalize rules — user may finalize if they are the visit’s clinician **or** the patient’s assigned clinician (`recording/finalize/route.ts`).
3. **Visit details “Sign Note” visibility (P0):** Same OR rule so the button is not hidden for valid assignees (`visit-details-content.tsx`).
4. **Inherited (prior stabilization):** Session/middleware rate-limit behavior, `/visit-history` nav, continue-visit title + reviewed sections, `finalizeVisitAction` patient/visit clinician OR, social history nested merge — see tracker H-1–H-4, P1-INHERIT.

---

## What remains broken / risky

- **Full automated lint clean:** ~331 ESLint problems repo-wide (188 errors, 143 warnings) — **not** a demo gate per stabilization charter.
- **`visit-details-content.tsx`:** Many `no-explicit-any` findings remain; could hide shape bugs when note JSON varies — **monitor during demo** if showing old visits.
- **Twilio / recorder path:** Not refactored this pass; failures should surface as toasts/errors — have a **no-recording** demo branch ready.
- **Supabase 429:** Single navigation may still see transient `null` session; avoid rapid multi-tab same user during demo if possible.

---

## Intentionally deferred

- Repo-wide typing and a11y cleanup.  
- `merge-with-conflicts.ts` / `use-call-recorder.ts` deep refactors.  
- Offline/sync unless demo script requires it.

---

## Workflows — confirmed in code / prior QA

- Sign-in and protected routing (with inherited session fixes).  
- Visit Log → `/visit-history` (no `/log-history` 404).  
- Continue visit heading + save gating fix on continue path.  
- Finalize visit action + **now** recording finalize + visit-details sign visibility aligned on assignee rules.  
- Patient list search → page reset without render-phase `setState`.

*Full end-to-end confirmation still needs a running stack (DB, auth, optional Twilio).*

---

## Workflows — still risky

- **Heavy Twilio / media** (camera permissions, duplicate identity, chunk finalize variance).  
- **AI transcribe / parse** after finalize — failures are logged and may leave draft unchanged; not a hard crash in route handler.  
- **Note JSON shape** on very old rows — `visit-details` uses loose typing.

---

## Recommended demo script / guardrails

1. Use **separate demo users** per device (Supabase invalidates concurrent sessions for same account).  
2. Pre-flight: open **Visit Log**, one **Continue Visit**, **Sign Note** as the user shown as assigned on **either** patient or visit.  
3. If recording is flaky: **do not** rely on post-call AI merge; narrate manual note entry; finalize still works if chunks empty (API returns success with null transcript — see route).  
4. Avoid hammering navigation in the minute before demo to reduce 429 noise.  
5. Keep **Known Risks** doc from prior run handy: [Known Risks to Avoid in Demo.md](./Known%20Risks%20to%20Avoid%20in%20Demo.md).

---

## Lint reality check

| Scope | Posture |
|-------|---------|
| **Full repo** | `npx eslint .` → **331** problems (**188** errors, **143** warnings) — baseline unchanged in spirit from ~336 report. |
| **Touched this pass** | `patients-list.tsx` — **0** errors after small hygiene. `recording/finalize/route.ts` — **0** errors. `visit-details-content.tsx` — **17** `no-explicit-any` errors + **3** warnings (**pre-existing** in file; not introduced by sign-button change). |
| **Demo execution threat from remaining lint** | None identified that directly breaks runtime for the **lines changed**; unresolved `any` in visit-details is **confidence**, not a proven crash. |

---

## Overall verdict

**DEMO READY WITH GUARDRAILS**

Core chart/visit/finalize **authorization** and patient list **React correctness** are improved; session and nav fixes from the prior pass remain the backbone. Full **DEMO READY** would require a recorded dry run on production-like env (Twilio + storage + auth) with no surprises.

---

_See [APRIL_1_DEMO_STABILIZATION_TRACKER.md](./APRIL_1_DEMO_STABILIZATION_TRACKER.md) for per-issue detail._
