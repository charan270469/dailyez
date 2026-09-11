// Gmail ingestion + matching: fetches messages via the Gmail API, stores each once in
// MongoDB, runs LLM/source/keyword matching, and exposes re-check and backfill helpers.
import { google } from 'googleapis';
import { getCollection } from '../db.js';
import { getAuthenticatedOAuthClient } from '../auth.js';
import { signalMessageMatches, getPendingSignals } from '../agents/signalMatching.js';
import { matchMessageAgainstAllSignals } from '../agents/keywordMatch.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Gmail fetch window ───
// Only the last GMAIL_FETCH_WINDOW_DAYS days of Gmail history are fetched. The
// cutoff is pushed down to the Gmail API itself as a search query
// (`after:YYYY/MM/DD`), so the API only returns messages inside the window —
// no client-side filtering and no paging through older mail. This only limits
// what NEW messages syncs ingest going forward; already-stored messages are
// never pruned by this setting (archived-message cleanup is a separate cron in
// server/index.js). Defaults to 30.
const GMAIL_FETCH_WINDOW_DAYS = (() => {
  const raw = Number(process.env.GMAIL_FETCH_WINDOW_DAYS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30;
})();

/**
 * Gmail `after:` cutoff date for the fetch window, formatted for Gmail's
 * search-query syntax (`YYYY/MM/DD`, e.g. 2026/08/12).
 *
 * @param {number} windowDays - window size in days (defaults to the configured value)
 * @param {Date}   now        - bucket time (test determinism)
 * @returns {string} YYYY/MM/DD date, `windowDays` days before `now`
 */
export function gmailFetchAfterDate(windowDays = GMAIL_FETCH_WINDOW_DAYS, now = new Date()) {
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const yyyy = cutoff.getFullYear();
  const mm = String(cutoff.getMonth() + 1).padStart(2, '0');
  const dd = String(cutoff.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

// ─── Full-body extraction ───
// Gmail's `snippet` is a short (~150 char) preview, so signal-matching detail
// (interview info, JD content, role specifics) that sits further down the email
// is invisible to the matcher when only the snippet is used. To fix that we
// fetch the full MIME payload (`format: 'full'`) and reduce it to readable
// plain text: text/plain parts are preferred when present (Gmail usually ships
// both a text/plain and text/html alternative); text/html is stripped to text
// only when no plain part exists.

function decodeBodyData(data) {
  if (!data) return '';
  // Gmail body.data is base64url — URL-safe alphabet, padding omitted.
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/');
}

function normalizeWhitespace(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function collectTextParts(part, collected) {
  if (!part || typeof part !== 'object') return;
  const mimeType = (part.mimeType || '').toLowerCase();
  if (part.body && part.body.data) {
    if (mimeType === 'text/plain') {
      collected.plain.push(decodeBodyData(part.body.data));
    } else if (mimeType === 'text/html') {
      collected.html.push(decodeBodyData(part.body.data));
    }
  }
  if (Array.isArray(part.parts)) {
    for (const sub of part.parts) collectTextParts(sub, collected);
  }
}

/**
 * Extracts readable plain text from a Gmail message payload
 * (`details.data.payload` from `users.messages.get` with `format: 'full'`).
 * Preferred: concatenated text/plain parts. Fallback: text/html parts with
 * tags stripped and common HTML entities decoded.
 *
 * @param {Object|undefined} payload - the message MIME payload
 * @returns {string} extracted plain text ('' when nothing usable is found)
 */
export function extractBodyText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const collected = { plain: [], html: [] };
  collectTextParts(payload, collected);
  let text = '';
  if (collected.plain.length > 0) {
    text = collected.plain.join('\n');
  } else if (collected.html.length > 0) {
    text = decodeHtmlEntities(stripHtml(collected.html.join('\n')));
  }
  return normalizeWhitespace(text).trim();
}

/**
 * Gmail message IDs are opaque base64url-ish strings; WhatsApp records use
 * numeric ids and must never be sent to the Gmail API.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isGmailMessageId(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length < 10 || !/[A-Za-z]/.test(trimmed)) return false;
  return /^[A-Za-z0-9_-]+$/.test(trimmed);
}

/**
 * Marks Gmail message IDs as deleted so they are never re-fetched
 * from Gmail or re-matched against signals.
 *
 * @param {string[]} ids - Gmail message IDs to mark as deleted
 * @returns {Promise<{ marked: number }>}
 */
export async function markMessageIdsAsDeleted(ids) {
  if (!ids || ids.length === 0) return { marked: 0 };

  const deletedCollection = await getCollection('deletedMessageIds');
  const now = new Date();

  const ops = ids.map(id => ({
    updateOne: {
      filter: { id },
      update: { $setOnInsert: { id, deletedAt: now } },
      upsert: true,
    },
  }));

  const result = await deletedCollection.bulkWrite(ops);
  return { marked: result.upsertedCount };
}

/**
 * Loads the set of Gmail message IDs that should never be re-fetched.
 *
 * @returns {Promise<Set<string>>}
 */
export async function getDeletedMessageIds() {
  const deletedCollection = await getCollection('deletedMessageIds');
  const docs = await deletedCollection.find({}, { projection: { id: 1 } }).toArray();
  return new Set(docs.map(d => d.id));
}

// Overlap guard — a simple in-flight flag so only one Gmail sync runs at a time.
// With the cron firing every 2 minutes, a cycle can easily still be running when
// the next tick fires (or a manual refresh / new-signal fetch arrives). Any
// trigger that fires while a sync is in flight is skipped and logged instead of
// running two overlapping syncs that would duplicate Gmail round-trips and Groq
// calls.
let gmailSyncInFlight = false;

/**
 * Fetches ALL Gmail messages (paginated) and stores them in MongoDB.
 * Gmail API free tier allows up to 1 billion queries per day for most apps,
 * so pagination is fine. We fetch up to 500 messages per run to stay within
 * reasonable limits.
 *
 * Guarded by the in-flight flag above: if a sync is already running when this is
 * called (cron tick, manual refresh, or new-signal fetch), the call returns
 * `{ skipped: true, reason: 'already-in-progress' }` and logs it instead of
 * overlapping the running sync. The flag is always released in `finally`, so a
 * failed sync never wedges the guard.
 */
export async function fetchAndStoreGmailMessages(maxResults = 50, oauth2ClientArg = null) {
  if (gmailSyncInFlight) {
    console.log('[gmail-sync] Skipped Gmail sync: a sync is already in progress');
    return { skipped: true, count: 0, matchedCount: 0, llmCalls: 0, skippedUnchanged: 0, reason: 'already-in-progress' };
  }
  gmailSyncInFlight = true;
  try {
    return await doFetchAndStoreGmailMessages(maxResults, oauth2ClientArg);
  } finally {
    gmailSyncInFlight = false;
  }
}

async function doFetchAndStoreGmailMessages(maxResults = 50, oauth2ClientArg = null) {
  let gmail;
  if (oauth2ClientArg) {
    gmail = google.gmail({ version: 'v1', auth: oauth2ClientArg });
  } else {
    const authClient = await getAuthenticatedOAuthClient();
    gmail = google.gmail({ version: 'v1', auth: authClient });
  }

  const messagesCollection = await getCollection('messages');
  const signalsCollection = await getCollection('signals');
  const signals = await signalsCollection.find({}).toArray();

  // Load the set of Gmail message IDs that must never be re-fetched
  // (archived/pruned messages). This prevents deleted mails from being
  // pulled back in and re-matched against signals.
  const deletedIds = await getDeletedMessageIds();

  // Build the Gmail search query once for this sync so every page shares the
  // same cutoff — a midnight crossing between pages must not shift the window
  // mid-run. `after:YYYY/MM/DD` (Gmail search syntax) makes the Gmail API
  // itself skip anything older than the configured window instead of fetching
  // it and filtering client-side.
  const gmailQuery = `after:${gmailFetchAfterDate()}`;
  console.log(`[gmail-sync] Gmail fetch window: last ${GMAIL_FETCH_WINDOW_DAYS} day(s) (query: "${gmailQuery}")`);

  let totalFetched = 0;
  let matchedCount = 0;
  let llmCalls = 0;
  let skippedUnchanged = 0;
  let pageToken = null;

  // Fetch in pages — up to 500 messages total to avoid rate limits
  const MAX_TOTAL = 500;
  const PAGE_SIZE = Math.min(maxResults, 100);

  do {
    const params = { userId: 'me', maxResults: PAGE_SIZE, q: gmailQuery };
    if (pageToken) params.pageToken = pageToken;

    const response = await gmail.users.messages.list(params);
    const messages = response.data.messages || [];
    pageToken = response.data.nextPageToken || null;

    if (messages.length === 0) break;

    // Process this page of messages
    for (const message of messages) {
      // Skip messages that were archived/pruned — they must never be re-fetched
      if (deletedIds.has(message.id)) {
        totalFetched++;
        continue;
      }

      // Check if we already have this message
      const existing = await messagesCollection.findOne({ id: message.id });

      // Skip if already processed with matches (has actual signalMatches data)
      if (existing && existing.signalMatches && existing.signalMatches.length > 0) {
        totalFetched++;
        continue;
      }

      // Skip if already processed and has no signals (no point re-checking if no signals exist)
      if (existing && signals.length === 0) {
        totalFetched++;
        continue;
      }

      // An already-stored, still-unmatched message is only re-evaluated against
      // signals it has NOT seen before (lastEvaluatedSignalIds). If every current
      // signal was already checked against it, skip it entirely — it costs zero
      // Groq calls and skips even the Gmail details HTTP round-trip.
      const lastEvaluatedSignalIds = existing?.lastEvaluatedSignalIds || [];
      if (existing && getPendingSignals(signals, lastEvaluatedSignalIds).length === 0) {
        skippedUnchanged++;
        totalFetched++;
        continue;
      }

      // `format: 'full'` returns the whole MIME payload, so matchers see the full
      // body instead of the short snippet.
      const details = await gmail.users.messages.get({ userId: 'me', id: message.id, format: 'full' });
      const payload = details.data.payload || {};
      const headers = payload.headers || [];
      const subject = headers.find((header) => header.name === 'Subject')?.value || 'No subject';
      const sender = headers.find((header) => header.name === 'From')?.value || 'Unknown sender';
      // snippet stays the short Gmail preview (UI display); fullBody is the
      // extracted full MIME text used for matching.
      const snippet = details.data.snippet || '';
      const fullBody = extractBodyText(payload) || snippet;
      const timestamp = details.data.internalDate ? new Date(Number(details.data.internalDate)) : new Date();
      const labelIds = details.data.labelIds || [];
      const isSpam = labelIds.includes('SPAM');

      // Build normalized message for matching — full body, not the snippet, so
      // relevant detail below the snippet (interview/JD/role info) can match.
      const normalizedMessage = {
        from: sender,
        subject,
        content: fullBody,
        source: 'gmail',
      };

      // Run the shared signal-matching pipeline against ONLY the signals this
      // message has not been evaluated on yet (identical keyword + source + LLM
      // logic to the one used for WhatsApp messages). First-time messages pass an
      // empty list, so they are evaluated against the entire set once.
      const signalResults = await signalMessageMatches(
        normalizedMessage,
        signals,
        lastEvaluatedSignalIds
      );
      const matches = signalResults.matches;
      const keywordMatches = signalResults.keywordMatches;
      const keywordMatched = signalResults.keywordMatched;
      llmCalls += signalResults.llmCalls;

      // Merge with match state this message already carries so previously
      // evaluated (unchanged) signals keep their stored results.
      const mergedMatches = [...(existing?.signalMatches || []), ...matches];
      const mergedKeywordMatches = [...(existing?.keywordSignalMatches || []), ...keywordMatches];
      const mergedEvaluatedSignalIds = [...lastEvaluatedSignalIds, ...signalResults.evaluatedSignalIds];

      if (matches.length > 0) {
        matchedCount += 1;
      }

      await messagesCollection.updateOne(
        { id: message.id },
        {
          $setOnInsert: { id: message.id },
          $set: {
            source: 'gmail',
            platform: 'gmail',
            from: sender,
            subject,
            content: snippet,
            // Full extracted body — kept separate from the snippet so the UI
            // preview (content) stays short while matchers/reasoning use bodyText.
            bodyText: fullBody,
            timestamp,
            spam: isSpam,
            matched: mergedMatches.length > 0,
            signalMatches: mergedMatches,
            keywordMatched: mergedKeywordMatches.length > 0,
            keywordSignalMatches: mergedKeywordMatches,
            lastEvaluatedSignalIds: mergedEvaluatedSignalIds,
            status: existing?.status || 'active',
            createdAt: existing?.createdAt || new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );

      // Update match counts on matched signals (from LLM matches)
      for (const match of matches) {
        await signalsCollection.updateOne(
          { _id: match.matchedSignalId },
          { $inc: { matchCount: 1 }, $set: { lastMatched: new Date() } }
        );
      }

      totalFetched++;
    }

    // Small delay between pages to avoid rate limiting
    if (pageToken) {
      await sleep(500);
    }
  } while (pageToken && totalFetched < MAX_TOTAL);

  console.log(`Gmail fetch complete: ${totalFetched} listed, ${skippedUnchanged} unmatched messages skipped (no new/changed signals), ${matchedCount} matched, ${llmCalls} LLM calls`);
  return { count: totalFetched, matchedCount, llmCalls, skippedUnchanged };
}

/**
 * Re-checks ALL existing messages in the database against all signals.
 * This is needed when a new signal is added, since existing messages
 * were previously stored without being checked against the new signal.
 * 
 * @returns {Promise<{ checkedCount: number, matchedCount: number, llmCalls: number }>}
 */
export async function recheckAllMessagesAgainstSignals() {
  const messagesCollection = await getCollection('messages');
  const signalsCollection = await getCollection('signals');
  const signals = await signalsCollection.find({}).toArray();

  if (signals.length === 0) {
    console.log('No signals to re-check against');
    return { checkedCount: 0, matchedCount: 0, llmCalls: 0, skippedCount: 0 };
  }

  // Get all messages that don't already have matches for all current signals.
  // Archived messages are excluded — they are scheduled for deletion and must
  // not be re-matched against signals.
  const allMessages = await messagesCollection.find({
    status: { $ne: 'archived' },
    $or: [
      { signalMatches: { $exists: false } },
      { signalMatches: { $size: 0 } },
    ]
  }).toArray();

  console.log(`Re-checking ${allMessages.length} existing messages against ${signals.length} signals...`);

  let checkedCount = 0;
  let matchedCount = 0;
  let llmCalls = 0;
  let skippedCount = 0;

  for (const message of allMessages) {
    const lastEvaluatedSignalIds = message.lastEvaluatedSignalIds || [];

    // Only evaluate against signals this message has not already been evaluated
    // on. Newly created signals are automatically pending; edited signals are
    // made pending again by PATCH /api/signals/:id removing their id from this
    // list. A fully-evaluated message costs zero LLM calls.
    if (getPendingSignals(signals, lastEvaluatedSignalIds).length === 0) {
      skippedCount++;
      continue;
    }

    const normalizedMessage = {
      from: message.from || '',
      subject: message.subject || '',
      content: message.bodyText || message.content || '',
      source: message.source || 'gmail',
      chatId: message.chatId || message.groupJid || message.senderJid || '',
    };

    // Run the shared signal-matching pipeline (keyword + source + LLM intent)
    // against only the pending signals.
    const signalResults = await signalMessageMatches(normalizedMessage, signals, lastEvaluatedSignalIds);
    const newMatches = signalResults.matches;
    llmCalls += signalResults.llmCalls;

    if (newMatches.length > 0) {
      matchedCount++;
    }

    // Merge new matches with any existing matches
    const existingMatches = message.signalMatches || [];
    const allMatches = [...existingMatches, ...newMatches];
    const mergedKeywordMatches = [...(message.keywordSignalMatches || []), ...signalResults.keywordMatches];
    const mergedEvaluatedSignalIds = [...lastEvaluatedSignalIds, ...signalResults.evaluatedSignalIds];

    await messagesCollection.updateOne(
      { _id: message._id },
      {
        $set: {
          matched: allMatches.length > 0,
          signalMatches: allMatches,
          keywordMatched: mergedKeywordMatches.length > 0,
          keywordSignalMatches: mergedKeywordMatches,
          lastEvaluatedSignalIds: mergedEvaluatedSignalIds,
          updatedAt: new Date(),
        },
      }
    );

    // Update match counts on matched signals
    for (const match of newMatches) {
      await signalsCollection.updateOne(
        { _id: match.matchedSignalId },
        { $inc: { matchCount: 1 }, $set: { lastMatched: new Date() } }
      );
    }

    checkedCount++;
  }

  console.log(`Re-check complete: ${checkedCount} checked, ${matchedCount} new matches, ${llmCalls} LLM calls, ${skippedCount} skipped (no new/changed signals)`);
  return { checkedCount, matchedCount, llmCalls, skippedCount };
}

/**
 * Backfills the spam flag for all existing messages by fetching
 * their Gmail label information. This is needed for messages that
 * were stored before spam detection was added.
 *
 * @returns {Promise<{ checkedCount: number, spamCount: number }>}
 */
export async function backfillSpamFlags() {
  const messagesCollection = await getCollection('messages');
  const authClient = await getAuthenticatedOAuthClient();
  const gmail = google.gmail({ version: 'v1', auth: authClient });

  // Get all Gmail messages that don't have a spam flag yet.
  // Archived messages are excluded — they are scheduled for deletion and must
  // not be re-fetched from Gmail. WhatsApp records are deliberately excluded
  // because their numeric document IDs are not valid Gmail API IDs.
  const allMessages = await messagesCollection.find({
    $or: [{ source: 'gmail' }, { platform: 'gmail' }],
    status: { $ne: 'archived' },
    spam: { $exists: false },
  }).toArray();

  console.log(`Backfilling spam flags for ${allMessages.length} messages...`);

  let checkedCount = 0;
  let spamCount = 0;

  for (const message of allMessages) {
    if (!isGmailMessageId(message.id)) {
      console.log(`Skipping non-Gmail message id during spam backfill: ${String(message.id)}`);
      continue;
    }

    try {
      const details = await gmail.users.messages.get({ userId: 'me', id: message.id });
      const labelIds = details.data.labelIds || [];
      const isSpam = labelIds.includes('SPAM');

      await messagesCollection.updateOne(
        { _id: message._id },
        { $set: { spam: isSpam, updatedAt: new Date() } }
      );

      if (isSpam) spamCount++;
      checkedCount++;
    } catch (err) {
      console.error(`Failed to backfill spam flag for message ${message.id}:`, err.message);
    }

    // Small delay to avoid rate limiting
    await sleep(100);
  }

  console.log(`Spam backfill complete: ${checkedCount} checked, ${spamCount} marked as spam`);
  return { checkedCount, spamCount };
}

/**
 * Re-checks ALL existing messages in the database for keyword matches
 * against all signals. This is cheap (no LLM calls) and runs synchronously.
 * Needed when a new signal with keywords is added.
 *
 * @returns {Promise<{ checkedCount: number, matchedCount: number }>}
 */
export async function recheckKeywordMatches() {
  const messagesCollection = await getCollection('messages');
  const signalsCollection = await getCollection('signals');
  const signals = await signalsCollection.find({}).toArray();

  if (signals.length === 0) {
    console.log('No signals to re-check keywords against');
    return { checkedCount: 0, matchedCount: 0 };
  }

  // Get all messages (regardless of existing keyword matches).
  // Archived messages are excluded — they are scheduled for deletion and must
  // not be re-matched against signals.
  const allMessages = await messagesCollection.find({
    status: { $ne: 'archived' },
  }).toArray();

  console.log(`Re-checking ${allMessages.length} existing messages for keyword matches against ${signals.length} signals...`);

  let checkedCount = 0;
  let matchedCount = 0;

  for (const message of allMessages) {
    const normalizedMessage = {
      from: message.from || '',
      subject: message.subject || '',
      content: message.bodyText || message.content || '',
    };

    const keywordMatches = matchMessageAgainstAllSignals(normalizedMessage, signals);
    const keywordMatched = keywordMatches.length > 0;

    if (keywordMatched) {
      matchedCount++;
    }

    // Merge with existing keyword matches
    const existingKeywordMatches = message.keywordSignalMatches || [];
    const allKeywordMatches = [...existingKeywordMatches, ...keywordMatches];

    await messagesCollection.updateOne(
      { _id: message._id },
      {
        $set: {
          keywordMatched: allKeywordMatches.length > 0,
          keywordSignalMatches: allKeywordMatches.length > 0 ? allKeywordMatches : [],
          updatedAt: new Date(),
        },
      }
    );

    checkedCount++;
  }

  console.log(`Keyword re-check complete: ${checkedCount} checked, ${matchedCount} keyword matches`);
  return { checkedCount, matchedCount };
}
