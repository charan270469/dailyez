// Finds a stored Gmail/email message by a fuzzy sender/subject query and describes
// it so the assistant can say "found it" and offer to open it. Powers commands like
// "take me to the mail from harsh hr from forestnation".
import { getCollection } from '../db.js';

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Searches stored messages for one matching the user's description of a sender
 * (and/or subject). Returns the closest match (or null).
 *
 * @param {string} query - e.g. "harsh hr from forestnation", "from amazon"
 * @returns {Promise<{
 *   found: boolean,
 *   message?: { id, from, subject, content, timestamp, source },
 *   response: string
 * }>}
 */
export async function findEmail(query) {
  const term = String(query || '').trim();
  if (!term) {
    return { found: false, response: "I didn't catch which email you mean. Try something like \"take me to the mail from John\"" };
  }

  const words = term
    .toLowerCase()
    .replace(/\b(from|the|me|a|to|click|open|show|take|email|mail)\b/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  const messagesCollection = await getCollection('messages');
  const filter = {
    source: { $in: ['gmail'] },
    status: { $ne: 'archived' },
    $or: [],
  };

  const primaryTerm = words.join(' ');
  if (primaryTerm) {
    filter.$or.push({ from: { $regex: escape(primaryTerm), $options: 'i' } });
  }
  for (const w of words.slice(0, 4)) {
    filter.$or.push({ from: { $regex: escape(w), $options: 'i' } });
    filter.$or.push({ subject: { $regex: escape(w), $options: 'i' } });
  }

  if (filter.$or.length === 0) {
    return { found: false, response: "I couldn't figure out which email that is. Could you repeat the sender's name?" };
  }

  const matches = await messagesCollection.find(filter).sort({ timestamp: -1 }).limit(10).toArray();

  if (matches.length === 0) {
    return { found: false, response: `I couldn't find any email matching "${term}". Try another name or sender.` };
  }

  const best = matches[0];
  return {
    found: true,
    message: {
      from: best.from,
      subject: best.subject,
      content: String(best.content || best.preview || '').slice(0, 500),
      timestamp: best.timestamp ? new Date(best.timestamp).toLocaleString() : '',
      source: best.source,
    },
    response: `I found it. Here's the most recent email from ${best.from || 'that sender'}: subject "${best.subject}", sent ${best.timestamp ? new Date(best.timestamp).toLocaleString() : 'recently'}. I've opened your All Inbox where you can see it.`,
  };
}

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}