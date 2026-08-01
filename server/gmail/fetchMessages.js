import { google } from 'googleapis';
import { getCollection } from '../db.js';
import { getAuthenticatedOAuthClient } from '../auth.js';
import { checkSignalMatch } from '../agents/matchSignal.js';
import { matchMessageAgainstAllSignals } from '../agents/keywordMatch.js';

/**
 * Common English stop words to filter out from signal context keywords.
 * These are query-construction words that won't appear in actual emails.
 */
const STOP_WORDS = new Set([
  'show', 'find', 'tell', 'give', 'need', 'want', 'like', 'look',
  'this', 'that', 'these', 'those', 'with', 'from', 'have', 'has',
  'been', 'will', 'would', 'could', 'should', 'shall', 'must',
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose',
  'about', 'into', 'over', 'after', 'before', 'between', 'under',
  'just', 'also', 'very', 'than', 'then', 'more', 'some', 'such',
  'only', 'other', 'than', 'they', 'them', 'their', 'were',
  'your', 'youre', 'yours', 'itself', 'being', 'doing',
  'alert', 'every', 'each', 'both', 'most', 'many',
]);

/**
 * Simple keyword pre-filter to reduce LLM API calls.
 * Returns true if the message might match the signal context.
 * This is a cheap check before calling the expensive LLM.
 */
function keywordPreFilter(message, signalContext) {
  const text = (message.from + ' ' + message.subject + ' ' + message.content).toLowerCase();
  const context = signalContext.toLowerCase();

  // Extract meaningful key terms from the signal context:
  // 1. Words longer than 3 chars
  // 2. Exclude common English stop words (query-construction words that won't appear in emails)
  const keyTerms = context.split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));

  // If no meaningful key terms remain, let the message through to the LLM
  if (keyTerms.length === 0) return true;

  // If the signal context mentions specific domains/companies, check for those
  const domainMatch = context.match(/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.[a-z]{2,}/g);
  if (domainMatch) {
    for (const domain of domainMatch) {
      if (text.includes(domain)) return true;
    }
  }

  // Check if at least 1 key term appears in the message
  for (const term of keyTerms) {
    if (text.includes(term)) {
      return true;
    }
  }

  return false;
}

/**
 * Sleep helper for rate limit backoff
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetches ALL Gmail messages (paginated) and stores them in MongoDB.
 * Gmail API free tier allows up to 1 billion queries per day for most apps,
 * so pagination is fine. We fetch up to 500 messages per run to stay within
 * reasonable limits.
 */
