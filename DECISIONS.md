# Decision Log
Append-only. Newest entries at the top. Do not edit or delete past entries.
---

### [2026-09-10 12:05] Incremental signal re-evaluation via lastEvaluatedSignalIds
- Agent: Cline
- What changed: `server/agents/signalMatching.js`, `server/gmail/fetchMessages.js`, `server/whatsapp/connection.js`, `server/index.js`.
- Why: An unmatched message was re-sent to Groq on every routine sync cycle as long as it was still inside the fetch window, even when no signal had changed since its last check — pure wasted cost (and Groq RPM/TPM pressure). Edits to a signal's context/keywords also needed to make that signal "new" again for matching.
- Approach chosen: Added `lastEvaluatedSignalIds: string[]` (string signal ids) to each stored message, populated on first processing. Added `getPendingSignals(signals, lastEvaluatedSignalIds)` in `signalMatching.js`; `signalMessageMatches` now takes an `alreadyEvaluatedSignalIds` arg, evaluates only pending signals, and returns `evaluatedSignalIds` so callers can append to the stored list. Gmail sync (`fetchAndStoreGmailMessages`) skips a fully-evaluated unmatched message entirely (zero Groq + zero Gmail API); `recheckAllMessagesAgainstSignals` and `recheckWhatsAppSignalMatches` evaluate only pending signals and merge result state (match lists, keyword lists, evaluated ids) instead of overwriting. For the edit case, `PATCH /api/signals/:id` does an `updateMany` that `$pull`s the edited signal's id from every message's `lastEvaluatedSignalIds`, so the existing post-edit rechecks re-evaluate just that one signal. New-signal creation needs no special logic because a new id is absent from every list. WhatsApp force-rechecks merge + de-dupe signalMatches so pre-feature messages don't accumulate duplicate entries.
- Alternatives considered: Per-signal version/`updatedAt` + storing evaluated [{signalId, version}] per message — more precise (catches any historical edit), but heavier: requires a version field on signals, a nested-array migration for existing messages, and per-message version comparison on every sync. The strip-on-edit approach reuses the existing PATCH code path (next to the existing `signalMatches` context-label sync) and keeps `lastEvaluatedSignalIds` a flat string array.
- Trade-offs / risks: A message incorrectly stored with a stale full `lastEvaluatedSignalIds` would never re-check, but the only writers are the sync/recheck paths that build the list from `evaluatedSignalIds` — which only ever come from signals actually fed to the matcher. Pre-feature messages (no field) get a one-time full evaluation on their next sync/recheck, then are stamped. "Refresh matched mails" (`POST /api/messages/recheck`), new-signal creation, and signal edits now re-evaluate only new/changed signals rather than the full set — the requested behavior.

### [2026-09-10 09:30] Fix GPT-OSS reasoning-token budget exhaustion on signal matching
- Agent: Cline
- What changed: `server/agents/matchSignal.js` and `.env.example`.
- Why: `openai/gpt-oss-20b` is a reasoning model — it spends completion tokens on internal reasoning BEFORE writing visible output, drawn from the same `max_tokens` budget set by the earlier rate-limit pass. That budget could be exhausted during the reasoning phase, failing the call with "max completion tokens reached before generating a valid document" (json_validate_failed).
- Approach chosen: Made `reasoning_effort: 'low'` conditional on the model name (`GROQ_MATCH_MODEL` contains `gpt-oss`, per Groq's docs only GPT-OSS reasoning models support it) so the internal reasoning pass is capped on GPT-OSS models and the parameter is never sent to others; raised the `GROQ_MATCH_MAX_TOKENS` default from 160 to 800 so there is headroom for both the low-effort reasoning pass and the full strict-JSON response; added a one-line per-call usage log (prompt/completion/reasoning/total tokens) so the savings are observable. Verified with a live one-shot smoke test (2 calls): reasoning_tokens=44-45 of ~155-179 completion tokens, prompt ~1,490 tokens, no json_validate_failed, both strict-JSON responses parsed.
- Alternatives considered: Removing the token cap or defaulting `reasoning_effort` to medium/high would leave the reasoning pass unbounded and defeat the original budget goal; switching to `max_completion_tokens` changes nothing at this API layer since the observed failure message already treats the cap as the full completion.
- Trade-offs / risks: 800 max tokens per match call is less token-efficient than 160 (higher worst-case TPM per call), but correctness wins — a call that fails wastes a slot and retries anyway. The RPM limiter (GROQ_MATCH_RPM_LIMIT, default 4/min) still bounds sustained throughput; prompt size (~1,490 tokens) remains the larger TPM driver, unchanged here.

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
