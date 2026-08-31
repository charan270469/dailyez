// WhatsApp chat/group summarizer for the voice/text assistant: finds the most
// recent messages in one chat (or every group) and produces natural-language
// summaries via Groq. Powers commands like "summarize my top 10 latest
// WhatsApp messages", "summarize the AMAZON SDE 2027 BATCH group", or
// "summarize my group chats".
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { getCollection } from '../db.js';
import { isWhatsAppGroupSystemMessage } from '../whatsapp/connection.js';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const SUMMARIZE_MODEL = process.env.GROQ_SUMMARIZE_MODEL || 'openai/gpt-oss-120b';

// Cap how many distinct groups we summarize in one "group chats" answer so the
// LLM does not fire dozens of calls.
const MAX_GROUPS = 6;

const SUMMARY_INSTRUCTIONS =
  'Write ONE concise, natural-language paragraph (3-6 sentences) describing the conversation: who said what, the main topics, and anything that looks important or needs a reply. Do NOT use bullet points, lists, or headings. Do not invent details that are not present.';

function cleanName(value, fallback = 'Someone') {
  const v = String(value || '').trim();
  if (!v) return fallback;
  return v.replace(/@(s\.whatsapp\.net|lid)$/i, '');
}

function buildMessageDigest(messages) {
  return messages
    .map((m, i) => {
      const who = cleanName(m.isGroup ? m.sender : m.from);
      const group = m.isGroup && m.groupName ? ` #${m.groupName}` : '';
      const ts = m.timestamp ? new Date(m.timestamp).toLocaleString() : '';
      return `Message ${i + 1}:${group}\nFrom: ${who}\n${ts}\n${String(m.content || m.preview || '').slice(0, 400)}`;
    })
    .join('\n\n');
}

async function groqSummarize(prompt) {
  const completion = await groq.chat.completions.create({
    model: SUMMARIZE_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
  });
  return (completion.choices?.[0]?.message?.content || '').trim();
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
    chats.push({
      name: d.isGroup === true ? `${label} (group)` : label,
      isGroup: d.isGroup === true,
    });
  }
  return chats;
}

/**
 * Summarizes the most recent WhatsApp messages.
 *
 * @param {Object} opts
 * @param {string} [opts.chat]           optional chat/group to scope to (fuzzy, case-insensitive)
 * @param {number} [opts.count]          how many recent messages to include (default 10)
 * @param {boolean} [opts.groupsOnly]    summarize each distinct group separately
 * @param {string|string[]} [opts.chatId] optional exact stored chatId(s) to scope to — the same
 *                                        conversation card's id, e.g. the "Summarize this chat"
 *                                        button. Matches any JID/bare-number form the chat is
 *                                        persisted under.
 * @returns {Promise<{ summary: string, count: number, found: number }>}
 */
