// WhatsApp chat summarizer for the voice/text assistant: finds the most recent
// messages in one chat (or the whole inbox) and produces a natural-language
// summary via Groq. Powers commands like "summarize my top 10 latest WhatsApp
// messages from the Forest Team group".
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { getCollection } from '../db.js';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const SUMMARIZE_MODEL = process.env.GROQ_SUMMARIZE_MODEL || 'llama-3.3-70b-versatile';

function cleanName(value, fallback = 'Someone') {
  const v = String(value || '').trim();
  if (!v) return fallback;
  return v.replace(/@(s\.whatsapp\.net|lid)$/i, '');
}

/**
 * Lists the distinct WhatsApp chats (1:1 contacts and group names) we have stored
 * so the assistant can tell the user what's available.
 */
export async function listWhatsAppChats() {
  const messagesCollection = await getCollection('messages');
  const docs = await messagesCollection
    .find({ source: 'whatsapp' }, { projection: { groupName: 1, from: 1, sender: 1, isGroup: 1 } })
    .toArray();

  const seen = new Set();
  const chats = [];
  for (const d of docs) {
    const key = d.isGroup ? (d.groupName || d.from) : (d.from || d.sender);
    const label = cleanName(key);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    chats.push({ name: label, isGroup: d.isGroup === true });
  }
  return chats;
}

/**
 * Summarizes the most recent WhatsApp messages.
 *
 * @param {Object} opts
 * @param {string} [opts.chat]  optional chat/group to scope to (fuzzy, case-insensitive)
 * @param {number} [opts.count] how many recent messages to include (default 10)
 * @returns {Promise<{ summary: string, count: number, found: number }>}
 */
export async function summarizeWhatsAppChat({ chat, count = 10 } = {}) {
  const limit = Number.isFinite(count) ? Math.min(Math.max(Math.floor(count), 1), 50) : 10;
  const messagesCollection = await getCollection('messages');

  const filter = { source: 'whatsapp', status: { $ne: 'archived' } };
  const chatTerm = String(chat || '').trim();

  if (chatTerm) {
    filter.$or = [
      { groupName: { $regex: chatTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { from: { $regex: chatTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { subject: { $regex: chatTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    ];
  }

  const messages = await messagesCollection
    .find(filter)
    .sort({ timestamp: -1 })
    .limit(200)
    .toArray();

  if (messages.length === 0) {
    const chats = await listWhatsAppChats();
    const available = chats.length
      ? ` I can see chats like: ${chats.slice(0, 8).map((c) => c.name).join(', ')}.`
      : ' No WhatsApp messages are stored yet — link WhatsApp in Settings first.';
    return { summary: `I couldn't find any WhatsApp messages${chatTerm ? ` from "${chatTerm}"` : ''}.${available}`, count: 0, found: 0 };
  }

  const capped = messages.slice(0, limit);
  const digest = capped.map((m, i) => {
    const who = cleanName(m.isGroup ? m.sender : m.from);
    const group = m.isGroup && m.groupName ? ` #${m.groupName}` : '';
    const ts = m.timestamp ? new Date(m.timestamp).toLocaleString() : '';
    return `Message ${i + 1}:${group}\nFrom: ${who}\n${ts}\n${String(m.content || m.preview || '').slice(0, 400)}`;
  }).join('\n\n');

  const targetDesc = chatTerm
    ? `the chat/group matching "${chatTerm}"`
    : 'the latest WhatsApp messages';

  const prompt = `You are the WhatsApp summarizer part of the SignalStream assistant. The user asked for a summary of ${targetDesc}. Below are the ${capped.length} most recent messages. Write ONE concise, natural-language paragraph (3-6 sentences) in the user's voice, describing the conversation: who said what, the main topics, and anything that looks important or needs a reply. Do NOT use bullet points, lists, or headings. Do not invent details that are not present.\n\n${digest}`;

  let summary = '';
  try {
    const completion = await groq.chat.completions.create({
      model: SUMMARIZE_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });
    summary = (completion.choices?.[0]?.message?.content || '').trim();
  } catch (error) {
    if (error.status === 429) {
      summary = `I couldn't summarize the WhatsApp messages because the AI service's rate limit was reached. Please try again in a few minutes.`;
    } else {
      console.error('Failed to summarize WhatsApp chat:', error.message);
      summary = `Here are the ${capped.length} most recent messages${chatTerm ? ` from "${chatTerm}"` : ''}: ${capped.map((m) => `${m.isGroup ? m.sender || 'someone' : m.from || 'someone'}: ${String(m.content || '').slice(0, 80)}`).join(' | ')}`;
    }
  }

  return { summary, count: capped.length, found: messages.length };
}