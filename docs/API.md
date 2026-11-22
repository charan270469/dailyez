# DailyEz API

Base: frontend (`:3000`) proxies `/api` + `/auth/google` to Express (`:3001`).
Canonical client: `src/services/api.ts` (`ApiError` + `getErrorMessage`); `src/lib/api.ts` is a compat re-export only.
Conventions: JSON bodies, `{ ok: true, ... }` on success, `{ error }` / `{ ok: false, error }` on failure.

## Health / legacy

| Method | Path | Notes |
|---|---|---|
| GET | `/` | `{ message }` liveness |
| GET | `/messages`, `/stored-messages` | Legacy full-list dumps (Gmail-window filtered, WhatsApp status msgs excluded) |

## Auth / Google OAuth (`server/authRoutes.js` → `registerAuthRoutes`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/auth/status` | `{ gmail, gmailNeedsReconnect, whatsapp, loggedOut, user? }` — `App.tsx` gate |
| PUT | `/api/auth/profile` | `{ name?, avatar? }` — email immutable; avatar = https URL or base64 data URL ≤4MB |
| PATCH | `/api/auth/gmail/disconnect` | Revoke Gmail token |
| POST | `/api/auth/:platform/disconnect` | `gmail` or `whatsapp` |
| POST | `/api/auth/logout` | Revoke Gmail + disconnect WhatsApp, mark signed out |
| POST | `/api/auth/whatsapp/connect` | Alias of WhatsApp connect (see below) |
| GET | `/auth/google` | Redirect to Google consent (`offline`, `prompt=consent`, gmail.readonly + profile scopes) |
| GET | `/auth/google/callback` | Exchange code, save refresh token + profile, redirect `FRONTEND_URL/?gmail=connected`, background Gmail sync |

## Signals (`server/index.js` inline → planned `server/routes/signals.js`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/signals` | All signals, live `matchCount` recomputed from non-archived matched messages |
| POST | `/api/signals` | `{ context, excludedCriteria?, keywords?, alertEnabled?, alertTarget?, alertPlatform?, pdfParsingEnabled? }` — validates, classifies entity, fire-and-forget Gmail/WhatsApp rechecks |
| POST | `/api/signals/quick-alert` | One-click sender/chat alert `{ target, platform, senderName? }` — dedups on `alertTarget+alertPlatform` |
| PATCH | `/api/signals/:id` | Partial update; strips signal from `lastEvaluatedSignalIds` so only it re-evaluates |
| DELETE | `/api/signals/:id` | Removes signal + pulls its refs from `signalMatches`/`keywordSignalMatches`, recomputes flags |
| GET | `/api/signals/messages` | Intent-matched mail, optional `?signalId=`; self-heals stale `matched` flags |
| GET | `/api/sender-memory/:senderKey` | Debug only, key = `<platform>:<identity>` (URL-encode `:`) |

## Messages / inbox (`server/index.js` inline → planned `server/routes/messages.js`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/messages/inbox` | All Inbox. No params = full array (legacy); `?limit=&cursor=&source=&keywordMatched=` = `{ messages, nextCursor }` paged, WhatsApp grouped per conversation |
| GET | `/api/messages/important` | LLM-matched feed; self-heals matches pointing at deleted signals |
| GET | `/api/inbox` | Keyword-matched mail, optional `?signalId=` |
| GET | `/api/messages/archive` | `status: archived`, newest first |
| PATCH | `/api/messages/:id/archive` / `/restore` | Archive sets `archivedAt`; restore clears it |
| GET | `/api/messages/:id/summarize` | Single Gmail summary via Groq (`{ summary, messageCount: 1 }`) |
| POST | `/api/messages/recheck` | Re-evaluate all vs all signals (Gmail + forced WhatsApp) |
| POST | `/api/messages/backfill-spam` | Backfill spam flags |
| GET | `/api/messages/matched-stream` | SSE `message:matched` push; 4s visible-tab poll in UI is the fallback |
| POST | `/api/gmail/fetch` | Manual Gmail sync (cron runs same pipeline every 2 min, single-flight guard) |
| GET | `/api/whatsapp/chats` | Live Baileys chat list (persisted cards come from inbox) |

## WhatsApp (`server/whatsappRoutes.js` → `registerWhatsAppRoutes`; every route also aliased under `/api/auth/whatsapp/...`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/whatsapp/status` | Baileys state for QR flow |
| POST | `/api/whatsapp/connect` | Start socket (no-op if running) |
| POST | `/api/whatsapp/pairing-code` | `{ phoneNumber }` → 8-char code |
| POST | `/api/whatsapp/disconnect` | Logout + clear session |
| POST / GET | `/api/whatsapp/resync` | POST wipes + re-ingests; GET returns `{ resyncing }` poll state |
| GET | `/api/whatsapp/groups/:chatId/summarize?range=` | 1–50 (default 50) msg recap |
| GET | `/api/whatsapp/groups/:chatId/search?q=` | Literal case-insensitive content search, newest first |

## Voice (`server/voiceRoutes.js` → `registerVoiceRoutes`)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/voice/transcribe` | JSON `{ audioBase64, mimeType? }` or raw `audio/*` bytes → `{ text }` (Groq Whisper `whisper-large-v3-turbo`, 25MB cap) |
| POST | `/api/voice/command` | `{ text }` → intent route + execute → `{ response, navigateTo? }` |
| POST | `/api/voice/synthesize` | `{ text }` (clipped 1000 chars) → local Kokoro WAV base64; failure = caller falls back to `speechSynthesis` |

## System (`server/index.js` inline → planned `server/routes/system.js`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/system/groq-budget` | Per-model daily usage vs `GROQ_DAILY_LIMIT_*` (visibility; matching defers when exhausted) |
| GET | `/api/system/gemini-budget` | PDF-parse usage vs `GEMINI_DAILY_LIMIT` (visibility only, never defers) |
