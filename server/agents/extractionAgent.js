// Best-effort structured-fact extraction for the classification pipeline.
//
// Runs BEFORE the classification LLM call for topic/event/mixed signals and
// feeds the classifier compact, pre-extracted facts (sender, dates, amounts,
// named entities, one-line factual summary) as supplementary context — so the
// classification agent reasons over cleaner information rather than only raw
// text. The raw message still goes into the classification prompt unchanged.
//
// This is an ENHANCEMENT, not a hard dependency: any failure (Groq error,
// invalid JSON, wrong shape) is logged and reported as `null`, and the
// orchestrator falls back to classifying the raw message alone, exactly as
// before this agent existed.
import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// High-volume pipeline model — GPT-OSS spends completion tokens on an internal
// reasoning pass, so keep reasoning_effort low and 800-token headroom (same
// treatment as matchSignal.js). Configurable via GROQ_EXTRACT_MAX_TOKENS.
const MODEL = process.env.GROQ_EXTRACT_MODEL || 'openai/gpt-oss-20b';
const MAX_OUTPUT_TOKENS = Math.max(64, Number(process.env.GROQ_EXTRACT_MAX_TOKENS) || 800);

// Same body cap as the classification call: the full extracted message text
// (bodyText for Gmail) sliced to a bounded size. Configurable via
// GROQ_EXTRACT_CONTENT_CHAR_LIMIT.
const CONTENT_CHAR_LIMIT = Math.max(1, Number(process.env.GROQ_EXTRACT_CONTENT_CHAR_LIMIT) || 4000);

const FACTS_SCHEMA = `{
  "sender": { "displayName": "display name from the From label / chat participant or group name, or \"\"", "domain": "sender email domain WITHOUT the @, lowercased, or \"\" for chat messages that have no email address" },
  "dates": ["each date or deadline literally mentioned in the message, written as it appears"],
  "amounts": ["each monetary amount literally mentioned, written as it appears"],
  "entities": {
    "companies": ["each named company/organization mentioned"],
    "roles": ["each job title/role mentioned"],
    "people": ["each named person mentioned"]
  },
  "summary": "ONE line, factually describing what the message literally says — no interpretation"
}`;

/**
 * Builds the fact-extraction prompt for one message. Pure (no network) so it is
 * unit-testable; the fields requested mirror FACTS_SCHEMA exactly.
 */
export function buildExtractPrompt(message) {
  const fullBodyText = message.body || message.content || '';
  const bodyText = fullBodyText.slice(0, CONTENT_CHAR_LIMIT);
  return `You extract structured facts from one email or chat message. Facts only — report what the message LITERALLY says, never interpret or infer the sender's intent.

Return STRICT JSON only, with exactly this structure:
${FACTS_SCHEMA}

Rules:
- "sender.displayName" is the display name in the From label (email) or the contact/group name (chat); "" when none is shown.
- "sender.domain" is the sender's email domain without the @, lowercased; "" for chat messages (phone numbers, group names, etc.).
- "dates" / "amounts" list the dates, deadlines, and monetary amounts literally mentioned; empty arrays when none.
- "entities" lists named companies/organizations, roles/titles, and people literally mentioned; each empty array when none are mentioned.
- "summary" is ONE factual line about what the message literally says — not an opinion, not an interpretation.

MESSAGE:
From: ${message.from}
Subject: ${message.subject}
Body: ${bodyText}`;
}

/**
 * Normalizes a raw extraction response into the canonical facts object, or
 * returns null when the response is missing / not JSON / not the expected shape
 * (the caller then falls back to classifying the raw message alone). Pure, so
 * it is unit-testable. Missing optional fields degrade to empty strings/arrays;
 * a missing summary is fatal because the classifier relies on it.
 *
 * @param {string|null|undefined} raw - LLM response content
 * @returns {null | {sender:{displayName:string,domain:string}, dates:string[], amounts:string[], entities:{companies:string[],roles:string[],people:string[]}, summary:string}}
 */
export function normalizeExtractedFacts(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const str = (v) => (typeof v === 'string' ? v : '').trim();
  const strArr = (v) => Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim() !== '').map((s) => s.trim()) : [];

  const summary = str(parsed.summary);
  if (!summary) return null;

  const sender = parsed.sender && typeof parsed.sender === 'object' && !Array.isArray(parsed.sender)
    ? { displayName: str(parsed.sender.displayName), domain: str(parsed.sender.domain).toLowerCase() }
    : { displayName: '', domain: '' };
  const entities = parsed.entities && typeof parsed.entities === 'object' && !Array.isArray(parsed.entities)
    ? { companies: strArr(parsed.entities.companies), roles: strArr(parsed.entities.roles), people: strArr(parsed.entities.people) }
    : { companies: [], roles: [], people: [] };

  return {
    sender,
    dates: strArr(parsed.dates),
    amounts: strArr(parsed.amounts),
    entities,
    summary,
  };
}

/**
 * Extracts structured facts from one message via a single Groq call.
 *
 * Never throws: returns the normalized facts object on success, or null on any
 * failure (logged) so the classification pipeline can fall back to the raw
 * message alone. Also logs the extracted facts so sync logs show what was
 * passed into the classifier as context.
 *
 * @param {Object} message - { from, subject, content, body? }
 * @returns {Promise<object|null>} normalized facts, or null when extraction failed
 */
export async function extractMessageFacts(message) {
  const prompt = buildExtractPrompt(message);

  let completion;
  try {
    // GPT-OSS reasoning models spend completion tokens on an internal pass —
    // cap it with low effort (same as matchSignal.js); never send to others.
    const opts = {
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      // JSON Object Mode is supported by every Groq model (strict json_schema
      // is limited to select models), and step-3 semantics already treat the
      // response as unverified until normalizeExtractedFacts validates it.
      response_format: { type: 'json_object' },
      max_tokens: MAX_OUTPUT_TOKENS,
    };
    if (MODEL.includes('gpt-oss')) opts.reasoning_effort = 'low';
    completion = await groq.chat.completions.create(opts);
  } catch (err) {
    console.error(`[extract] FAILED (Groq error): ${err.message} — classification will run on the raw message alone`);
    return null;
  }

  const usage = completion.usage;
  if (usage) {
    console.log(`[extract] model=${MODEL} prompt_tokens=${usage.prompt_tokens} completion_tokens=${usage.completion_tokens} total=${usage.total_tokens}`);
  }

  const raw = completion.choices?.[0]?.message?.content;
  const facts = normalizeExtractedFacts(raw);
  if (facts === null) {
    console.error(`[extract] FAILED (invalid JSON / wrong shape): ${String(raw).slice(0, 300)} — classification will run on the raw message alone`);
    return null;
  }

  console.log(`[extract] ok facts=${JSON.stringify(facts)}`);
  return facts;
}