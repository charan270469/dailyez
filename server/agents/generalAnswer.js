// General conversation answerer for the assistant: answers free-form questions and
// small talk with Groq, optionally grounding the reply in the user's recent stored
// messages (emails + WhatsApp) so it can answer things like "who emailed me today".
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { getCollection } from '../db.js';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const ANSWER_MODEL = process.env.GROQ_ANSWER_MODEL || 'llama-3.3-70b-versatile';

/**
 * Answers a free-form question. Pulls a small digest of the user's most recent
 * stored messages so the assistant can talk about their actual inbox when relevant.
 *
 * @param {string} question
 * @returns {Promise<string>}
 */
export async function generalAnswer(question) {
  const text = String(question || '').trim();
  if (!text) {
    return "I'm your SignalStream assistant. Ask me to summarize my emails or WhatsApp messages, add a signal, navigate somewhere, or open a specific email.";
  }

  // Grab a compact digest of the latest 12 messages to give the LLM useful context.
  let digest = '';
  try {
    const messagesCollection = await getCollection('messages');
    const latest = await messagesCollection
      .find({})
      .sort({ timestamp: -1 })
      .limit(12)
      .toArray();
    digest = latest
      .map((m, i) => {
        const kind = m.source === 'gmail' ? `email from ${m.from || 'unknown'}` : `${m.source || 'chat'}`;
        const who = m.source === 'whatsapp' ? (m.sender || m.from || 'someone') : '';
        const body = String(m.content || m.subject || '').slice(0, 160);
        return `${i + 1}. [${kind}]${who ? ` ${who}` : ''}: ${body}`;
      })
      .join('\n')
      .slice(0, 2500);
  } catch (error) {
    digest = '';
  }

  const system = `You are the SignalSteam assistant for a personal messaging dashboard. The user can tap the mic or type. Answer helpfully and concisely (aim for 2-4 sentences). If the question is about their inbox, use the recent messages below to answer factually and do not invent things not present. If they ask you to do an action you cannot (like send an email or message), say you can help them open or summarize it instead.\n\nRecent stored messages that MAY be relevant:\n${digest || '(none available)'}`;

  try {
    const completion = await groq.chat.completions.create({
      model: ANSWER_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      temperature: 0.5,
    });
    return (completion.choices?.[0]?.message?.content || '').trim() || "I'm not sure how to help with that one — try asking about your emails or WhatsApp.";
  } catch (error) {
    if (error.status === 429) {
      return "The AI's rate limit just got reached, so I couldn't answer that. Give it a few minutes and try again.";
    }
    console.error('General answer failed:', error.message);
    return "Sorry, I couldn't fetch an answer right now. Please try again in a moment.";
  }
}