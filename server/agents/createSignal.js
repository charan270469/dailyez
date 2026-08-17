// Shared signal-creation logic used by POST /api/signals and the voice agent: normalizes
// keywords, extracts the source entity, stores the signal, then re-fetches/re-checks messages.
import { getCollection } from '../db.js';
import { parseSignalEntity } from './parseSignalEntity.js';
import { fetchAndStoreGmailMessages, recheckAllMessagesAgainstSignals, recheckKeywordMatches } from '../gmail/fetchMessages.js';

/**
 * The same signal-creation logic used by POST /api/signals, shared so the voice
 * agent (executeVoiceAction -> create_signal) triggers an identical create +
 * re-fetch / re-check without duplicating code.
 *
 * @param {string} [context] - user-facing signal description
 * @param {string[]} [keywords] - optional explicit keywords
 * @returns {Promise<import('mongodb').WithId<import('mongodb').Document>>} the created signal
 */
export async function createSignal(context, keywords = []) {
  // Normalize keywords: trim, lowercase, dedupe, max 50 chars
  const normalizedKeywords = (keywords || [])
    .map(k => String(k).trim().toLowerCase())
    .filter(k => k.length > 0 && k.length <= 50)
    .filter((k, i, arr) => arr.indexOf(k) === i);

  // Extract the target entity/owner once at creation time so downstream matching
  // can use fast, deterministic code (no per-email LLM guesswork).
  const { entityName, isSenderIntent } = parseSignalEntity(context ? context.trim() : '');

  const signalsCollection = await getCollection('signals');
  const result = await signalsCollection.insertOne({
    context: context ? context.trim() : '',
    keywords: normalizedKeywords,
    entityName,
    isSenderIntent,
    platform: 'gmail',
    createdAt: new Date(),
    matchCount: 0,
    lastMatched: null,
  });

  const entry = await signalsCollection.findOne({ _id: result.insertedId });

  // Trigger a re-fetch of Gmail messages + re-checks so the new signal starts
  // matching without waiting for the 15-min cron. Fire-and-forget.
  fetchAndStoreGmailMessages(50)
    .then(fetchResult => console.log('Re-fetched Gmail messages after adding signal:', fetchResult))
    .catch(err => console.error('Failed to re-fetch Gmail messages after adding signal:', err));

  recheckAllMessagesAgainstSignals()
    .then(recheckResult => console.log('Re-checked existing messages after adding signal:', recheckResult))
    .catch(err => console.error('Failed to re-check existing messages after adding signal:', err));

  recheckKeywordMatches()
    .then(kwResult => console.log('Re-checked keyword matches after adding signal:', kwResult))
    .catch(err => console.error('Failed to re-check keyword matches after adding signal:', err));

  return entry;
}