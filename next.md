# DailyEz Next Steps

DailyEz is the main product name. `SignalStream` still appears in some older UI text and code, but that is legacy naming. This document explains what is already working, what is still only a placeholder, and what we should build next.

## 1. What the app is right now

DailyEz is a Gmail-first dashboard that:

- Lets a user connect Gmail with Google OAuth
- Lets the user describe what matters to them in plain language
- Fetches Gmail messages from the backend
- Sends each message and each active signal to Groq for intent-based matching
- Shows matched messages in the Important/Matched area
- Shows all messages in the Inbox area
- Lets the user archive and restore messages
- Shows connection status for Gmail, WhatsApp, and Discord

Only Gmail is real today. WhatsApp and Discord are still placeholders.

## 2. What is already working

These parts are already present in the codebase:

- The frontend runs in Vite on port `3000`
- The backend runs in Express on port `3001`
- Google OAuth login exists for Gmail
- MongoDB is used to store users, signals, and messages
- Gmail messages can be fetched and saved
- Signal matching uses Groq and returns:
  - `reasoning`
  - `matched`
  - `confidence`
  - `summary`
- The UI has screens for:
  - Watchlist
  - Matched / Priority Feed
  - All Inbox
  - Archive
  - Settings

## 3. What is still placeholder or mock-based

These parts are not fully real yet:

- Analytics is mostly mock data
- The floating chatbot is only UI for now
- WhatsApp connection is not implemented
- Discord connection is not implemented
- Some dashboard panels still use mock data for charts or watchlist summaries
- Some UI labels still mention `SignalStream`

That means the next work should focus on making the Gmail path reliable before adding anything new.

## 4. What should happen next

Build the remaining Gmail-first version in this order.

### Step 1: Make Gmail auth and sync reliable

This is the most important step.

What must happen:

- When the user clicks Connect Gmail, the app should start the Google OAuth flow
- After the user approves access, the backend should store the refresh token in MongoDB
- The backend should use the real OAuth client when calling Gmail APIs
- Fetching messages should not create duplicate records every time the sync runs
- After sync, the UI should refresh connection status and loaded messages

How it works:

- The user opens Settings and clicks Connect on Gmail
- The browser goes to Google's consent screen
- Google sends the user back to the backend callback route
- The backend saves the refresh token and user profile info
- The backend fetches recent Gmail messages
- Each message is stored in MongoDB once, keyed by its source and external Gmail ID

Why this matters:

- If auth is unstable, nothing else in the app can be trusted
- If sync creates duplicates, the Important and Inbox views will become confusing very fast

### Step 2: Make message data consistent

We need one clear message shape so the frontend and backend always agree.

What must happen:

- Every message should have the same core fields, such as:
  - `id`
  - `source`
  - `from`
  - `subject`
  - `content`
  - `timestamp`
  - `matched`
  - `signalMatches`
  - `status`
  - `archivedAt`
- Matched messages should store:
  - summary
  - reasoning
  - confidence
  - matched signal IDs
- Archive state should be clearly tracked
- Timestamps should always be real dates, not mixed strings and mock values

How it works:

- Gmail fetch normalizes each message
- Signal matching adds match details only when a signal really matches
- Archive actions update the same message record instead of creating a separate copy

Why this matters:

- The frontend already expects matching data in several places
- A single consistent schema makes the app easier to debug and much easier to extend later

### Step 3: Make the main screens fully use real backend data

The goal is for the core tabs to reflect actual stored data, not mock samples.

What must happen:

- Important / Matched should show only messages where `matched = true`
- All Inbox should show all fetched Gmail messages
- Archive should show archived messages only
- Settings should show real Gmail connection status
- The Watchlist screen should show real signal records from MongoDB

How it works:

- Frontend components call the API layer in `src/lib/api.ts`
- API responses are rendered directly in the dashboard
- Buttons like archive, restore, add signal, and delete signal should update the database and then refresh the screen

Why this matters:

- This is the point where the app becomes useful instead of just looking finished

### Step 4: Keep WhatsApp and Discord as placeholders

Do not build them yet.

What should happen now:

- Their buttons and labels can stay in the UI
- Their connection status can remain false or stubbed
- Their real ingestion logic should not be added yet

Why this matters:

- Gmail needs to be stable first
- Adding more platforms too early will make debugging harder

### Step 5: Leave analytics and chatbot work for later

These are future phases only.

Do not build yet:

- Real analytics
- FAISS search
- RAG chatbot behavior
- XGBoost pre-filtering
- SHAP explainability

Why this matters:

- These features depend on a clean message pipeline
- If the base data flow is not solid, advanced features will only hide problems

## 5. How the main user flow should work

### Connect Gmail

1. User opens Settings
2. User clicks Connect on Gmail
3. Google shows the OAuth consent screen
4. User approves access
5. Backend stores the refresh token in MongoDB
6. Backend fetches Gmail messages
7. Frontend shows Gmail as connected

### Add a signal

1. User opens Watchlist
2. User clicks Add New Signal
3. User writes a natural-language intent, like "Alert me when I get a real interview invitation"
4. Backend stores that text as a Gmail signal
5. The signal gets a match count and last matched time later when messages are processed

### Fetch messages

1. Backend gets recent Gmail messages
2. Each message is normalized into a common format
3. Each message is compared with each signal
4. Groq decides whether the message truly matches the user's intent
5. If matched, the backend stores:
   - summary
   - reasoning
   - confidence
   - signal match details

### View results

1. Important shows only matched messages
2. Inbox shows all messages
3. Archive shows messages the user archived
4. Archived messages can be restored before deletion
5. A cleanup job removes archived messages after 4 days

## 6. Where to look in the code

If you are trying to understand the app, start here:

- `server/index.js` for backend routes and app startup
- `server/authRoutes.js` for Google OAuth and auth status
- `server/gmail/fetchMessages.js` for Gmail fetching and storage
- `server/agents/matchSignal.js` for Groq-based signal matching
- `server/db.js` for MongoDB connection setup
- `src/lib/api.ts` for frontend API calls
- `src/DashboardLayout.tsx` for how the tabs are assembled
- `src/components/WatchlistTab.tsx` for signal creation and deletion
- `src/components/MatchedTab.tsx` for matched message display
- `src/components/InboxFeed.tsx` for the all-inbox view
- `src/components/ArchiveTab.tsx` for archive behavior
- `src/components/SettingsTab.tsx` for Gmail connection and profile status

## 7. What success looks like

The Gmail-first phase is done when:

- Gmail auth works every time
- Refresh tokens are saved and reused correctly
- New Gmail messages are synced without duplicates
- Signals can be added and deleted from the UI
- Matched messages show their summary, reasoning, and confidence
- Inbox, Important, and Archive all show the correct real data
- Archived messages can be restored
- Old archived messages are deleted automatically after 4 days
- WhatsApp, Discord, analytics, and chatbot remain clearly marked as future work

## 8. Final rule for the next phase

Before adding any new platform or advanced AI feature, finish the Gmail pipeline completely and test it end to end.
