# Decision Log
Append-only. Newest entries at the top. Do not edit or delete past entries.
---

### [2026-09-09 12:46] Groq match-call pacing + output token cap
- Agent: Cline
- What changed: `server/agents/signalMatching.js`, `server/agents/matchSignal.js`, `.env.example`.
- Why: The flat 100ms delay between signal-matching Groq calls allowed up to ~600 calls/min while the free tier caps at ~30 RPM, so 429s and the 5s-retry path fired constantly and slowed syncs; the match call also had no output-token cap.
- Approach chosen: Added a module-level rolling-window rate limiter in `signalMatching.js` (`GROQ_MATCH_RPM_LIMIT`, default 28) shared across every message × signal pair (Gmail, WhatsApp, re-check sweep) that never lets more than 28 calls fall in any 60s window (≈28 calls/min sustained) and also paces the 429 retry; added `max_tokens` (`GROQ_MATCH_MAX_TOKENS`, default 350) to the match Groq call in `matchSignal.js`.
- Alternatives considered: A fixed token-bucket spacing of ~2100ms — simpler and more even, but it double-waits on top of real call latency (>1s each), capping throughput well below the tier and slowing syncs more than needed; the rolling window folds call duration into the budget and allows short bursts while window headroom exists.
- Trade-offs / risks: The first 28 calls of a cold sync can still burst inside a 60s window (that is within the tier's rolling limit); long re-check syncs of many message×signal pairs average ~28 calls/min, so very large sweeps take longer wall-clock. The 429 + 5s path stays as a safety net for 429s caused by other Groq features sharing the same key (summaries, voice).

### [2026-09-08 00:00] Unify platform connection actions
- Agent: Copilot
- What changed: Updated `src/components/SettingsTab.tsx` so Gmail and WhatsApp each use one state-driven connection button.
- Why: Connected platforms should show only a red `Disconnect` action, while disconnected platforms should show only `Connect`.
- Approach chosen: Reused the existing connect and disconnect handlers and switched each button's label, click action, and styling from the platform connection state.
- Alternatives considered: Keeping separate reconnect and disconnect controls would preserve more actions but conflicts with the requested compact UI.
- Trade-offs / risks: Gmail no longer exposes a separate `Reconnect` action in Settings; reconnecting requires disconnecting and connecting again.

### [2026-09-08 00:00] Prevent Gmail OAuth callback hangs
- Agent: Copilot
- What changed: Updated `server/authRoutes.js`, `server/index.js`, and `flow.md`.
- Why: Selecting a Google account left the browser waiting on the OAuth callback.
- Approach chosen: Redirect immediately after token/profile persistence, run Gmail ingestion in the background, request a fresh offline consent grant, and start Express before the initial MongoDB handshake.
- Alternatives considered: Increasing browser or database timeouts would preserve the blocking flow and would not fix slow Gmail matching.
- Trade-offs / risks: Gmail messages may appear shortly after the dashboard opens; MongoDB errors now surface per request instead of preventing the server from listening.