export async function fetchAndStoreGmailMessages(maxResults = 50, oauth2ClientArg = null) {
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

  let totalFetched = 0;
  let matchedCount = 0;
  let llmCalls = 0;
  let pageToken = null;

  // Fetch in pages — up to 500 messages total to avoid rate limits
  const MAX_TOTAL = 500;
  const PAGE_SIZE = Math.min(maxResults, 100);

  do {
    const params = { userId: 'me', maxResults: PAGE_SIZE };
    if (pageToken) params.pageToken = pageToken;

    const response = await gmail.users.messages.list(params);
    const messages = response.data.messages || [];
    pageToken = response.data.nextPageToken || null;

    if (messages.length === 0) break;

    // Process this page of messages
    for (const message of messages) {
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

      const details = await gmail.users.messages.get({ userId: 'me', id: message.id });
      const payload = details.data.payload || {};
      const headers = payload.headers || [];
      const subject = headers.find((header) => header.name === 'Subject')?.value || 'No subject';
      const sender = headers.find((header) => header.name === 'From')?.value || 'Unknown sender';
      const body = details.data.snippet || '';
      const timestamp = details.data.internalDate ? new Date(Number(details.data.internalDate)) : new Date();

      // Build normalized message for matching
      const normalizedMessage = {
        from: sender,
        subject,
        content: body,
      };

      // ─── PIPELINE 1: Keyword matching (deterministic, no LLM) ───
      const keywordMatches = matchMessageAgainstAllSignals(normalizedMessage, signals);
      const keywordMatched = keywordMatches.length > 0;

      // ─── PIPELINE 2: LLM intent matching (existing) ───
      const matches = [];
      for (const signal of signals) {
        // Pre-filter: skip LLM call if message doesn't contain relevant keywords
        if (!keywordPreFilter(normalizedMessage, signal.context)) {
          continue;
        }

        try {
          llmCalls++;
          const result = await checkSignalMatch(normalizedMessage, signal);
          if (result.matched) {
            matches.push({
              matchedSignalId: signal._id,
              context: signal.context,
              summary: result.summary,
              reasoning: result.reasoning,
              confidence: result.confidence,
            });
          }
          // Small delay between LLM calls to avoid rate limiting
          await sleep(100);
        } catch (err) {
          // Handle rate limiting with backoff
          if (err.status === 429) {
            console.log(`Rate limited on signal ${signal._id}, waiting 5s...`);
            await sleep(5000);
            // Retry once
            try {
              const result = await checkSignalMatch(normalizedMessage, signal);
              if (result.matched) {
                matches.push({
                  matchedSignalId: signal._id,
                  context: signal.context,
                  summary: result.summary,
                  reasoning: result.reasoning,
                  confidence: result.confidence,
                });
              }
            } catch (retryErr) {
              console.error(`Retry failed for signal ${signal._id} against message ${message.id}:`, retryErr.message);
            }
          } else {
            console.error(`Failed to check signal ${signal._id} against message ${message.id}:`, err.message);
          }
        }
      }

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
            content: body,
            timestamp,
            matched: matches.length > 0,
            signalMatches: matches.length > 0 ? matches : [],
            keywordMatched,
            keywordSignalMatches: keywordMatches.length > 0 ? keywordMatches : [],
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

  return { count: totalFetched, matchedCount, llmCalls };
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
    return { checkedCount: 0, matchedCount: 0, llmCalls: 0 };
  }

  // Get all messages that don't already have matches for all current signals
  const allMessages = await messagesCollection.find({
    $or: [
      { signalMatches: { $exists: false } },
      { signalMatches: { $size: 0 } },
    ]
  }).toArray();

  console.log(`Re-checking ${allMessages.length} existing messages against ${signals.length} signals...`);

  let checkedCount = 0;
  let matchedCount = 0;
  let llmCalls = 0;

  for (const message of allMessages) {
    const normalizedMessage = {
      from: message.from || '',
      subject: message.subject || '',
      content: message.content || '',
    };

    const newMatches = [];
    for (const signal of signals) {
      // Pre-filter: skip LLM call if message doesn't contain relevant keywords
      if (!keywordPreFilter(normalizedMessage, signal.context)) {
        continue;
      }

      try {
        llmCalls++;
        const result = await checkSignalMatch(normalizedMessage, signal);
        if (result.matched) {
          newMatches.push({
            matchedSignalId: signal._id,
            context: signal.context,
            summary: result.summary,
            reasoning: result.reasoning,
            confidence: result.confidence,
          });
        }
        // Small delay between LLM calls to avoid rate limiting
        await sleep(100);
      } catch (err) {
        if (err.status === 429) {
          console.log(`Rate limited on signal ${signal._id}, waiting 5s...`);
          await sleep(5000);
          try {
            const result = await checkSignalMatch(normalizedMessage, signal);
            if (result.matched) {
              newMatches.push({
                matchedSignalId: signal._id,
                context: signal.context,
                summary: result.summary,
                reasoning: result.reasoning,
                confidence: result.confidence,
              });
            }
          } catch (retryErr) {
            console.error(`Retry failed for signal ${signal._id} against message ${message._id}:`, retryErr.message);
          }
        } else {
          console.error(`Failed to check signal ${signal._id} against message ${message._id}:`, err.message);
        }
      }
    }

    if (newMatches.length > 0) {
      matchedCount++;
    }

    // Merge new matches with any existing matches
    const existingMatches = message.signalMatches || [];
    const allMatches = [...existingMatches, ...newMatches];

    await messagesCollection.updateOne(
      { _id: message._id },
      {
        $set: {
          matched: allMatches.length > 0,
          signalMatches: allMatches,
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

  console.log(`Re-check complete: ${checkedCount} checked, ${matchedCount} new matches, ${llmCalls} LLM calls`);
  return { checkedCount, matchedCount, llmCalls };
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

  // Get all messages (regardless of existing keyword matches)
  const allMessages = await messagesCollection.find({}).toArray();

  console.log(`Re-checking ${allMessages.length} existing messages for keyword matches against ${signals.length} signals...`);

  let checkedCount = 0;
  let matchedCount = 0;

  for (const message of allMessages) {
    const normalizedMessage = {
      from: message.from || '',
      subject: message.subject || '',
      content: message.content || '',
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
