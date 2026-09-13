// Orchestrator for message × signal matching — the single entry point every
// evaluation flows through. Gmail sync, WhatsApp sync, re-check sweeps, and
// signal edits all funnel here via signalMessageMatches → orchestrateMatch.
//
// Routes each (message, signal) pair to only the subsystem it needs based on
// the signal's type:
//   - alert-target signals   → matchAlertTarget  (deterministic, zero LLM)
//   - sender-intent signals  → matchSourceSignal (deterministic, zero LLM)
//   - everything else        → runClassificationPipeline (keyword pre-filter +
//                              Groq LLM call). The extraction and verification
//                              agents plug into this pipeline in later tasks;
//                              today it is a pass-through to the existing
//                              matchSignal.js matcher, unchanged.
//
// Also owns the classification pipeline's staging infra that used to live
// inline in signalMatching.js — the keyword pre-filter (avoids LLM calls on
// obviously unrelated messages) and the shared Groq rolling-window RPM limiter
// — plus one `[pipeline]` log line per evaluation recording which path ran.

import { checkSignalMatch } from './matchSignal.js';
import { matchSourceSignal } from './matchSourceIntent.js';

// Pipeline-stage labels, logged once per message × signal evaluation so sync
// logs show which path the orchestrator took (future agent stages will append
// their own markers through the same channel).
export const PATH_ALERT_TARGET = 'alert-target (deterministic)';
export const PATH_SOURCE_INTENT = 'source-intent (deterministic)';
export const CLASSIFICATION_LLM_PATH = 'classification-pipeline (LLM)';
const PATH_CLASSIFICATION_PREFILTER_SKIP = 'classification-pipeline (LLM skipped: keyword pre-filter)';

// ─── Keyword pre-filter (classification pipeline stage 1) ───

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
 * - Otherwise (pure topic/event signals with no named entity) it falls back to a
 *   loose "any single key term" check. The terms come from the signal's explicit
 *   `keywords` when provided (they capture the intent much better than natural
 *   language context words); otherwise they are derived from the context with
 *   platform/qualifier words ("whatsapp", "messages", "fetch", "from" ...)
 *   stripped out — so "fetch all hiring messages from whatsapp" gates on
 *   "hiring", not on the platform name.
 */

// Words that describe the messaging platform or generic intent glue rather than
// the user's actual topic. These must never gate whether a message reaches the LLM.
const PLATFORM_WORDS = new Set([
  'whatsapp', 'gmail', 'gmail.com', 'inbox', 'message', 'messages',
  'msg', 'msgs', 'chat', 'chats', 'text', 'sms', 'phone', 'email', 'emails',
  'mail', 'mails', 'on', 'via', 'from', 'app', 'fetch', 'fetching', 'pull',
  'read', 'show', 'find', 'get', 'see', 'watch', 'alert', 'notify', 'all',
  'every', 'each', 'about', 'with', 'for', 'into', 'over',
]);

function keywordPreFilter(message, signal) {
  const text = (message.from + ' ' + message.subject + ' ' + message.content).toLowerCase();
  const signalContext = typeof signal === 'string' ? signal : (signal?.context || '');
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
  for (const p of PLATFORM_WORDS) distinctiveTokens.delete(p);

  if (distinctiveTokens.size > 0) {
    for (const token of distinctiveTokens) {
      if (text.includes(token)) return true;
    }
    return false;
  }

  // Loose fallback: prefer the signal's explicit keywords when present; otherwise
  // derive terms from the context, dropping platform/stop words.
  let keyTerms = [];
  if (signal && Array.isArray(signal.keywords)) {
    keyTerms = signal.keywords
      .map(k => String(k).toLowerCase().trim())
      .filter(k => k.length > 3 && !STOP_WORDS.has(k) && !PLATFORM_WORDS.has(k));
  }
  if (keyTerms.length === 0) {
    keyTerms = context
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w) && !PLATFORM_WORDS.has(w));
  }
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

