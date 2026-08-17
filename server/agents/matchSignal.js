// LLM-based single-signal matcher: asks Groq to decide, for one email and one signal,
// whether the email genuinely fulfills the user's intent, returning matched/confidence/reasoning/summary.
import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * Checks whether a single email message matches a single signal's context
 * using LLM-based intent reasoning.
 *
 * The agent is STRICT: it only matches when the email genuinely and verifiably
 * fulfills what the user asked for. A false positive is treated as a failure.
 * It first figures out the DOMINANT intent of the signal (source-sender vs
 * topic vs event) and then applies the correct matching rule for that intent.
 *
 * @param {Object} message - The email message object
 * @param {string} message.from - Sender email/name (e.g. "Name <name@domain.com>")
 * @param {string} message.subject - Email subject line
 * @param {string} message.content - Email body / snippet
 * @param {Object} signal - The signal to check against
 * @param {string} signal.context - The user's intent description (e.g. "emails from my college X", "alert me when...")
 * @returns {Promise<{ intent: string, reasoning: string, matched: boolean, confidence: string, summary: string }>}
 */
export async function checkSignalMatch(message, signal) {
  const prompt = `You are a strict, precise email-filtering agent. Your ONLY job is to decide whether an email genuinely and verifiably fulfills the user's signal.

ABSOLUTE RULES (never break these):
- Precision over recall. A false positive — showing an email that does not really satisfy the signal — is a FAILURE. When in doubt, do not match.
- Do not be generous, do not "show a few extra", do not guess, and do not assume context that is not in the email. Use only what is actually provided.
- Never compromise strictness to catch more emails.

STEP 1 — Determine the DOMINANT INTENT of the user's signal. Choose exactly ONE of:
  "source"  -> The user wants emails FROM a specific sender: an institution, college, university, company, person, team, or email domain. Keywords like "from", "my college", "my school", "the university", "@domain.com", "official mails of" all signal this.
  "topic"   -> The user wants emails ABOUT a subject/topic regardless of who sends them (e.g. "jobs for backend", "crypto news"). There is no specific sender named.
  "event"   -> The user wants a signal when a specific event/status change happens (e.g. "an interview invite", "my application accepted", "a payment"). Usually a single moment, not ongoing content.
  "mixed"   -> A specific sender is named AND a specific topic/event for that sender (e.g. "offers from Google"). Apply BOTH rules below — match only if BOTH are satisfied.

STEP 2 — Apply the matching rule for the intent you chose.

If intent is "source":
  - The ONLY thing that matters is WHO ACTUALLY SENT the email. The subject and body are secondary.
  - Look at the From header. Extract the real EMAIL ADDRESS (the part inside <> or the @domain) AND the display name. The @domain in the address is the strongest proof of who sent it.
  - Match ONLY if the sender genuinely belongs to the exact institution/entity the user named (its own domain or its own official address).
  - A THIRD-PARTY sender is NOT a match, even if it mentions the institution, quotes its name, links to it, or talks about jobs/events at/for it. The user asked for mail FROM the institution, not mail ABOUT it. Examples of non-matches: job boards (Internshala, LinkedIn, Naukri), recruiters/HR agencies (freshersindia), placement consultants, newsletters, or any @gmail/@yahoo address that merely references the college.
  - If the sender's domain/name is unrelated to the named source, or you cannot confirm it, return matched=false.

If intent is "topic":
  - Match ONLY if the email's subject/body is directly and substantively about the exact topic. A passing mention or generic promotion is NOT a match.

If intent is "event":
  - Match ONLY if the email confirms the specific event you described has actually occurred. Newsletters, announcements of opportunity, or vague mentions are NOT a match.

If intent is "mixed":
  - The email must satisfy BOTH the "source" rule (sender genuinely belongs to the named entity) AND the "topic"/"event" rule. If either fails, matched=false.

DECISION CHECKLIST — before answering "matched", confirm ALL that apply:
  1. For a source signal, is the real sender address (or display name) genuinely from the institution named in the signal? Ignore display names that merely contain the college's name when the actual sending domain belongs to a third party.
  2. For a topic/event signal, is the subject/body directly about the exact topic/event? No general email, job spam, recruiter blast, or newsletter qualifies.
  3. Is this the kind of email the user would personally open and say "yes, this is exactly what I asked for"? If you have to talk yourself into it, it is NOT a match.

USER'S SIGNAL: "${signal.context}"

EMAIL:
From: ${message.from}
Subject: ${message.subject}
Body: ${(message.body || message.content || '').slice(0, 1500)}

Respond in strict JSON only:
{
  "intent": "source" | "topic" | "event" | "mixed",
  "reasoning": "step-by-step, in this exact order: 1) what the user's dominant intent is and why, 2) who actually sent this email (real address + what domain it is from), 3) whether that sender satisfies the intent, 4) for topic/event rules whether content satisfies them, 5) final decision and confidence. 2-4 sentences.",
  "matched": boolean,
  "confidence": "high" | "medium" | "low",
  "summary": "one sentence summary of the email if matched, empty string if not"
}`;

  // Stronger reasoning model gives the agent more "thinking capacity" for strict
  // verdicts. Default to llama-3.3-70b-versatile; override with GROQ_MATCH_MODEL
  // (e.g. BACK to the cheap 'llama-3.1-8b-instant' to save tokens/cost).
  const model = process.env.GROQ_MATCH_MODEL || 'llama-3.3-70b-versatile';

  const completion = await groq.chat.completions.create({
    model,
    messages: [
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) {
    return {
      intent: 'topic',
      reasoning: 'LLM returned empty response',
      matched: false,
      confidence: 'low',
      summary: '',
    };
  }

  try {
    const result = JSON.parse(raw);
    const confidenceVal = ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : 'low';
    const intentVal = ['source', 'topic', 'event', 'mixed'].includes(result.intent) ? result.intent : 'topic';
    return {
      intent: intentVal,
      reasoning: result.reasoning || 'No reasoning provided',
      matched: Boolean(result.matched),
      confidence: confidenceVal,
      summary: result.matched ? (result.summary || '') : '',
    };
  } catch (parseError) {
    console.error('Failed to parse LLM response as JSON:', raw);
    return {
      intent: 'topic',
      reasoning: 'Failed to parse LLM response',
      matched: false,
      confidence: 'low',
      summary: '',
    };
  }
}
