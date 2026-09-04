# How messages are fetched & matched

This document explains the Gmail fetch and matching lifecycle in DailyEz — how
messages are pulled, matched against signals, and exposed in the feeds. WhatsApp
messages use the same matching pipeline after local Baileys ingestion.

---

## 1. The trigger points

There are **three** ways a Gmail fetch can start:

| Trigger | When | How many messages requested | Where |
|---------|------|----------------------------|-------|
| **Periodic (cron)** | Every **15 minutes** | `fetchAndStoreGmailMessages(50)` | `server/index.js` → `cron.schedule('*/15 * * * *', ...)` |
| **Manual refresh button** | When you click the refresh icon next to **Watchlist** in the UI | `POST /api/gmail/fetch` → `fetchAndStoreGmailMessages()` (default = **50**) | `src/components/WatchlistTab.tsx` → `server/index.js` |
| **On adding a new signal** | Right after you save a new watchlist signal | `fetchAndStoreGmailMessages(50)` + `recheckAllMessagesAgainstSignals()` + `recheckKeywordMatches()` (fire-and-forget) | `server/index.js` → `POST /api/signals` |

> All three eventually call the same core function:
> `fetchAndStoreGmailMessages(maxResults = 50)` in `server/gmail/fetchMessages.js`.

---

## 2. How many mails are fetched

- **Page size:** `PAGE_SIZE = Math.min(maxResults, 100)` → with the default **50**,
  each Gmail API `list` call returns **50** message pointers.
- **Total cap per run:** `MAX_TOTAL = 500`. The loop keeps paginating
  (`nextPageToken`) until there are no more pages **or** 500 message pointers
  have been examined — whichever comes first.
- **So per fetch cycle:** the code *lists* up to **500** message headers, but it
  only *downloads full details + runs matching* on messages it hasn't already
  processed.

### Deduplication (why you don't get duplicates)

Each message is keyed by its unique Gmail **message id**.

- Before processing, the code checks if the message already exists in MongoDB.
- If it already exists **and already has matches** (`signalMatches.length > 0`),
  it is **skipped** — details are not re-downloaded, no LLM is re-run, and the
  match counter is **not** incremented again.
- If a message id is in the archived/pruned list (`deletedMessageIds`), it is
  permanently skipped so archived mails never come back.

> Practical result: each *new* email is matched **once** on its first fetch.
> The fetch cycle that finds 40 brand-new mails will only LLM-match those 40,
> not re-match the thousands already stored.

---

## 3. The matching pipeline (per new message)

For every **new** message that is downloaded, two pipelines run:

### Pipeline A — Keyword pre-filter / keyword match (cheap, no LLM)

`matchMessageAgainstAllSignals()` in `server/agents/keywordMatch.js` and
`keywordPreFilter()` in `server/gmail/fetchMessages.js`:

- A fast, deterministic keyword scan of the sender/subject/body.
- Flags `keywordMatched` and stores keyword matches — this is what lights up
  messages in **All Inbox**.

### Pipeline B — LLM intent matching (expensive, per signal)

`checkSignalMatch()` in `server/agents/matchSignal.js` calls **Groq**
(model `llama-3.3-70b-versatile` by default, override with `GROQ_MATCH_MODEL`).

For each signal, the email is only sent to the LLM if it **passes the keyword
pre-filter** first (saves token cost on obviously irrelevant mail). The flow:

1. **Source-intent signals** (e.g. `"mails from Polaris"` — recognized at signal
   creation by `parseSignalEntity.js`) skip the LLM entirely and use
   deterministic domain/sender matching via `matchSourceSignal()`.
2. **Topic / event signals** go through the LLM, which decides:
   - `matched` (true/false)
   - `confidence` (high / medium / low)
   - `reasoning` (why it matched)
   - `summary` (one-line summary)

A **100ms sleep** is inserted between consecutive LLM calls to avoid rate limits.
On a `429` rate-limit it waits **5s** and retries **once**.

### Storage

The result is upserted into the `messages` collection:

- `matched` + `signalMatches[]` (for intent matches)
- `keywordMatched` + `keywordSignalMatches[]` (for keyword matches)
- `spam`, `status`, timestamps

The Matched / Priority feed reads messages where
`matched = true`, filters out archived ones, and keeps only the ones matching a
signal that is currently switched **on** — see `GET /api/messages/important`.

---

## 4. The time lag

| Delay | Value | Notes |
|-------|-------|-------|
| **Periodic fetch interval** | Every **15 minutes** | A new mail can sit un-fetched for up to **~15 min** before the cron picks it up. |
| **Manual refresh** | **Instant** on click | The Watchlist refresh button calls `POST /api/gmail/fetch` immediately — this is why it exists. |
| **LLM matching latency** | ~seconds to ~a minute | Per-message: one Groq call per candidate signal (~1–3s each) + 100ms sleeps + possible 5s rate-limit backoff. Many new mails × many signals adds up. |
| **On new signal** | Immediate | Adding a signal triggers a fetch + re-check of all existing stored mails, so matches appear without waiting for the cron. |

> **Worst case wait for a new match:** a mail arrives right after a cron run →
> it waits **15 minutes**, then is fetched and matched by the LLM within a few
> seconds. **Best case:** you hit the refresh button → it appears within
> seconds (LLM matching time).

---

## 5. Totals & consistency

- **Fetched list per cycle:** up to **500** message headers (paged).
- **New mails actually matched per cycle:** only the new ones (dedup by id);
  typically a handful out of a busy inbox.
- **LLM calls per cycle:** ≤ (# new messages) × (# signals that pass the
  pre-filter). Capped in practice by `MAX_TOTAL = 500` message pointers.
- **Feeds/endpoints:**
  - Matched tab → `GET /api/messages/important` (only `matched = true`,
    non-archived, active signals).
  - All Inbox → `GET /api/messages/inbox`.
  - Archive → `GET /api/messages/archive`.

---

## 6. Why the sidebar "match count" now matches the tab

Previously, the Watchlist sidebar showed `signal.matchCount`, a **cumulative
counter** that only ever incremented (`$inc`) and was never decremented when
mails were archived, signals deleted, or matches cleared. That's why it could
show **4** while only **2** matched mails were actually displayed.

`GET /api/signals` now **recomputes** a true, live count for each signal by
counting the actual current non-archived, matched messages that reference that
signal — keeping the sidebar number identical to what the Matched tab shows.

