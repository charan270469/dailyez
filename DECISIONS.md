# Decision Log
Append-only. Newest entries at the top. Do not edit or delete past entries.
---

### [2026-09-09 15:40] Respect Groq TPM cap on signal matching
- Agent: Copilot
- What changed: `server/agents/signalMatching.js`, `server/agents/matchSignal.js`, and `.env.example`.
- Why: The Groq matcher was still exceeding the free-tier token minute budget even after the request-per-minute pacing fix, because the retry path made a second HTTP call and the match prompt/output were still too large for the model's actual TPM ceiling.
- Approach chosen: Reduced the default shared rolling-window rate limit to `4` calls/60s, skipped the 429 retry on the same signal instead of firing a second mutation, and trimmed the match response/output budget to `GROQ_MATCH_MAX_TOKENS=160` with the message body capped at 600 chars.
- Alternatives considered: Raising the call count or leaving the retry in place would keep hitting the same TPM ceiling; stripping the response format or using a bigger model would work only if the quota changed and would not fix the underlying burst pattern.
- Trade-offs / risks: Some low-priority signals may now be deferred longer under heavy syncs, but the system remains stable and stops tripping the Groq quota instead of spamming 429s.

### [2026-09-09 15:25] Filter Gmail spam backfill to valid Gmail IDs
- Agent: Copilot
- What changed: `server/gmail/fetchMessages.js` and `server/tests/spamBackfill.test.js`.
- Why: The startup spam-backfill loop was scanning all message docs and sending WhatsApp numeric IDs like `3582553773` to Gmail’s `users.messages.get`, which implied non-Gmail records were being treated as Gmail and produced the invalid-id errors seen in the server log.
- Approach chosen: Added `isGmailMessageId()` to require a Gmail-shaped ID (alphanumeric/underscore/hyphen, minimum length, and at least one letter), and limited the spam backfill to documents tagged as Gmail (`source: 'gmail'` or `platform: 'gmail'`) while skipping invalid IDs instead of retrying them.
- Alternatives considered: Ignoring the error at the call site would hide the fact that the wrong document type was being processed; filtering only on `source` alone would miss older records with mixed or stale platform values and still allow numeric IDs to slip through.
- Trade-offs / risks: A malformed legacy Gmail ID that contains no letters would now be skipped rather than queried; those records would remain unbackfilled until repaired.

### [2026-09-09 14:29] Populate sender-intent fields on signal create/edit routes
- Agent: Cline
- What changed: `server/index.js` only.
- Why: POST /api/signals inserted signal documents without `isSenderIntent`/`entityName`, so "emails from X" signals created through the dashboard fell through to the Groq LLM matcher instead of the free deterministic sender/domain matcher (`matchSourceIntent.js`) that was built for exactly that case. PATCH /api/signals/:id also left stale flags after a context edit.
- Approach chosen: Mirrored the existing correct call site (`parseSignalEntity(context ? context.trim() : '')` in `server/agents/createSignal.js`, used by the voice flow): the POST handler now parses the context and stores `entityName`/`isSenderIntent` on the inserted document, and the PATCH handler re-parses whenever `context` is part of the update and sets fresh flags before re-checking messages. No changes to `parseSignalEntity.js`, `matchSourceIntent.js`, or the matching pipeline.
- Alternatives considered: Refactoring POST to call the shared `createSignal()` helper — cleaner dedup, but it changes behavior (the shared helper lacks the handler's WhatsApp signal-cache refresh / recheck) and is a larger diff than the task warrants.
- Trade-offs / risks: Signals created before this fix still lack the fields until edited (a PATCH regenerates them); existing stale documents are not backfilled by this change.
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
