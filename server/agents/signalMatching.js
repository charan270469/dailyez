// Shared signal-matching pipeline used by BOTH Gmail and WhatsApp messages.
// Runs, for a single normalized message, the exact same checks the Gmail path
// used to run inline:
//   - PIPELINE 1: deterministic keyword matching (no LLM)
//   - PIPELINE 2: per-signal orchestration — every message × signal pair is
//     routed through orchestrateMatch (server/agents/orchestrator.js), which
//     sends alert-target and sender-intent signals to deterministic matchers
//     and everything else through the classification pipeline (keyword
//     pre-filter + Groq LLM call).
//
// Centralizing this here guarantees Gmail and WhatsApp messages are matched
// identically against the same set of signals through a single entry point.

import { orchestrateMatch, CLASSIFICATION_LLM_PATH } from './orchestrator.js';
import { matchMessageAgainstAllSignals } from './keywordMatch.js';
import { getCollection } from '../db.js';

// Back-compat re-exports: the deterministic alert-target matcher lives in the
// orchestrator (which owns alert-target routing). External callers
// (server/index.js and server/tests) still import these from here.
export { matchAlertTarget, normalizeAlertTarget } from './orchestrator.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
 * Normalizes a signal id (Mongo ObjectId or string) to its string form, so
 * `lastEvaluatedSignalIds` stored on messages and the live `signals` list can
 * be compared reliably.
 */
export function signalIdToString(id) {
  return String(id);
}

/**
 * Returns only the signals a message has NOT already been evaluated against,
 * based on the message's stored `lastEvaluatedSignalIds`. A message with no
 * stored list (never processed yet, or pre-feature) gets every signal — that is
 * the one-time full evaluation that populates the list going forward.
 *
 * Newly created signals are naturally pending (their id is missing from every
 * message's list). Edited signals are made pending again by stripping their id
 * from `lastEvaluatedSignalIds` on all messages (see PATCH /api/signals/:id).
 *
 * @param {Array} signals - current full signal list
 * @param {string[]} [alreadyEvaluatedSignalIds] - message.lastEvaluatedSignalIds
 * @returns {Array} signals whose id is absent from the already-evaluated set
 */
export function getPendingSignals(signals, alreadyEvaluatedSignalIds = []) {
  const evaluated = new Set((alreadyEvaluatedSignalIds || []).map(signalIdToString));
  return (signals || []).filter((s) => s && !evaluated.has(signalIdToString(s._id)));
}

/**
 * Runs the full matching pipeline for ONE normalized message against a list of
 * signals. Only evaluates against the signals the message has not already been
 * evaluated on (see `getPendingSignals`), so routine re-checks never re-send an
 * unchanged message to the LLM for unchanged signals.
 *
 * @param {Object} message - { from, subject, content }
 * @param {Array} signals - full signal list; filtered internally to pending
 * @param {string[]} [alreadyEvaluatedSignalIds] - message.lastEvaluatedSignalIds
 * @returns {Promise<{
 *   matches: Array<{matchedSignalId, context, summary, reasoning, confidence}>,
 *   keywordMatches: Array<{signalId, keywords, matchedKeywords}>,
 *   matched: boolean,
 *   keywordMatched: boolean,
 *   llmCalls: number,
 *   evaluatedSignalIds: string[]
 * }>}
 */
export async function signalMessageMatches(message, signals, alreadyEvaluatedSignalIds = []) {
  const safeSignals = getPendingSignals(signals, alreadyEvaluatedSignalIds);
  const evaluatedSignalIds = safeSignals.map((s) => signalIdToString(s._id));

  // ─── PIPELINE 1: Keyword matching (deterministic, no LLM) ───
  const keywordMatches = matchMessageAgainstAllSignals(message, safeSignals);
  const keywordMatched = keywordMatches.length > 0;

  // ─── PIPELINE 2: Orchestrated per-signal evaluation ───
  // Every message × signal pair goes through the orchestrator — the single
  // entry point for all matching — which routes by signal type: alert-target
  // and sender-intent signals run deterministic matchers (no LLM), everything
  // else runs the classification pipeline (keyword pre-filter + Groq call).
  // The orchestrator logs which path each pair took.
  const matches = [];
  let llmCalls = 0;

  for (const signal of safeSignals) {
    try {
      const outcome = await orchestrateMatch(message, signal);
      if (outcome.path === CLASSIFICATION_LLM_PATH) llmCalls++;
      if (outcome.result.matched) {
        matches.push({
          matchedSignalId: signal._id,
          context: signal.context,
          summary: outcome.result.summary,
          reasoning: outcome.result.reasoning,
          confidence: outcome.result.confidence,
        });
      }
    } catch (err) {
      // Only the classification pipeline can realistically throw here (LLM HTTP
      // failure; the deterministic matchers are pure code). Handle rate
      // limiting with backoff. Avoid a second API request: the model's TPM
      // quota is the tighter constraint, and a second retry would immediately
      // consume another full slot while the first 429 is still active.
      if (err.status === 429) {
        console.log(`Rate limited on signal ${signal._id}, backing off and skipping retry for this signal...`);
        await sleep(5000);
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
    evaluatedSignalIds,
  };
}

