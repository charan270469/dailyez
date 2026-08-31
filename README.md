# DailyEz

DailyEz is a personal dashboard that watches your Gmail and pulls the messages that
actually matter to you into one place. You describe what you care about in plain
language (for example "emails from recruiters" or "interview invitations"), and the
app fetches your Gmail, decides which messages genuinely match, and shows them in a
dedicated Important feed — so you don't have to scroll your whole inbox to find them.

It was previously called *SignalStream*; some old UI labels still say that, but
DailyEz is the current name.

## Current features

These are the parts that work today:

- **Google OAuth login** — connect your Gmail account from the Settings page.
- **Gmail ingestion** — the backend fetches recent messages on a 15-minute schedule,
  on demand via a refresh button, or right after you add a new signal. Duplicate
  messages are never stored twice.
- **Signals (watchlist)** — create natural-language signals like "alert me when I
  get a real interview invitation", plus optional explicit keywords. Signals can be
  added, edited, deleted, and toggled on/off.
- **LLM-based matching** — each new email is checked against your signals using Groq
  (`openai/gpt-oss-20b`). A matched email stores a summary, reasoning, and a
  high/medium/low confidence score. "Emails from X" signals are matched with fast,
  deterministic sender-domain checks instead of the LLM.
- **Keyword pre-filter** — a cheap keyword scan runs before the LLM to save API
  calls and to show keyword matches in All Inbox.
- **Views** — **Matched** (Important, LLM-matched messages with reasoning + confidence),
  **All Inbox** (every stored message, filterable), **Archive** (archive + restore),
  **Analytics** (volume / platform / top-signal charts derived from real data), and
  **Settings**.
- **Voice agent** — a floating chat that records audio, transcribes it with Groq
  Whisper, and can summarize recent emails, create signals, navigate tabs, or
  disconnect Gmail by voice (or typed command).
- **WhatsApp (fully wired)** — pair a WhatsApp account by scanning a QR code
  (Baileys), then the backend ingests live messages plus recent history from the
  phone. History persistence is scoped to the last 3 days by default
  (`WHATSAPP_HISTORY_WINDOW_DAYS`), so years-old backlog is never pulled into
  storage. Messages are normalized, matched against your signals through the same
  shared pipeline Gmail uses, grouped into conversations in the inbox UI, and
  labeled with resolved contact/group names.
- **WhatsApp session & lifecycle** — credentials persist across restarts (the
  backend auto-reconnects on startup), and Settings exposes resync and disconnect
  for the linked account.

## Planned / in progress

- **Discord** — currently a stub: the UI shows a "connected" toggle that only
  lights up when `DISCORD_BOT_TOKEN` is set, but no functional integration exists
  yet (connect/disconnect endpoints report it as not implemented). Planned next.
- **RAG / searchable history** — being able to ask questions across all your past
  messages in plain language. Design idea only; not built.
- **Smarter analytics** — some panels already use live data; richer analytics and
  trend features are planned.

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite 6, TypeScript, Tailwind CSS 4, Recharts, lucide-react |
| Backend | Node.js, Express 4 |
| Database | MongoDB (native `mongodb` driver) |
| Auth | Google OAuth 2.0 (`googleapis`) — Gmail API |
| LLM / voice | Groq SDK (`groq-sdk`) — intent matching, summaries, intent routing, Whisper transcription |
| WhatsApp | `@whiskeysockets/baileys` + `qrcode` + `pino` |
| Scheduling | `node-cron` |

## Project structure

