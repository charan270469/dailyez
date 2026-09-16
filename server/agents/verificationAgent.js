// Verification agent — critically re-examines a medium/low-confidence classification
// result BEFORE it is persisted to the message document.
//
// A genuine match must survive a critique aimed at the exact failure this codebase
// documents (see proj.md and matchSignal.js): THEMATIC/SUPERFICIAL SIMILARITY being
// mistaken for a genuine match — e.g. the classifier matching on shared generic
// vocabulary ("tech", "job", "interview", a company name merely mentioned) between
// two UNRELATED entities, instead of judging real sender identity (source signals)
// or substantive coverage of the exact topic/event (topic/event signals).
//
// The prompt is a CRITIQUE of the initial verdict, not a re-run of the
// classification: it is handed the signal's context, the message, and the initial
// agent's verdict + stated reasoning, and must explicitly CONFIRM or OVERTURN the
// verdict, returning strict JSON:
//   { verified: boolean, finalMatched: boolean, verificationReasoning: string }
//
// Failure semantics mirror the extraction agent (server/agents/extractionAgent.js):
// any error (Groq failure, invalid JSON, wrong shape) is logged and reported as
// null — the orchestrator then keeps the initial classification result as-is.
// Verification can never break or block matching.
import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Verification runs on the large reasoning model — same low-effort + 800-token
// headroom treatment as the matcher. Configurable via GROQ_VERIFY_MAX_TOKENS.
const MODEL = process.env.GROQ_VERIFY_MODEL || 'openai/gpt-oss-120b';
const MAX_OUTPUT_TOKENS = Math.max(64, Number(process.env.GROQ_VERIFY_MAX_TOKENS) || 800);

// Same full-message cap as the extraction and classification calls. The message
// body is the extracted full text (bodyText for Gmail), sliced to a bounded size.
// Configurable via GROQ_VERIFY_CONTENT_CHAR_LIMIT.
const CONTENT_CHAR_LIMIT = Math.max(1, Number(process.env.GROQ_VERIFY_CONTENT_CHAR_LIMIT) || 4000);

const RESULT_SCHEMA = `{
  "verified": true,
  "finalMatched": false,
  "verificationReasoning": "One brief paragraph (2-3 sentences) stating exactly which evidence you checked and why the initial verdict does or does not stand."
}`;
/**
 * Builds the verification critique prompt for one message × signal pair.
 *
 * The initial agent's verdict + reasoning are handed to the model verbatim so the
 * critique tests them instead of re-classifying from scratch. Pure function so
 * the prompt wiring is unit-testable without a live call.
 *
 * @param {Object} message  - { from, subject, content, body? }
 * @param {Object} signal   - signal document (context is the user's intent)
 * @param {Object} initialResult - classification result { matched, confidence, reasoning }
 * @returns {string} the prompt to send to the LLM
 */
export function buildVerificationPrompt(message, signal, initialResult) {
  const fullBodyText = message.body || message.content || '';
  const bodyText = fullBodyText.slice(0, CONTENT_CHAR_LIMIT);

  return `You are a critical reviewer for a message-filtering system. Your ONLY job is to CRITIQUE an initial match verdict — NOT to re-classify the message from scratch.

A previous agent already decided whether the message below truly fulfills the user's signal. That agent can be wrong, and you must hunt specifically for the documented failure pattern: THEMATIC OR SUPERFICIAL SIMILARITY BEING MISTAKEN FOR A GENUINE MATCH — e.g. shared generic vocabulary ("tech", "job", "interview", a company name merely mentioned) making two UNRELATED entities look related. A real match must be grounded in the ACTUAL SENDER IDENTITY (for source signals: the sender genuinely belongs to the named entity's own domain/address) or SUBSTANTIVE coverage of the exact topic/event (for topic/event signals) — never in mere word overlap.

USER'S SIGNAL: "${signal.context}"

MESSAGE:
From: ${message.from}
Subject: ${message.subject}
Body: ${bodyText}

INITIAL CLASSIFICATION VERDICT (what you are critiquing):
- matched: ${initialResult.matched}
- confidence: ${initialResult.confidence}
- reasoning: ${initialResult.reasoning}

Decide whether the initial verdict survives this critique, then return STRICT JSON only, exactly this structure:
${RESULT_SCHEMA}

- "verified" must be true when you CONFIRM the initial verdict, false when you OVERTURN it.
- "finalMatched" is the final match outcome: it must EQUAL the initial "matched" value when confirmed, and be its OPPOSITE when overturned.
- "verificationReasoning" is one brief paragraph (2-3 sentences) naming evidence you actually checked (real sender domain, named entity, message content) and why the verdict does or does not stand. If you caught the superficial-similarity pattern, name the shared word/theme that misled the initial agent.`;
}
/**
 * Normalizes the verification agent's JSON response to the documented contract.
 * Pure and tolerant so a unit test can exercise every failure path; the orchestrator
 * treats a non-null result as authoritative (finalMatched overrides the initial
 * classification result).
 *
 * @param {string|null|undefined} raw - LLM response content
 * @returns {null | { verified: boolean, finalMatched: boolean, verificationReasoning: string }}
 */
export function normalizeVerificationResult(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  if (typeof parsed.verified !== 'boolean' || typeof parsed.finalMatched !== 'boolean') return null;
  const verificationReasoning = typeof parsed.verificationReasoning === 'string'
    ? parsed.verificationReasoning.trim()
    : '';
  if (!verificationReasoning) return null;

  return {
    verified: parsed.verified,
    finalMatched: parsed.finalMatched,
    verificationReasoning,
  };
}

/**
 * Critically verifies one initial classification result via a single Groq call.
 *
 * Never throws: returns the normalized { verified, finalMatched, verificationReasoning }
 * on success, or null on any failure (logged) so the orchestrator keeps the initial
 * classification result as-is. Also logs token usage so sync logs show the extra
 * call happened.
 *
 * @param {Object} message  - { from, subject, content, body? }
 * @param {Object} signal   - signal document
 * @param {Object} initialResult - classification result { matched, confidence, reasoning }
 * @returns {Promise<{ verified: boolean, finalMatched: boolean, verificationReasoning: string } | null>}
 */
export async function verifyMatch(message, signal, initialResult) {
  const prompt = buildVerificationPrompt(message, signal, initialResult);

  let completion;
  try {
    // Same GPT-OSS-only guard as matchSignal.js: only reasoning models accept it.
    const opts = {
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      // JSON Object Mode is supported by every Groq model (strict json_schema is
      // limited to select models), and normalizeVerificationResult validates the
      // shape afterwards — same approach as the extraction agent.
      response_format: { type: 'json_object' },
      max_tokens: MAX_OUTPUT_TOKENS,
    };
    if (MODEL.includes('gpt-oss')) opts.reasoning_effort = 'low';
    completion = await groq.chat.completions.create(opts);
  } catch (err) {
    console.error(`[verify] FAILED (Groq error): ${err.message} — keeping the initial classification result`);
    return null;
  }

  const usage = completion.usage;
  if (usage) {
    console.log(`[verify] model=${MODEL} prompt_tokens=${usage.prompt_tokens} completion_tokens=${usage.completion_tokens} total=${usage.total_tokens}`);
  }

  const raw = completion.choices?.[0]?.message?.content;
  const verification = normalizeVerificationResult(raw);
  if (verification === null) {
    console.error(`[verify] FAILED (invalid JSON / wrong shape): ${String(raw).slice(0, 300)} — keeping the initial classification result`);
    return null;
  }

  return verification;
}