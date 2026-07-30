import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * Checks whether a single email message matches a single signal's context
 * using LLM-based intent reasoning.
 *
 * @param {Object} message - The email message object
 * @param {string} message.from - Sender email/name
 * @param {string} message.subject - Email subject line
 * @param {string} message.content - Email body / snippet
 * @param {Object} signal - The signal to check against
 * @param {string} signal.context - The user's intent description (e.g. "Alert me when...")
 * @returns {Promise<{ reasoning: string, matched: boolean, confidence: number, summary: string }>}
 */
export async function checkSignalMatch(message, signal) {
  const prompt = `You are an intelligent email filter that understands user intent, not just keywords. Do not match based on keyword presence alone — reason about whether this message genuinely fulfills what the user is asking for.

USER'S SIGNAL: "${signal.context}"

EMAIL:
From: ${message.from}
Subject: ${message.subject}
Body: ${(message.body || message.content || '').slice(0, 1500)}

Think step by step:
1. What is the user actually trying to be alerted about? (their real intent, not just literal words)
2. Does this email relate to that intent? Consider related topics, companies, events, or opportunities that the user would care about.
3. Be inclusive — if the email is plausibly related to the user's signal, mark it as matched. The user has explicitly asked to see these emails, so it's better to show a few extra than to miss relevant ones.

Respond in strict JSON only:
{
  "reasoning": "1-2 sentences on your thought process",
  "matched": boolean,
  "confidence": "high" | "medium" | "low",
  "summary": "one sentence summary of the email if matched, empty string if not"
}`;

  // Use a smaller, faster model to conserve free tier tokens
  // llama-3.1-8b-instant is much cheaper and faster than 70b
  const completion = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) {
    return {
      reasoning: 'LLM returned empty response',
      matched: false,
      confidence: 'low',
      summary: '',
    };
  }

  try {
    const result = JSON.parse(raw);
    const confidenceVal = ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : 'low';
    return {
      reasoning: result.reasoning || 'No reasoning provided',
      matched: Boolean(result.matched),
      confidence: confidenceVal,
      summary: result.matched ? (result.summary || '') : '',
    };
  } catch (parseError) {
    console.error('Failed to parse LLM response as JSON:', raw);
    return {
      reasoning: 'Failed to parse LLM response',
      matched: false,
      confidence: 'low',
      summary: '',
    };
  }
}
