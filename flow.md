# Application Flow

1. Vite serves React on `http://localhost:3000` and proxies `/api` and
   `/auth/google` to Express on port `3001`.
2. `App` requests `/api/auth/status`; signed-out users see `LoginScreen` and
   signed-in users see `DashboardLayout`.
3. Selecting Google redirects through `/auth/google` to Google's OAuth chooser
   and consent screen. The request asks for offline access and a fresh consent
   grant so a refresh token is returned reliably.
4. Google redirects to `/auth/google/callback`. The backend exchanges the code,
   saves the refresh token, updates the Google profile, and immediately redirects
   to `http://localhost:3000/?gmail=connected`.
5. Gmail ingestion starts in the background after the redirect. It lists Gmail
   messages, fetches new message details, matches them against signals, and
   stores them in MongoDB. Syncs only fetch the last `GMAIL_FETCH_WINDOW_DAYS`
   days (default 30) — the cutoff is sent to the Gmail API as an
   `after:YYYY/MM/DD` search query, so older mail is never returned by Gmail and
   never ingested. Already-stored messages are untouched by this window (only
   the separate archived-message cron prunes stored data).
6. The dashboard loads connection status and feed data through the `/api` proxy.
   Periodic (cron every 2 minutes), manual, and signal-creation fetches reuse the
   same Gmail ingestion pipeline. A single in-flight flag (`gmailSyncInFlight`)
   guarantees only one Gmail sync runs at a time: if a cron tick, manual refresh,
   or new-signal fetch fires while a sync is running, it is skipped and logged
   (`[gmail-sync] Skipped Gmail sync: a sync is already in progress`).
7. Logout revokes Gmail, disconnects WhatsApp, marks the profile signed out,
   and returns the user to `LoginScreen`.

## Backend Startup

1. Express registers auth, voice, and WhatsApp routes and starts listening before
   the initial MongoDB connection completes.
2. MongoDB is connected during startup. A failed connection is logged, while
   individual requests report their own database failure and can retry after
   connectivity returns.
## Signals / Watchlist flow

1. Create (dashboard UI): Watchlist → "Add New Signal" → `POST /api/signals { context, keywords, alertEnabled?, alertTarget?, alertPlatform? }`.
   - The handler normalizes keywords, then runs the deterministic `parseSignalEntity(context.trim())` (`server/agents/parseSignalEntity.js`) and stores `entityName` + `isSenderIntent` on the new signal document — so "emails from X" style signals are classified as sender-intent at creation time.
   - Optional sender-alert section ("Alert me" toggle below the context box): when a target is entered, the handler stores the normalized `alertEnabled` (default `true`) + `alertTarget` (`normalizeAlertTarget('gmail', …)` for email; `normalizeWhatsAppChatIdForGrouping` for WhatsApp) + `alertPlatform`, in addition to the context fields. Alert-target-only signals (no context/keywords) are allowed.
   - Fire-and-forget after insert: re-fetch Gmail, recheck all stored messages against signals, recheck keyword matches, refresh the shared signal cache, recheck WhatsApp matches.
2. Edit: `PATCH /api/signals/:id` re-runs `parseSignalEntity` on the new context and updates `entityName`/`isSenderIntent`, then re-checks all messages so an edited signal is re-classified instead of keeping stale flags. When the body carries any of `alertEnabled`/`alertTarget`/`alertPlatform`, the trio is normalized and persisted too — turning the toggle OFF stores `alertEnabled: false` (target preserved) which fully silences the alert matcher.
2b. Quick alert (one-click "Alert me", Gmail/WhatsApp message cards): `POST /api/signals/quick-alert { target, platform, senderName? }` creates a sender/chat-scoped alert signal from the card — no Add Signal form. The handler normalizes the target (Gmail → lowercased sender email; WhatsApp → canonical chat id via `normalizeWhatsAppChatIdForGrouping`), **dedups on `alertTarget` + `alertPlatform`** (second click for the same sender is a no-op that returns `alreadyExists`), stores the signal with `alertEnabled: true`, `alertTarget`, `alertPlatform` and an auto-generated context like `Alerts for messages from <name>`, then fire-and-forgets the same re-fetch/re-check/cache-refresh cascade as `POST /api/signals`.
3. Matching (shared Gmail + WhatsApp pipeline, `server/agents/signalMatching.js` → `server/agents/orchestrator.js`):
   - PIPELINE 1: deterministic keyword matching (no LLM).
   - PIPELINE 2 per signal: `signalMessageMatches` routes every message × signal pair through `orchestrateMatch` (`server/agents/orchestrator.js`) — the single matching entry point for Gmail sync, WhatsApp sync, and every re-check:
     - alert-target signals (one-click button or the Add/Edit form's "Alert me" section) → `matchAlertTarget` (deterministic): exact sender email for Gmail; for WhatsApp the target is compared against EVERY stored sender identity (canonical chat id/phone number, group JID, participant JID, resolved contact/group display name). Platform-guarded via the normalized message's `source`. No LLM call, and any alert-flavored signal (has `alertTarget` or an explicit `alertEnabled` flag) never falls through to the intent matcher — disabled alerts are fully silent while OFF.
     - sender-intent signals (`isSenderIntent = true`) → `matchSourceSignal` in `server/agents/matchSourceIntent.js` — pure code, domain/display-name match, NO Groq call.
     - everything else (topic/event/mixed) → `runClassificationPipeline`: keyword pre-filter (skips the LLM on unrelated messages) → shared Groq rolling-window RPM limiter → `checkSignalMatch` (the existing matchSignal.js LLM matcher, unchanged; the extraction/verification agents plug in here in later tasks).
   - Each evaluation logs one `[pipeline] path=…` line recording which route ran: `alert-target (deterministic)`, `source-intent (deterministic)`, `classification-pipeline (LLM)`, or the pre-filter-skip variant.
   - Gmail messages are fetched with `format: 'full'` and reduced to readable plain text (`extractBodyText` in `server/gmail/fetchMessages.js`; text/plain preferred, HTML stripped when HTML-only). The FULL body — not the short Gmail snippet — feeds keyword matching, the keyword pre-filter, and the LLM. The LLM body is capped by `GROQ_MATCH_CONTENT_CHAR_LIMIT` (default 4,000 chars ≈ 1,000-1,500 tokens, headroom inside the model's TPM budget). The stored snippet stays in `content` for UI previews; the full extracted text is stored separately as `bodyText`.
4. Voice-command "add signal" follows the same path via the shared `createSignal()` helper (`server/agents/createSignal.js`), which also stores `entityName`/`isSenderIntent`.
5. Incremental re-evaluation (`lastEvaluatedSignalIds`):
   - Every stored message records `lastEvaluatedSignalIds: string[]` (the signal ids it has already been evaluated against, populated the first time it is processed).
   - Routine syncs/rechecks evaluate a message ONLY against signals whose id is NOT in that list (`getPendingSignals` in `signalMatching.js`). A fully-evaluated unmatched message costs zero Groq calls and, for Gmail, zero API round-trips on subsequent syncs.
   - A newly created signal id is automatically missing from every message's list, so creation-time re-checks evaluate messages against just that signal.
   - Editing a signal strips its id from every message's `lastEvaluatedSignalIds` (PATCH handler), so the subsequent re-checks re-evaluate that single edited signal.
   - Matched messages remain handled as before: they are skipped entirely by syncs and incremental re-checks.
