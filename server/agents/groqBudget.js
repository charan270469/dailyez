// Shared daily Groq request budget guard for the matching pipeline.
//
// The real constraint on this account is ~1,000 requests/day per model — not
// message volume — so every Groq call site records itself here and the
// orchestrator defers (rather than 429-retrying) once a model is exhausted.
//
// In-memory + single-process by design (personal-use app). Local-midnight
// reset. ponytail: multi-process deploys would each hold their own counter
// (over-count headroom, never under-protect); upgrade path is a shared store.
const DEFAULT_DAILY_LIMIT = 1000;
const WARN_FRACTION = 0.8;

function localDayKey(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

let dayKey = localDayKey();
const usage = new Map(); // model string -> count today
const warned = new Set(); // model strings already warned today

function ensureDay() {
  const k = localDayKey();
  if (k !== dayKey) {
    dayKey = k;
    usage.clear();
    warned.clear();
  }
}

function sanitizeModelForEnv(model) {
  return String(model || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function parsePositiveInt(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * Daily request limit for one model name. Checked in order:
 *  1. GROQ_DAILY_LIMIT_<FULL_SANITIZED_MODEL> (e.g. GROQ_DAILY_LIMIT_OPENAI_GPT_OSS_20B)
 *  2. Suffix match: GROQ_DAILY_LIMIT_GPT_OSS_20B matches openai/gpt-oss-20b
 *     (longest suffix wins), so the documented example var just works.
 *  3. Generic GROQ_DAILY_LIMIT fallback for every model.
 *  4. Built-in default (1000).
 */
export function getGroqModelLimit(model) {
  const full = sanitizeModelForEnv(model);
  if (full) {
    const exact = parsePositiveInt(process.env[`GROQ_DAILY_LIMIT_${full}`]);
    if (exact !== null) return exact;
    let best = null;
    for (const key of Object.keys(process.env)) {
      if (!key.startsWith('GROQ_DAILY_LIMIT_')) continue;
      const suffix = key.slice('GROQ_DAILY_LIMIT_'.length);
      if (!suffix || suffix === full) continue;
      if (full === suffix || full.endsWith(`_${suffix}`)) {
        const v = parsePositiveInt(process.env[key]);
        if (v !== null && (best === null || suffix.length > best.suffix.length)) best = { suffix, v };
      }
    }
    if (best) return best.v;
  }
  const generic = parsePositiveInt(process.env.GROQ_DAILY_LIMIT);
  return generic !== null ? generic : DEFAULT_DAILY_LIMIT;
}

export function getGroqUsage(model) {
  ensureDay();
  return usage.get(String(model)) || 0;
}

export function isGroqBudgetExhausted(model) {
  ensureDay();
  return getGroqUsage(model) >= getGroqModelLimit(model);
}

/**
 * Record one Groq request actually made for `model`. Logs a one-per-day
 * warning when usage crosses 80% of the limit, and a clear line when the
 * limit itself is reached. Returns the new usage count.
 */
export function noteGroqCall(model) {
  ensureDay();
  const key = String(model);
  const next = (usage.get(key) || 0) + 1;
  usage.set(key, next);
  const limit = getGroqModelLimit(key);
  if (next >= limit) {
    console.warn(`[groq-budget] LIMIT REACHED model=${key} used=${next}/${limit} — further evaluations on this model defer until tomorrow`);
  } else if (next >= Math.ceil(limit * WARN_FRACTION) && !warned.has(key)) {
    warned.add(key);
    console.warn(`[groq-budget] WARNING model=${key} used=${next}/${limit} (80% of daily budget)`);
  }
  return next;
}

/** Models worth showing even at zero usage (pipeline defaults + env overrides + seen). */
function knownModels() {
  const set = new Set(usage.keys());
  for (const v of [
    process.env.GROQ_MATCH_MODEL, process.env.GROQ_EXTRACT_MODEL,
    process.env.GROQ_VERIFY_MODEL, process.env.GROQ_ROUTE_MODEL,
    process.env.GROQ_SUMMARIZE_MODEL, process.env.GROQ_ANSWER_MODEL,
    'openai/gpt-oss-20b', 'openai/gpt-oss-120b',
  ]) if (v) set.add(String(v));
  return [...set];
}

export function getGroqBudgetSnapshot() {
  ensureDay();
  return {
    date: dayKey,
    models: knownModels().map((model) => {
      const used = usage.get(model) || 0;
      const limit = getGroqModelLimit(model);
      return { model, used, limit, remaining: Math.max(0, limit - used), exhausted: used >= limit };
    }),
  };
}

/** Test-only reset (clears counters + warnings for today). */
export function _resetGroqBudgetForTests() {
  dayKey = localDayKey();
  usage.clear();
  warned.clear();
}
