PROJECT CONTEXT: DailyEz (also referenced as SignalStream in earlier UI/code)

═══════════════════════════════════════════════════════════════
WHAT THIS PROJECT IS
═══════════════════════════════════════════════════════════════

DailyEz is a full-stack ML/agentic application that unifies a user's Gmail and WhatsApp 
into a single priority dashboard. Instead of a keyword-matching notification 
bot, it uses LLM-based intent reasoning to understand what the user actually cares about 
(described in natural language, not exact keywords) and surfaces only genuinely relevant 
messages, with an AI-generated summary explaining why each one matters.

CURRENT PHASE: Gmail-only. WhatsApp ingestion is planned but not yet built. 
Do not implement WhatsApp functionality until Gmail is fully working and tested — 
only its UI placeholder should exist right now.

═══════════════════════════════════════════════════════════════
CORE PRODUCT CONCEPT
═══════════════════════════════════════════════════════════════

The user defines "Signals" — freeform natural-language descriptions of what matters to 
them, e.g.:
- "Alert me when I receive a genuine interview invitation, not newsletters that mention 
  interviews"
- "Show me only genuine job postings relevant to AI/ML roles, not generic job board spam"

Each incoming Gmail message is evaluated against every active Signal using an LLM 
(Groq, Llama 3.3 70B) that reasons about intent — not keyword presence. The LLM must 
distinguish real instances (e.g. an actual interview invite addressed to the user) from 
superficial matches (e.g. a promotional email that happens to mention "interview"). 
Matched messages surface in the "Important" tab with an AI-generated one-sentence 
summary, a confidence level (high/medium/low), and an expandable "reasoning" field 
showing the model's judgment — this reasoning field exists specifically so the user can 
debug false positives/negatives and refine how they word their signals over time.

═══════════════════════════════════════════════════════════════
FULL ARCHITECTURE
═══════════════════════════════════════════════════════════════

