// Shared signal-matching pipeline used by BOTH Gmail and WhatsApp messages.
// Runs, for a single normalized message, the exact same checks the Gmail path
// used to run inline:
//   - PIPELINE 1: deterministic keyword matching (no LLM)
//   - PIPELINE 2: LLM intent matching (Groq), with source-intent ("emails from X")
//     signals handled with deterministic code-only domain matching and a cheap
//     keyword pre-filter that avoids LLM calls on obviously-unrelated messages.
//
// Centralizing this here guarantees Gmail and WhatsApp messages are matched
// identically against the same set of signals.

import { checkSignalMatch } from './matchSignal.js';
import { matchSourceSignal } from './matchSourceIntent.js';
import { matchMessageAgainstAllSignals } from './keywordMatch.js';
import { getCollection } from '../db.js';

// Common English stop words to filter out from signal context keywords.
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Simple keyword pre-filter to reduce LLM API calls.
 * Returns true if the message might match the signal context.
 * This is a cheap check before calling the expensive LLM.
 *
 * Behavior:
 * - If the signal names a SPECIFIC entity (a proper noun like "ICFAI", "Google",
 *   "@domain.com"), the message only passes when that identifying token actually
 *   appears in the message. Generic words alone are never allowed to push
 *   unrelated content into the LLM.
 * - Otherwise (pure topic/event signals with no named entity) it falls back to the
 *   loose "any single key term" check.
 */
function keywordPreFilter(message, signalContext) {
  const text = (message.from + ' ' + message.subject + ' ' + message.content).toLowerCase();
  const context = signalContext.toLowerCase();

  // Generic descriptor/stop words must never gate matching.
  const GENERIC_WORDS = new Set([
    'college', 'university', 'school', 'institute', 'institution', 'academy',
    'foundation', 'higher', 'education', 'tech', 'technology', 'jobs', 'job',
    'intern', 'internship', 'mail', 'mails', 'email', 'emails', 'from', 'to',
    'the', 'and', 'or', 'my', 'your', 'our', 'about', 'with', 'for', 'gather',
    'collect', 'get', 'show', 'find', 'see', 'watch', 'alert', 'notify',
  ]);

  const words = signalContext.split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9.]/g, '')).filter(Boolean);
  const domainMatch = signalContext.match(/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.[a-z]{2,}/g) || [];
  const distinctiveTokens = new Set(
    domainMatch
      .map(d => d.toLowerCase())
      .concat(words.filter(w => /[A-Z]/.test(w) && w.length >= 2).map(w => w.toLowerCase()))
  );
  for (const g of GENERIC_WORDS) distinctiveTokens.delete(g);

  if (distinctiveTokens.size > 0) {
    for (const token of distinctiveTokens) {
      if (text.includes(token)) return true;
    }
    return false;
  }

  const keyTerms = context.split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
  if (keyTerms.length === 0) return true;

  const sourceDomainMatch = context.match(/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.[a-z]{2,}/g);
  if (sourceDomainMatch) {
    for (const domain of sourceDomainMatch) {
      if (text.includes(domain)) return true;
    }
  }

  for (const term of keyTerms) {
    if (text.includes(term)) return true;
  }

  return false;
}


// ─── Signal list (cached briefly so per-message ingestion doesn't hit the DB) ───
let cachedSignals = null;
let cachedSignalsAt = 0;
const SIGNALS_TTL_MS = 60 * 1000;

/**
 * Returns the full list of signals, cached for up to SIGNALS_TTL_MS so hot
 * ingestion loops (WhatsApp history sync) don't re-query MongoDB per message.
 */
export async function getActiveSignals() {
  if (cachedSignals && Date.now() - cachedSignalsAt < SIGNALS_TTL_MS) {
    return cachedSignals;
  }
  const signalsCollection = await getCollection('signals');
  cachedSignals = await signalsCollection.find({}).toArray();
  cachedSignalsAt = Date.now();
  return cachedSignals;
}

/**
 * Refresh the cached signal list immediately (e.g. right after a signal is
 * added/edited/deleted) so the next WhatsApp ingestion sees it without waiting
 * for the TTL to expire.
 */
export async function refreshSignalsCache() {
  cachedSignals = null;
  cachedSignalsAt = 0;
  return getActiveSignals();
}


/**
 * Runs the full matching pipeline for ONE normalized message against a list of
 * signals. Mirrors the logic the Gmail path used to run inline.
 *
 * @param {Object} message - { from, subject, content }
 * @param {Array} signals - signals to check against
 * @returns {Promise<{
 *   matches: Array<{matchedSignalId, context, summary, reasoning, confidence}>,
 *   keywordMatches: Array<{signalId, keywords, matchedKeywords}>,
 *   matched: boolean,
 *   keywordMatched: boolean,
 *   llmCalls: number
 * }>}
 */
export async function signalMessageMatches(message, signals) {
  const safeSignals = signals || [];

  // ─── PIPELINE 1: Keyword matching (deterministic, no LLM) ───
  const keywordMatches = matchMessageAgainstAllSignals(message, safeSignals);
  const keywordMatched = keywordMatches.length > 0;

  // ─── PIPELINE 2: LLM intent matching ───
  const matches = [];
  let llmCalls = 0;

  for (const signal of safeSignals) {
    // Source-intent signal ("emails from X"): deterministic code-only matching.
    // NO LLM call and no keyword pre-filter — the sender match is exact.
    if (signal.isSenderIntent) {
      const result = matchSourceSignal(message, signal);
      if (result.matched) {
        matches.push({
          matchedSignalId: signal._id,
          context: signal.context,
          summary: result.summary,
          reasoning: result.reasoning,
          confidence: result.confidence,
        });
      }
      continue;
    }

    // Pre-filter: skip LLM call if message doesn't contain relevant keywords.
    if (!keywordPreFilter(message, signal.context)) {
      continue;
    }

    try {
      llmCalls++;
      const result = await checkSignalMatch(message, signal);
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
        try {
          const result = await checkSignalMatch(message, signal);
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
          console.error(`Retry failed for signal ${signal._id}:`, retryErr.message);
        }
      } else {
        console.error(`Failed to check signal ${signal._id}:`, err.message);
      }
    }
  }

  return {
    matches,
    keywordMatches,
    matched: matches.length > 0,
    keywordMatched,
    llmCalls,
  };
}