// ─── Groq match-call rate limiting (classification pipeline stage 2) ───
// The Groq free tier used for signal matching caps at roughly 30 requests per
// minute. Calls must be paced well below that, so we throttle with a
// rolling-window limiter: at most GROQ_MATCH_RPM_LIMIT calls in any 60s window,
// which under sustained sequential load spaces calls ~60000/limit ms apart
// (e.g. ~2143ms at the default 28 RPM — a small buffer above the theoretical
// 2000ms minimum). Short bursts still pass while budget remains in the window.
// The limit is configurable via GROQ_MATCH_RPM_LIMIT in case the model or tier
// changes. The free Groq matches are token-capped per minute (TPM) far more
// aggressively than raw request count, so keep the default conservative.
const GROQ_MATCH_RPM_LIMIT = Math.max(1, Number(process.env.GROQ_MATCH_RPM_LIMIT) || 4);
const GROQ_WINDOW_MS = 60 * 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Start-times (ms) of recent Groq match calls, oldest first. Module-level so the
// budget is shared across EVERY message × signal pair in a sync — the rate limit
// applies per API key, not per call site — including both the Gmail and WhatsApp
// ingestion paths and the re-check sweep.
const matchCallTimestamps = [];

/**
 * Waits until a Groq match call is allowed by the rolling-window RPM limit, then
 * records the call start-time. Guarantees no more than GROQ_MATCH_RPM_LIMIT calls
 * ever fall inside any 60s window.
 */
async function acquireGroqMatchSlot() {
  while (true) {
    const now = Date.now();
    // Drop calls that have aged out of the 60s window.
    while (matchCallTimestamps.length && now - matchCallTimestamps[0] >= GROQ_WINDOW_MS) {
      matchCallTimestamps.shift();
    }
    if (matchCallTimestamps.length < GROQ_MATCH_RPM_LIMIT) {
      matchCallTimestamps.push(now);
      return;
    }
    // Window full — wait until the oldest recorded call ages out of the window,
    // then re-check (another slot may have been released in the meantime).
    await sleep(matchCallTimestamps[0] + GROQ_WINDOW_MS - now);
  }
}

// ─── Alert-target signals (one-click "Alert me") ───
// Quick-alert signals carry alertEnabled/alertTarget/alertPlatform and are
// matched deterministically (exact sender email or WhatsApp chat id), never via
// the LLM. The normalization below must agree with the one used by the
// quick-alert route so a signal created from a card matches the same string that
// stored messages carry.

/**
 * Normalize an alert target to its canonical stored form:
 * - gmail: lowercased email address when present (fallback: lowercased raw string)
 * - whatsapp: group JIDs keep their suffix (@g.us, lowercased); 1:1 chats are
 *   reduced to the bare number, mirroring normalizeWhatsAppChatIdForGrouping's
 *   core rule (stored chatIds are already canonical at persist time).
 */
export function normalizeAlertTarget(platform, raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (platform === 'whatsapp') {
    const lower = value.toLowerCase();
    if (/@g\.us$/i.test(lower)) return lower;
    return lower.split('@')[0];
  }
  const emailMatch = value.match(/<([^<>]+)>/) ||
    value.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) return emailMatch[1].toLowerCase();
  return value.toLowerCase();
}

function extractEmailAddress(value) {
  const normalized = normalizeAlertTarget('gmail', value);
  return /@/.test(normalized) ? normalized : '';
}

/**
 * Deterministic matcher for quick-alert signals (alertEnabled + alertTarget).
 * Exact sender/chat scoping — no LLM call, no fuzzy keyword guessing — so a next
 * message from the same sender is flagged reliably.
 *
 * @param {Object} message - { from, subject, content, source?, chatId?, groupJid?, senderJid? }
 * @param {Object} signal  - signal document (alertEnabled/alertTarget/alertPlatform)
 */