export async function summarizeWhatsAppChat({ chat, count = 10, groupsOnly = false, chatId } = {}) {
  const limit = Number.isFinite(count) ? Math.min(Math.max(Math.floor(count), 1), 50) : 10;
  const messagesCollection = await getCollection('messages');

  const filter = { source: 'whatsapp', status: { $ne: 'archived' } };
  if (groupsOnly === true) filter.isGroup = true;

  // Narrow to ONE conversation when the caller knows its stored chatId (e.g. the
  // inbox card it came from). Accepts the exact field value used at save time;
  // the route passes every JID/bare-number form the same 1:1 chat may have.
  const chatIds = Array.isArray(chatId) ? chatId.filter(Boolean) : chatId ? [chatId] : [];
  if (chatIds.length > 0) filter.chatId = { $in: chatIds };

  const chatTerm = String(chat || '').trim();
  if (chatTerm) {
    const escaped = chatTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { groupName: { $regex: escaped, $options: 'i' } },
      { from: { $regex: escaped, $options: 'i' } },
      { subject: { $regex: escaped, $options: 'i' } },
    ];
  }

  const messages = (await messagesCollection
    .find(filter)
    .sort({ timestamp: -1 })
    .limit(200)
    .toArray())
    // Pure group-membership notifications ("X left the group", "X joined …")
    // are not real conversation and must never feed the summary.
    .filter((message) => !isWhatsAppGroupSystemMessage(message));

  if (messages.length === 0) {
    const chats = await listWhatsAppChats();
    const available = chats.length
      ? ` I can see chats like: ${chats.slice(0, 8).map((c) => c.name).join(', ')}.`
      : ' No WhatsApp messages are stored yet — link WhatsApp in Settings first.';
    return { summary: `I couldn't find any WhatsApp messages${chatTerm ? ` from "${chatTerm}"` : ''}.${available}`, count: 0, found: 0 };
  }

  // "Summarize my group chats": give one recap per distinct group instead of
  // smashing every group into a single blob.
  if (groupsOnly === true) {
    return summarizeEachGroup(messages, limit);
  }

  const capped = messages.slice(0, limit);
  const groupName = capped[0]?.isGroup && capped[0]?.groupName ? capped[0].groupName : null;
  const digest = buildMessageDigest(capped);
  const targetDesc = groupName
    ? `the group "${groupName}"`
    : chatTerm
      ? `the chat/group matching "${chatTerm}"`
      : 'the latest WhatsApp messages';

  const prompt = `You are the WhatsApp summarizer part of the SignalStream assistant. The user asked for a summary of ${targetDesc}. Below are the ${capped.length} most recent messages. ${SUMMARY_INSTRUCTIONS}\n\n${digest}`;

  let summary = '';
  try {
    summary = await groqSummarize(prompt);
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

/**
 * Summarize each distinct WhatsApp group separately (used when the user asks
 * "summarize my group chats" without naming a group). Returns the individual
 * recaps joined together, newest groups first, capped at MAX_GROUPS.
 */
async function summarizeEachGroup(messages, limit) {
  const byChat = new Map();
  for (const m of messages) {
    const key = m.groupJid || m.chatId || m.groupName || m.from || 'unknown-group';
    if (!byChat.has(key)) byChat.set(key, []);
    byChat.get(key).push(m);
  }

  const groups = [...byChat.values()]
    .sort((a, b) => new Date(b[0]?.timestamp || 0).getTime() - new Date(a[0]?.timestamp || 0).getTime())
    .slice(0, MAX_GROUPS);

  if (groups.length === 0) {
    return {
      summary: "I couldn't find any WhatsApp group chats in the stored messages. Link WhatsApp in Settings first.",
      count: 0,
      found: messages.length,
    };
  }

  const parts = [];
  let included = 0;
  for (const groupMessages of groups) {
    const name = cleanName(groupMessages[0]?.groupName || groupMessages[0]?.from || 'Group');
    const capped = groupMessages.slice(0, limit);
    included += capped.length;
    const digest = buildMessageDigest(capped);
    const prompt = `You are the WhatsApp summarizer part of the SignalStream assistant. The user asked for a summary of the group "${name}". Below are its ${capped.length} most recent messages. ${SUMMARY_INSTRUCTIONS}\n\n${digest}`;

    try {
      const text = await groqSummarize(prompt);
      parts.push(`**${name}**: ${text}`);
    } catch (error) {
      if (error.status === 429) {
        parts.push(`**${name}**: The AI service hit its rate limit — please try again in a few minutes.`);
        break;
      }
      console.error(`Failed to summarize WhatsApp group "${name}":`, error.message);
      parts.push(`**${name}**: (I couldn't summarize these, but here are the latest messages: ${capped
        .map((m) => `${cleanName(m.sender || m.from)}: ${String(m.content || '').slice(0, 60)}`)
        .join(' | ')})`);
    }
  }

  if (parts.length === 0) {
    return { summary: "I couldn't summarize any WhatsApp group chats right now.", count: 0, found: messages.length };
  }

  const summary =
    parts.length === 1
      ? parts[0].replace(/^\*\*.*?\*\*:\s*/, '')
      : `Here's a quick recap of your ${parts.length} most active WhatsApp group${parts.length > 1 ? 's' : ''}:\n\n${parts.join('\n\n')}`;

  return { summary, count: included, found: messages.length };
}