# DailyEz

DailyEz is a local, AI-assisted inbox and signal dashboard for Gmail and WhatsApp.
It ingests both message streams, filters them through natural-language signals, and
lets the user explore them through a modern dashboard with matched messages, inbox
search, archive actions, charts, and a voice assistant.

This repo is the current production-facing codebase for the project formerly known
as DailyEz. The UI still retains some legacy naming in a few places, but the
active product name is DailyEz.

## What this repo does today

DailyEz combines message ingestion, signal matching, alert routing, and voice
interaction into one local workflow:

- Gmail is connected through Google OAuth and periodically refreshed on a cron
  schedule.
- WhatsApp is paired through Baileys QR flow, auto-reconnects across restarts, and
  keeps recent history and live messages synchronized.
- Signals are created as natural-language intents with optional keyword filters and
  sender/chat alert scoping.
- New messages are matched against signals using a hybrid pipeline: keyword
  prefilter + model-based checks + deterministic sender matching for exact sender
  patterns.
- The app exposes multi-tab views for Matched, All Inbox, Archive, Analytics, and
  Settings.
- A floating voice assistant accepts speech or typed commands, transcribes audio,
  routes commands through intent logic, executes actions, and speaks the reply back.

## Current feature set

### Account and platform integration

- Google OAuth login for Gmail with connection status and reconnect handling.
- Gmail revoke/disconnect flow plus a reconnect prompt when the refresh token is
  revoked or invalid.
- WhatsApp QR pairing and live connection lifecycle managed by Baileys.
- Persisted WhatsApp session data with startup auto-reconnect behavior.
- Separate connection status checks for Gmail and WhatsApp, surfaced in the
  Settings tab.

### Signal and matching system

- Natural-language signals for user intent and watchlist items.
- Optional keyword lists per signal.
- Live match counts and signal rechecks after new message ingestion.
- Exact sender/chat alert targeting via "Alert me" actions on message cards.
- Deduplication so repeated alert creation is a no-op when the same sender/chat is
  already being watched.
- Shared match pipeline across Gmail and WhatsApp so both platforms feed the same
  signal engine.
- Backend logic to invalidate and refresh the signal cache when new signals are
  added.

### Inbox and message views

- Matched tab for high-confidence, relevant messages with reasoning and signal
  metadata.
- All Inbox feed with filters for source platform and keyword-matched state.
- Cursor-based inbox pagination with first-page fast load and infinite-scroll style
  loading for older messages.
- Message archive/restore flow for dismissed or deferred items.
- Grouped WhatsApp conversations in the inbox UI with resolved names for chats and
  groups.
- Search and summarization for individual WhatsApp conversations, including text
  search inside a thread.

### Analytics and insights

- Analytics tab with live data visualizations derived from stored signals and
  messages.
- Volume, platform, and top-signal trend summaries based on persisted data.
- Signal health and message counts surfaced in the dashboard shell.

### Voice assistant

- Floating assistant chat panel with mic input and text prompts.
- Whisper-based transcription using Groq.
- Intent routing for commands such as summarize mail, create or manage signals,
  navigate tabs, disconnect Gmail, and other supported voice actions.
- Browser speech synthesis is used immediately for assistant replies to minimize
  latency.
- Local Kokoro TTS remains available for backend synthesis and is warm-started in
  the background when the server is ready, but the chat reply path prefers browser
  playback for responsiveness.
- Fallback behavior is kept if speech synthesis or TTS generation fails.

### Backend operational improvements

- MongoDB indexing for inbox sort queries and message fetch speed.
- Silent refresh behavior and cache-based UX so tab switches do not force a full
  reload of message data.
- Gmail backfill and spam-flag logic.
- Defensive handling for revoked Google refresh tokens with reconnect-state
  messaging instead of noisy token dumps.
- Startup lifecycle management for WhatsApp and model warmup tasks.

## App flow

The runtime flow is:

1. User opens the app and the frontend checks auth status.
2. If signed out, the user is shown the login screen; otherwise the main dashboard
   renders.
3. Sidebar navigation selects a tab: Matched, All Inbox, Archive, Analytics,
   Settings, or Help.
4. The backend periodically refreshes Gmail and maintains the signal/matching
   pipeline.
5. WhatsApp optionally connects via QR, syncs recent history, and stays connected
   through a persisted session.
6. User actions (create signal, archive message, quick-alert, refresh data, toggle
   sync, voice command) call the Express API.
7. Matching, summarization, and analytics read from MongoDB and update the UI.
8. The voice assistant can navigate the app or speak back responses using the browser
   or local TTS stack.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite 6, TypeScript, Tailwind CSS 4, Recharts, lucide-react |
