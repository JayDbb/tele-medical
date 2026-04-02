# Known Risks to Avoid in Demo

1. **Same demo user on two devices** — Supabase invalidates the prior session. Use **nurse + doctor accounts** on separate browsers/devices (per Atlas credential sheet; do not read passwords aloud on stream).

2. **Offline banner** — Save Visit stays disabled while `navigator.onLine` is false. Stay on stable Wi‑Fi or mention offline mode briefly.

3. **New visit (not continue)** — Still requires stepping through all sections (or they must be marked reviewed) before Save. Prefer **Continue Note** for a short demo path.

4. **Documents / Orders** — Atlas lists possible P0/P1 bugs (documents error, New Order inert). **Avoid** those tabs unless pre-tested same day.

5. **AI / transcription** — Without keys, do not promise live transcribe; use pre-seeded visit or manual fields.

6. **Rate limits** — Heavy automated testing against Supabase right before demo can still cause a **single** flaky load; space out retries.

7. **ICD-10 / coding** — Atlas notes may not be demo-ready; skip unless verified.