(OAuth2)──→ [Ingestion: fetchMessages.js]
                                      │
                                      ▼
                          [Normalize into common schema]
                                      │
                                      ▼
                    [For each message × each active Signal:]
                    [server/agents/matchSignal.js — Groq LLM call]
                    (reasoning-based intent match, not keyword match)
                                      │
                                      ▼
                     [Store on message doc: matched, matchedSignalId(s), 
                      summary, reasoning, confidence]
                                      │
                                      ▼
                              [MongoDB Atlas]
                     (collections: messages, signals, users/auth_tokens)
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
            [Important tab]    [All Inbox tab]    [Archive tab]
          (matched: true,      (all messages,     (archived: true,
           sorted by date)      unfiltered)         auto-deletes after
                                                       4 days via cron)

                    [Chatbot panel — NOT YET BUILT]
        (planned: RAG over FAISS-embedded message history, answers 
         natural-language questions across the user's own message data)

FUTURE (not yet built, planned):
- WhatsApp ingestion via Baileys (unofficial WhatsApp Web client library, no API key 
  needed, QR-code session auth)
- FAISS vector index of embedded messages (using sentence-transformers, local, free) 
  for semantic search + RAG chatbot
- Hybrid XGBoost pre-filter before the LLM call, to reduce Groq API calls at scale, 
  with SHAP explainability
- Feedback loop: user corrections (marking a match wrong) retrain/adjust future 
  classification

═══════════════════════════════════════════════════════════════
STEP-BY-STEP: WHAT HAPPENS END TO END (CURRENT, GMAIL-ONLY)
═══════════════════════════════════════════════════════════════

1. USER AUTHENTICATES GMAIL
   - Frontend Settings page → "Connect" button → redirects to 
     http://localhost:3001/auth/google
   - Google OAuth2 consent screen → user approves scope: gmail.readonly
   - Google redirects to http://localhost:3001/auth/google/callback
   - Backend exchanges auth code for access_token + refresh_token
   - refresh_token is persisted in MongoDB (users/auth_tokens collection) so 
     re-authentication isn't required on every server restart
   - Backend redirects to FRONTEND_URL (http://localhost:3000) with a success indicator
   - Frontend re-fetches /api/auth/status and updates the Connected Platforms UI

2. USER DEFINES A SIGNAL
   - Frontend Watchlist page → "+ Add New Signal" → modal with a single context 
     textarea (no keyword/type/platform fields exposed — platform is hardcoded to 
     'gmail' for now)
   - POST /api/signals { context: "..." } → stored in MongoDB signals collection with 
     { context, platform: 'gmail', createdAt, matchCount: 0, lastMatched: null }

3. MESSAGE INGESTION + MATCHING
   - Gmail messages fetched via gmail.users.messages.list + messages.get 
     (server/gmail/fetchMessages.js), using the authenticated oauth2Client (not a raw 
     access token string — this must be the actual OAuth2Client instance with 
     credentials set, passed as the `auth` param to google.gmail())
   - For each fetched message, loop through all active signals
   - For each message × signal pair, call checkSignalMatch() 
     (server/agents/matchSignal.js) — one Groq API call, model llama-3.3-70b-versatile, 
     prompt asks the LLM to reason step by step about user intent vs superficial 
     keyword overlap, and return strict JSON: 
     { reasoning, matched, confidence, summary }
   - If matched, message doc is updated with matchedSignalId(s) (array, since a 
     message could match multiple signals), summary, reasoning, confidence
   - Messages are upserted into MongoDB (by source + externalId) to avoid duplicates 
     on repeated fetches

4. USER VIEWS RESULTS
   - Important tab: GET /api/messages/important → messages where matched: true, 
     sorted by date desc. Each card shows sender, AI-generated summary (not raw 
     preview text), confidence badge, and a collapsed "why this matched" section 
     revealing the reasoning field on click
   - All Inbox tab: GET /api/messages/inbox → everything, unfiltered, with platform 
     filter chips (currently only Gmail is real; WhatsApp chips exist in UI 
     but have no real data) and a "Matched only" toggle
   - Archive tab: GET /api/messages/archive → messages the user marked as read/handled 
     (PATCH /api/messages/:id/archive), each showing time since archived and time 
     remaining before auto-deletion; a scheduled node-cron job runs periodically and 
     deletes archived messages older than 4 days; PATCH /api/messages/:id/restore 
     reverses this

5. WATCHLIST/SIGNALS PAGE (management)
   - GET /api/signals — lists all signals with matchCount and lastMatched, so the user 
     can see which signals are actually firing vs sitting unused
   - DELETE /api/signals/:id — removes a signal

═══════════════════════════════════════════════════════════════
TECH STACK
═══════════════════════════════════════════════════════════════

Frontend: React 19, Vite, TypeScript, Tailwind CSS, Recharts (for Analytics charts, 
still on mock data, not yet wired)
Backend: Node.js, Express.js
Database: MongoDB Atlas (mongodb native driver, not Mongoose)
Auth: Google OAuth2 via googleapis library, refresh_token persisted in MongoDB
LLM: Groq API (llama-3.3-70b-versatile) for intent-based signal matching and 
summarization
Scheduling: node-cron (archive auto-pruning every few hours)
Planned but not yet integrated: FAISS (semantic search/RAG), sentence-transformers 
(local embeddings, free), XGBoost + SHAP (hybrid pre-filter + explainability), Baileys 
(WhatsApp)

═══════════════════════════════════════════════════════════════
ENVIRONMENT VARIABLES (.env, never committed — gitignored)
═══════════════════════════════════════════════════════════════

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback
FRONTEND_URL=http://localhost:3000
MONGODB_URI=
GROQ_API_KEY=
PORT=3001                   (backend; frontend runs on 3000 via Vite)

═══════════════════════════════════════════════════════════════
KEY FILES (as of current state)
═══════════════════════════════════════════════════════════════

server/index.js — Express app entry, route mounting
server/authRoutes.js — OAuth flow, callback, triggers initial Gmail sync post-auth
server/db.js — MongoDB connection singleton
server/gmail/auth.js — OAuth2Client setup, token exchange
server/gmail/fetchMessages.js — Gmail message fetch + save to MongoDB
server/agents/matchSignal.js — LLM-based signal matching (Groq call, reasoning prompt)
server/routes/signals.js (or equivalent) — Signal CRUD routes
server/routes/messages.js (or equivalent) — inbox/important/archive routes
frontend: pages for Important, All Inbox, Watchlist (Signals), Analytics (mock data 
still), Archive, Settings; components for message cards, Add Signal modal, chatbot 
bubble (UI only, not functional yet)

═══════════════════════════════════════════════════════════════
KNOWN RESOLVED ISSUES (context, don't re-diagnose these)
═══════════════════════════════════════════════════════════════

- Backend must be started as a distinct process from frontend (npm run dev:server 
  runs node server/index.js on port 3001; npm run dev runs Vite frontend on port 3000) 
  — these were previously conflated and caused ECONNREFUSED errors
- Gmail API calls must use the authenticated oauth2Client object as the `auth` param 
  to google.gmail(), never a raw access_token string — passing a string causes it to 
  be misinterpreted as an API key (`key=` query param) instead of a Bearer token, 
  causing 401 errors
- Google Cloud OAuth consent screen must be set to "External" user type (not 
  "Internal") for personal Gmail accounts to authenticate, with the testing account 
  added under "Test users"

═══════════════════════════════════════════════════════════════
WHAT'S EXPLICITLY OUT OF SCOPE RIGHT NOW
═══════════════════════════════════════════════════════════════

Do not build or wire: WhatsApp ingestion, the chatbot's actual RAG 
functionality, FAISS embeddings, XGBoost pre-filtering, Analytics page real data. All 
of these are planned next phases, not current work. Current focus is exclusively: 
Gmail ingestion → LLM-based signal matching → Important/Inbox/Archive tabs working 
correctly and reliably before any of the above is touched.