export function matchAlertTarget(message, signal) {
  const target = signal.alertTarget;
  if (!signal.alertEnabled || !target) {
    return { matched: false, reasoning: 'Signal is not an alert-target signal', confidence: 'high' };
  }

  const platform = (signal.alertPlatform || 'gmail').toLowerCase();
  const source = String(message.source || '').toLowerCase();

  if (platform === 'whatsapp') {
    // Only WhatsApp-origin messages can match a WhatsApp alert.
    if (source && source !== 'whatsapp') {
      return { matched: false, reasoning: 'WhatsApp alert cannot match a non-WhatsApp message', confidence: 'high' };
    }
    // A stored WhatsApp message carries several sender identities, and the
    // target the user typed in the form may be any of them: the canonical chat
    // id (bare phone number), the group JID, the participant JID, or the
    // resolved contact/group display name (`from`). Compare against ALL of them
    // so a contact name or group name typed in the Add/Edit form matches.
    const normalizedTarget = normalizeAlertTarget('whatsapp', target);
    const candidates = [message.chatId, message.groupJid, message.senderJid, message.from];
    if (candidates.some((c) => c && normalizeAlertTarget('whatsapp', c) === normalizedTarget)) {
      return {
        matched: true,
        reasoning: `Message is from the chat/contact you set an alert for (${target}).`,
        summary: `Message from ${target}.`,
        confidence: 'high',
      };
    }
    return { matched: false, reasoning: `Message is not from the alert target "${target}".`, confidence: 'high' };
  }

  // Gmail: exact sender email match against the From header.
  if (source && source !== 'gmail') {
    return { matched: false, reasoning: 'Gmail alert cannot match a non-Gmail message', confidence: 'high' };
  }
  const fromEmail = extractEmailAddress(message.from || '');
  if (fromEmail && fromEmail === normalizeAlertTarget('gmail', target)) {
    return {
      matched: true,
      reasoning: `Email is from the sender you set an alert for (${target}).`,
      summary: `Email from ${target}.`,
      confidence: 'high',
    };
  }
  return { matched: false, reasoning: `Sender does not match the alert target "${target}".`, confidence: 'high' };
}

/**
 * Classification pipeline for topic/event/mixed-intent signals — the path that
 * makes a Groq LLM call.
 *
 * STAGES (today):
 *   1. Keyword pre-filter — if the message shares no term with the signal
 *      context, skip the LLM entirely and report the skip in the path.
 *   2. Groq RPM pacing (shared rolling-window limiter).
 *   3. checkSignalMatch — the existing matchSignal.js matcher, unchanged.
 *
 * The extraction and verification agents plug into this pipeline during later
 * tasks; checkSignalMatch remains the final classification stage. Returns the
 * matcher result plus the pipeline path taken (for logging / LLM-call counting).
 */
export async function runClassificationPipeline(message, signal) {
  if (!keywordPreFilter(message, signal)) {
    return {
      result: {
        matched: false,
        reasoning: 'Keyword pre-filter: message shares no term with the signal context — LLM call skipped.',
        confidence: 'high',
        summary: '',
      },
      path: PATH_CLASSIFICATION_PREFILTER_SKIP,
    };
  }
  await acquireGroqMatchSlot();
  const result = await checkSignalMatch(message, signal);
  return { result, path: CLASSIFICATION_LLM_PATH };
}

/**
 * Decides the execution path for ONE message × signal pair and runs it.
 *
 * Routing order matches the pre-orchestrator pipeline exactly: alert-flavored
 * signals (target OR explicit alertEnabled flag) go deterministic first so a
 * disabled alert stays fully silent while OFF instead of drifting into
 * intent/LLM matching; sender-intent signals then go deterministic; everything
 * else runs the classification pipeline. Logs the path taken per evaluation.
 *
 * @param {Object} message - { from, subject, content, source?, chatId?, groupJid?, senderJid? }
 * @param {Object} signal  - signal document (alertEnabled/alertTarget/alertPlatform/isSenderIntent/context/...)
 * @returns {Promise<{ result: {matched, reasoning, confidence, summary}, path: string }>}
 */
export async function orchestrateMatch(message, signal) {
  let result;
  let path;
  if (signal.alertTarget || signal.alertEnabled) {
    result = matchAlertTarget(message, signal);
    path = PATH_ALERT_TARGET;
  } else if (signal.isSenderIntent) {
    result = matchSourceSignal(message, signal);
    path = PATH_SOURCE_INTENT;
  } else {
    const pipeline = await runClassificationPipeline(message, signal);
    result = pipeline.result;
    path = pipeline.path;
  }
  console.log(`[pipeline] path=${path} signalId=${String(signal._id || '')} matched=${result.matched}`);
  return { result, path };
}