| Backend | Node.js, Express 4 |
| Database | MongoDB (native `mongodb` driver) |
| Auth | Google OAuth 2.0 (`googleapis`) |
| LLM / voice | Groq SDK (`groq-sdk`), Whisper transcription, intent routing |
| Voice synthesis | Browser `speechSynthesis` + local Kokoro backend TTS (`kokoro-js`) |
| WhatsApp | `@whiskeysockets/baileys`, `qrcode`, `pino` |
| Scheduling | `node-cron` |
| UI helpers | `motion`, shadcn-style component primitives, custom CSS utilities |

## Repository structure

```text
dailyez/
├── server/
│   ├── agents/                  # signal matching, intent routing, voice actions,
│   │                           # summarization, Groq budget tracking
│   ├── gmail/                  # Gmail ingestion, dedup, archiving, spam logic
│   ├── whatsapp/              # Baileys connection lifecycle, history sync,
│   │                           # conversation grouping and session persistence
│   ├── tests/                 # smoke tests and targeted validation scripts
│   ├── auth.js                # Google OAuth + token validation helpers
│   ├── authRoutes.js          # auth endpoints and profile/connection status
│   ├── db.js                  # MongoDB connection and collection helpers
│   ├── index.js               # Express app entry, routes, startup hooks, cron jobs
│   ├── inboxPagination.js     # cursor-based inbox pagination helpers
│   ├── ttsKokoro.js           # Kokoro TTS warmup and synthesis helper
│   ├── voiceRoutes.js         # voice transcription, command execution, speech synthesis
│   ├── whatsappRoutes.js      # WhatsApp QR/connect/resync endpoints
│   └── ...
├── src/
│   ├── components/            # sidebar, dashboard tabs, cards, modals, voice panel
│   ├── lib/                   # typed API client and utility helpers
│   ├── App.tsx                # auth gate and dashboard entry
│   ├── DashboardLayout.tsx    # main dashboard shell and tab switching
│   ├── index.css              # app styling and dark/light surface overrides
│   ├── main.tsx               # React bootstrap
│   ├── mockData.ts            # sample data for UI/testing use
│   ├── types.ts               # shared app types
│   └── ...
├── assets/                    # static UI assets
├── .env.example               # environment template
├── components.json            # shadcn-style config metadata
├── index.html                 # Vite SPA entry
├── package.json               # scripts and dependency list
├── tsconfig.json              # TypeScript compiler config
├── vite.config.ts             # Vite server config and API proxy
├── README.md                  # project overview and setup
├── DECISIONS.md               # append-only decision log
├── FLOW.md                    # runtime flow documentation when applicable
└── ...
```

## Setup

### Prerequisites

- Node.js 18+
- npm
- MongoDB instance (local or Atlas)
- Google Cloud project with Gmail API enabled
- Groq API key

### Install

```bash
git clone <repository-url>
cd dailyez
npm install
```

### Environment

```bash
cp .env.example .env
```

The required values include:

- `MONGODB_URI`
- `GROQ_API_KEY`
- Google OAuth client credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
- Optional `PORT`, `FRONTEND_URL`, WhatsApp session settings, and TTS overrides

For Google OAuth, add the redirect URI:

```text
http://localhost:3001/auth/google/callback
```

### Run the app

Backend:

```bash
npm run dev:server
```

Frontend:

```bash
npm run dev
```

The frontend runs on port 3000 and proxies `/api` and `/auth/google` requests to
port 3001. Open:

```text
http://localhost:3000
```

## Known limitations and current caveats

- Google OAuth is intended for a small, explicitly approved user set while the app is
  in testing mode.
- WhatsApp sessions still depend on the local backend staying up; the session is
  persisted but the socket is not cloud-hosted.
- Signal match counters can drift over time if historical documents are reprocessed
  or some counts are incremented from prior backfills.
- Archived Gmail messages are pruned after a configured period.
- The voice command set is intentionally narrow and returns polite fallback responses
  outside of supported actions.
- Some legacy UI labels still reference the older DailyEz naming even though the
  current product is DailyEz.

## Roadmap / planned work

- Richer RAG-style historical question answering across all stored messages.
- More advanced analytics and monitoring views.
- Broader voice command coverage and better multi-step assistant workflows.
- Additional deployment and resilience work for a production environment.

## Notes

This repository is a working local dashboard with real message ingestion, matching,
alerting, and conversation tooling. It is not a generic starter app; it is a custom
personal signal-monitoring system built around Gmail and WhatsApp data streams.