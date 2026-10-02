// Daily Gemini request budget visibility for the single shared GEMINI_API_KEY.
//
// The same key serves PDF parsing (server/agents/parsePdfAttachment.js) and the
// planned matching fallback, sharing one ~1,500 requests/day (RPD) quota — so
// every call records its `source` ('pdf-parse' vs 'match-fallback') and the
// snapshot shows the real split before anyone decides separate keys are needed.
//
// Visibility only: no deferral, no gating — at 100% it logs, nothing stops.
// In-memory + single-process by design (personal-use app). Local-midnight
// reset. ponytail: multi-process deploys would each hold their own counter
// (over-count headroom, never under-protect); upgrade path is a shared store.
const DEFAULT_DAILY_LIMIT = 1500;
const WARN_FRACTION = 0.8;

export const GEMINI_SOURCE_PDF_PARSE = 'pdf-parse';
export const GEMINI_SOURCE_MATCH_FALLBACK = 'match-fallback';

function localDayKey(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

let dayKey = localDayKey();
const usageBySource = new Map(); // source string -> count today
let warned = false; // one 80% warning per day (quota is shared, so one flag)

function ensureDay() {
  const k = localDayKey();
  if (k !== dayKey) {
    dayKey = k;
    usageBySource.clear();
    warned = false;
  }
}

function splitSuffix() {
  const parts = [...usageBySource.entries()].map(([s, n]) => `${s}=${n}`);
  return parts.length ? ` (${parts.join(' ')})` : '';
}

/** Daily request limit for the shared key: GEMINI_DAILY_LIMIT, else 1500. */
export function getGeminiDailyLimit() {
  const n = Number(process.env.GEMINI_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_LIMIT;
}

/** Requests used today — total, or for one source when given. */
export function getGeminiUsage(source) {
  ensureDay();
  if (source) return usageBySource.get(String(source)) || 0;
  let total = 0;
  for (const n of usageBySource.values()) total += n;
  return total;
}

/**
 * Record one completed Gemini request from `source`. Logs a one-per-day
 * warning at 80% of the limit and a line at 100% (visibility only — the
 * caller is never blocked). Returns the new total usage.
 */
export function noteGeminiCall(source) {
  ensureDay();
  const key = String(source || GEMINI_SOURCE_PDF_PARSE);
  usageBySource.set(key, (usageBySource.get(key) || 0) + 1);
  const total = getGeminiUsage();
  const limit = getGeminiDailyLimit();
  if (total >= limit) {
    console.warn(`[gemini-budget] LIMIT REACHED used=${total}/${limit}${splitSuffix()} — visibility only, no deferral`);
  } else if (total >= Math.ceil(limit * WARN_FRACTION) && !warned) {
    warned = true;
    console.warn(`[gemini-budget] WARNING used=${total}/${limit} (80% of daily budget)${splitSuffix()}`);
  }
  return total;
}

export function getGeminiBudgetSnapshot() {
  ensureDay();
  const used = getGeminiUsage();
  const limit = getGeminiDailyLimit();
  const bySource = {};
  for (const [s, n] of usageBySource) bySource[s] = n;
  return { date: dayKey, used, limit, remaining: Math.max(0, limit - used), bySource };
}

/** Test-only reset (clears counters + warning for today). */
export function _resetGeminiBudgetForTests() {
  dayKey = localDayKey();
  usageBySource.clear();
  warned = false;
}
