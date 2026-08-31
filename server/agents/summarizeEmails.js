// Summarizes stored Gmail messages within a date range into one natural-language paragraph
// via Groq, batching and merging partial results for large inboxes.
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { getCollection } from '../db.js';

dotenv.config(); // load .env early — same pattern as auth.js / db.js

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const SUMMARIZE_MODEL = process.env.GROQ_SUMMARIZE_MODEL || 'openai/gpt-oss-120b';
const BATCH_SIZE = 20; // cap per LLM call — batch when more
const MAX_SUMMARY_MESSAGES = Number(process.env.GROQ_SUMMARIZE_MAX) || 100; // hard cap on total emails a summary covers
const RANGES = new Set(['today', 'yesterday', 'this_week']);

function getDateRange(timeRange) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (timeRange === 'yesterday') {
    const startYesterday = new Date(startToday.getTime() - 24 * 60 * 60 * 1000);
    return { from: startYesterday, to: startToday, label: 'yesterday' };
  }

  if (timeRange === 'this_week') {
    const day = now.getDay(); // 0 = Sunday
    const daysSinceMonday = (day + 6) % 7;
    const startWeek = new Date(startToday.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
    return { from: startWeek, to: now, label: 'this week' };
  }

  return { from: startToday, to: now, label: 'today' };
}

function buildDigest(messages) {
  return messages
    .map((m, i) => `Email ${i + 1}:\nFrom: ${m.from || 'Unknown sender'}\nSubject: ${m.subject || '(no subject)'}\nSnippet: ${String(m.content || '').slice(0, 300)}`)
    .join('\n\n');
}

async function summarizeBatch(messages, label, note) {
  const digest = buildDigest(messages);
  const noteLine = note ? `\nNote: ${note}` : '';
  const userPrompt = `You are the email summarizer part of DailyEz. The user received ${messages.length} email(s) ${label}. Write ONE concise, natural-language paragraph (aim for 3-7 sentences) describing what came in: the notable senders, the main subjects, and anything that looks important or needs attention. Speak in the user's voice (for example, start with "You received..."). Do NOT use bullet points, lists, or headings. Do NOT invent details that are not present.${noteLine}\n\n${digest}`;

  const completion = await groq.chat.completions.create({
    model: SUMMARIZE_MODEL,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.3,
  });

  return (completion.choices?.[0]?.message?.content || '').trim();
}

async function mergeSummaries(parts, label) {
  const userPrompt = `Combine the following partial summaries of the emails the user received ${label} into ONE polished, natural-language paragraph. Keep the most important senders and subjects, and note when messages have been grouped together. No bullet points, no headings — output only the final paragraph.\n\n${parts
    .map((p, i) => `Part ${i + 1}:\n${p}`)
    .join('\n\n')}`;

  const completion = await groq.chat.completions.create({
    model: SUMMARIZE_MODEL,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.3,
  });

  return (completion.choices?.[0]?.message?.content || '').trim();
}

/**
 * Summarizes the stored Gmail messages received within a date range.
 * (Also used by GET /api/messages/summarize and the voice action executor.)
 *
 * @param {"today"|"yesterday"|"this_week"} [timeRange]
 * @returns {Promise<{ summary: string, count: number }>}
 */
export async function summarizeEmailsInRange(timeRange = 'today') {
  const rangeKey = RANGES.has(timeRange) ? timeRange : 'today';
  const { from, to, label } = getDateRange(rangeKey);

  const messagesCollection = await getCollection('messages');
  const messages = await messagesCollection
    .find({
      source: 'gmail',
      status: { $ne: 'archived' },
      timestamp: { $gte: from, $lt: to },
    })
    .sort({ timestamp: -1 })
    .toArray();

  const total = messages.length;

  if (total === 0) {
    return { summary: `You received no new Gmail messages ${label}. Your inbox is all caught up.`, count: 0 };
  }

  // Cap the number of emails a summary covers: the spec's "20" is a per-call
  // batch cap, but thousands of messages cannot (or should not) be fully read —
  // we summarize the most recent MAX_SUMMARY_MESSAGES and let the LLM mention
  // the overall volume when something was left out.
  const capped = messages.slice(0, MAX_SUMMARY_MESSAGES);
  const omitted = total - capped.length;
  const volumeNote =
    omitted > 0
      ? `the user actually received ${total} email(s) ${label}, but only the most recent ${capped.length} are listed below — if the total is much larger than the details shown, briefly mention the overall volume in your first sentence.`
      : '';

  // Batch the capped list; one LLM call per BATCH_SIZE emails.
  const batches = [];
  for (let i = 0; i < capped.length; i += BATCH_SIZE) {
    batches.push(capped.slice(i, i + BATCH_SIZE));
  }

  const parts = [];
  let failedBatches = 0;
  let sawRateLimit = false;
  for (const batch of batches) {
    try {
      const note = batch === batches[0] ? volumeNote : '';
      const partial = await summarizeBatch(batch, label, note);
      parts.push(partial || `(Some of your ${batch.length} emails could not be summarized.)`);
    } catch (batchError) {
      failedBatches++;
      sawRateLimit = sawRateLimit || batchError.status === 429;
      console.error('Failed to summarize a batch of emails:', batchError);
      parts.push(
        batchError.status === 429
          ? '(Summarization is paused because the AI service hit its rate limit.)'
          : `(Could not summarize ${batch.length} of your emails due to a temporary error.)`
      );
    }
  }

  let summary = parts[0] || '';

  // If every batch failed, give one clean message instead of piling up fallbacks.
  if (failedBatches === batches.length) {
    summary = sawRateLimit
      ? `I couldn't summarize your emails ${label} because the AI service's rate limit was reached. Please try again in a few minutes.`
      : `I had trouble summarizing your emails ${label}. Please try again in a moment.`;
  } else if (parts.length > 1) {
    const merged = await mergeSummaries(parts, label);
    summary = merged || parts.join(' ');
  }

  return { summary, count: total };
}