```
signalstream/
├── server/                     # Express backend (Node)
│   ├── index.js                # Entry point: routes, cron jobs, HTTP server
│   ├── auth.js                 # Google OAuth2 client + refresh-token storage
│   ├── authRoutes.js           # OAuth flow, profile, connection-status routes
│   ├── voiceRoutes.js          # Voice transcribe/command endpoints
│   ├── whatsappRoutes.js       # WhatsApp connect/QR endpoints
│   ├── db.js                   # MongoDB connection + collection helpers
│   ├── gmail/
│   │   └── fetchMessages.js    # Gmail fetch, dedup, storage, matching orchestration
│   ├── agents/                 # Signal creation, keyword/LLM/source matching,
│   │                           # intent routing, voice actions, email summaries
│   ├── whatsapp/
│   │   └── connection.js       # Baileys socket lifecycle (QR, reconnect, session)
│   └── tests/                  # Standalone smoke/unit test scripts
├── src/                        # React frontend (Vite)
│   ├── main.tsx                # React entry point
│   ├── App.tsx                 # Root component
│   ├── DashboardLayout.tsx     # Tab shell + navigation wiring
│   ├── lib/api.ts              # Typed API client for every backend endpoint
│   ├── types.ts                # Shared TypeScript interfaces
│   └── components/             # Sidebar, tabs, cards, modals, voice chat
├── .env.example                # Template for required environment variables
├── index.html                  # Vite HTML entry
├── vite.config.ts              # Vite config (proxy: /api → :3001)
├── tsconfig.json               # TypeScript config
└── package.json                # npm scripts + dependencies
```

## Setup

**Prerequisites:** Node.js 18+, npm, a MongoDB instance (local or Atlas), and a
Google Cloud project with the Gmail API enabled.

1. **Clone and install**

   ```bash
   git clone <repository-url>
   cd signalstream
   npm install
   ```

2. **Environment variables**

   Copy the template and fill in your values:

   ```bash
   cp .env.example .env
   ```

   Every variable is documented in `.env.example`. The essentials are Google OAuth
   credentials (Google Cloud Console → APIs & Services → Credentials), a
   `MONGODB_URI`, and a `GROQ_API_KEY` from console.groq.com. Make sure
   `http://localhost:3001/auth/google/callback` is listed as an authorized redirect
   URI in your Google OAuth client.

3. **Run the backend** (Express, port **3001** — pinned by default)

   ```bash
   npm start
   # or: npm run dev:server
   ```

4. **Run the frontend** (Vite dev server, port **3000** — pinned via `strictPort`)

   ```bash
   npm run dev
   ```

   > The Vite dev server refuses to start if port 3000 is taken (`strictPort`),
   > and the backend always listens on port 3001 unless you explicitly override
   > `PORT` in `.env`. All `/api` and `/auth/google` calls from the frontend are
   > proxied to `http://localhost:3001`, so the two processes stay in sync.

   Then open **http://localhost:3000** and connect Gmail from Settings.

## Known limitations & quirks

- **Google OAuth is in "testing" mode** — only email addresses you explicitly add
  as test users can authenticate, and the consent screen may show a
  "Google hasn't verified this app" warning.
- **WhatsApp sessions can drop** — the Baileys session occasionally needs a fresh
  QR re-scan after a logout or a long disconnect. Session credentials live in
  `server/whatsapp/auth_session/` and are gitignored.
- **Signal match counts are not recomputed live** — `matchCount` on a signal is
  incremented whenever a message matches during ingestion, but `GET /api/signals`
  returns the stored counter as-is; it is not recomputed from the current matches,
  so it can drift from what the inbox actually shows.
- **WhatsApp runs only while the local backend is up** — the session persists
  across backend restarts (auto-reconnect), but the Baileys socket lives in the
  running backend process; there is no cloud/remote deployment yet, so the backend
  must keep running locally for live messages to keep flowing.
- **Single-user by design** — the backend stores one user's data (`_id: 'default'`);
  multi-user support is not implemented.
- **Archived messages are pruned** — messages stay in Archive for about a day
  (checked every 4 hours), then are permanently deleted so archived Gmail mail
  never re-appears.
- **Gmail fetch lag** — new mail can sit unfetched up to 15 minutes between cron
  runs; use the Watchlist refresh button for an immediate fetch.
- **Voice agent scope** — it understands a small set of actions (summarize, add
  signal, navigate, disconnect Gmail); everything else gets a polite fallback.