import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ObjectId } from 'mongodb';
import { connectToDatabase, getCollection } from './db.js';
import { getValidAccessToken } from './auth.js';
import cron from 'node-cron';
import { registerAuthRoutes } from './authRoutes.js';
import { registerVoiceRoutes } from './voiceRoutes.js';
import { registerWhatsAppRoutes } from './whatsappRoutes.js';
import { registerDiscordRoutes } from './discord/discordRoutes.js';
import { startDiscordClient } from './discord/client.js';
import { fetchAndStoreGmailMessages, recheckAllMessagesAgainstSignals, recheckKeywordMatches, backfillSpamFlags } from './gmail/fetchMessages.js';
import { getWhatsAppChatHistory, isWhatsAppStatusJid, normalizeWhatsAppChatIdForGrouping, loadPersistedWhatsAppMetadata, groupWhatsAppConversations, recheckWhatsAppSignalMatches, backfillWhatsAppContent, startWhatsAppConnection, hasSavedWhatsAppCredentials } from './whatsapp/connection.js';
import { refreshSignalsCache } from './agents/signalMatching.js';

dotenv.config();

const app = express();

// The frontend (Vite dev server) is pinned to port 3000 and proxies /api and
// /auth/google to this backend. Accept browser requests only from that origin
// (plus any FRONTEND_URL override) so the two ports always stay in sync.
const FRONTEND_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
if (process.env.FRONTEND_URL) {
  FRONTEND_ORIGINS.unshift(process.env.FRONTEND_URL);
}
app.use(cors({ origin: FRONTEND_ORIGINS }));
app.use(express.json({ limit: '25mb' })); // larger limit so base64 audio payloads are accepted

// Backend port — pinned to 3001 by default (frontend runs on 3000 via Vite).
const PORT = Number(process.env.PORT) || 3001;

function isWhatsAppStatusMessage(message) {
  return message?.source === 'whatsapp' && (
    isWhatsAppStatusJid(message.chatId) ||
    isWhatsAppStatusJid(message.raw?.key?.remoteJid)
  );
}

app.get('/', (_req, res) => {
  res.json({ message: 'DailyEz backend is running' });
});


app.get('/messages', async (_req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const messages = await messagesCollection.find({}).sort({ timestamp: -1 }).toArray();
    res.json(messages.filter((message) => !isWhatsAppStatusMessage(message)));
  } catch (error) {
    console.error('Failed to load messages', error);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

app.get('/stored-messages', async (_req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const messages = await messagesCollection.find({}).sort({ timestamp: -1 }).toArray();
    res.json(messages.filter((message) => !isWhatsAppStatusMessage(message)));
  } catch (error) {
    console.error('Failed to load stored messages', error);
    res.status(500).json({ error: 'Failed to load stored messages' });
  }
});

// ─── Signals (LLM-based intent signals, replacing keyword watchlist) ───

// GET /api/signals — list all signals
app.get('/api/signals', async (_req, res) => {
  try {
    const signalsCollection = await getCollection('signals');
    const messagesCollection = await getCollection('messages');
    const entries = await signalsCollection.find({}).sort({ createdAt: -1 }).toArray();

    // Recompute a TRUE, live match count per signal by counting the actual
    // non-archived, matched messages that reference that signal. This keeps the
    // sidebar number identical to what the Matched feed shows, even if rechecks
    // have over-incremented the stored counter over time.
    const bySignal = new Map(entries.map((s) => [s._id.toString(), s]));
    const matchedMessages = await messagesCollection
      .find({ matched: true, status: { $ne: 'archived' } })
      .toArray();

    for (const msg of matchedMessages) {
      const seen = new Set();
      for (const m of msg.signalMatches || []) {
        if (!m?.matchedSignalId) continue;
        const id = m.matchedSignalId.toString();
        if (seen.has(id)) continue; // count one message per signal
        seen.add(id);
        const entry = bySignal.get(id);
        if (!entry) continue;
        entry.matchCount = (entry.matchCount || 0) + 1;
      }
    }

    res.json(entries);
  } catch (error) {
    console.error('Failed to load signals', error);
    res.status(500).json({ error: 'Failed to load signals' });
  }
});

// POST /api/signals — create a new signal
app.post('/api/signals', async (req, res) => {
  try {
    const { context, keywords } = req.body;

    // Validate: at least one of context or keywords must be provided
    if ((!context || !context.trim()) && (!keywords || keywords.length === 0)) {
      return res.status(400).json({ error: 'Either context or keywords is required' });
    }

    // Normalize keywords: trim, lowercase, dedupe, max 50 chars
    const normalizedKeywords = (keywords || [])
      .map(k => String(k).trim().toLowerCase())
      .filter(k => k.length > 0 && k.length <= 50)
      .filter((k, i, arr) => arr.indexOf(k) === i);

    const signalsCollection = await getCollection('signals');
    const result = await signalsCollection.insertOne({
      context: context ? context.trim() : '',
      keywords: normalizedKeywords,
      platform: 'gmail',
      createdAt: new Date(),
      matchCount: 0,
      lastMatched: null,
    });

    const entry = await signalsCollection.findOne({ _id: result.insertedId });

    // Trigger a re-fetch of Gmail messages to match against the new signal
    // Fire-and-forget — don't block the response
    fetchAndStoreGmailMessages(50).then(fetchResult => {
      console.log('Re-fetched Gmail messages after adding signal:', fetchResult);
    }).catch(err => {
      console.error('Failed to re-fetch Gmail messages after adding signal:', err);
    });

    // Also re-check all existing messages in the database against the new signal
    recheckAllMessagesAgainstSignals().then(recheckResult => {
      console.log('Re-checked existing messages after adding signal:', recheckResult);
    }).catch(err => {
      console.error('Failed to re-check existing messages after adding signal:', err);
    });

    // Re-check keyword matches for all existing messages (cheap, no LLM calls)
    recheckKeywordMatches().then(kwResult => {
      console.log('Re-checked keyword matches after adding signal:', kwResult);
    }).catch(err => {
      console.error('Failed to re-check keyword matches after adding signal:', err);
    });

    // Invalidate the shared signal cache so WhatsApp ingestion sees the new
    // signal immediately instead of waiting up to the 60s TTL.
    refreshSignalsCache().catch(err => {
      console.error('Failed to refresh signal cache:', err);
    });

    recheckWhatsAppSignalMatches(true).then(result => {
      console.log('Re-checked existing WhatsApp messages after adding signal:', result);
    }).catch(err => {
      console.error('Failed to re-check WhatsApp messages after adding signal:', err);
    });

    res.status(201).json(entry);
  } catch (error) {
    console.error('Failed to add signal', error);
    res.status(500).json({ error: 'Failed to add signal' });
  }
});

// DELETE /api/signals/:id — delete a signal
app.delete('/api/signals/:id', async (req, res) => {
  try {
    const signalId = new ObjectId(req.params.id);
    const signalsCollection = await getCollection('signals');
    const result = await signalsCollection.deleteOne({ _id: signalId });
    if (result.deletedCount === 0) {
      return res.json({ ok: false });
    }

    // Robust cleanup: remove any references to the deleted signal from messages
    const messagesCollection = await getCollection('messages');
    const signalIdStr = signalId.toString();

    // Remove signalMatches entries that reference this signal (covers ObjectId and string forms)
    const res1 = await messagesCollection.updateMany(
      { 'signalMatches.matchedSignalId': signalId },
      { $pull: { signalMatches: { matchedSignalId: signalId } } }
    );
    const res2 = await messagesCollection.updateMany(
      { 'signalMatches.matchedSignalId': signalIdStr },
      { $pull: { signalMatches: { matchedSignalId: signalIdStr } } }
    );

    // Remove keywordSignalMatches entries that reference this signal (covers ObjectId and string forms)
    const res3 = await messagesCollection.updateMany(
      { 'keywordSignalMatches.signalId': signalId },
      { $pull: { keywordSignalMatches: { signalId: signalId } } }
    );
    const res4 = await messagesCollection.updateMany(
      { 'keywordSignalMatches.signalId': signalIdStr },
      { $pull: { keywordSignalMatches: { signalId: signalIdStr } } }
    );

    // Recompute matched/keywordMatched flags for messages that might be affected.
    // Find messages that had matches removed (either by modifiedCount or where arrays now exist/empty).
    const affectedCursor = await messagesCollection.find({
      $or: [
        { 'signalMatches': { $exists: true } },
        { 'keywordSignalMatches': { $exists: true } },
      ],
    });

    let cleanedCount = 0;
    while (await affectedCursor.hasNext()) {
      const message = await affectedCursor.next();
      const hasSignalMatches = (message.signalMatches || []).length > 0;
      const hasKeywordMatches = (message.keywordSignalMatches || []).length > 0;

      const newMatched = hasSignalMatches;
      const newKeywordMatched = hasKeywordMatches;

      if (message.matched !== newMatched || message.keywordMatched !== newKeywordMatched) {
        await messagesCollection.updateOne(
          { _id: message._id },
          {
            $set: {
              matched: newMatched,
              keywordMatched: newKeywordMatched,
              updatedAt: new Date(),
            },
            $setOnInsert: {
              createdAt: message.createdAt || new Date(),
            },
          }
        );
        cleanedCount++;
      }
    }

    const totalPulled = (res1.modifiedCount || 0) + (res2.modifiedCount || 0) + (res3.modifiedCount || 0) + (res4.modifiedCount || 0);
    if (totalPulled > 0 || cleanedCount > 0) {
      console.log(`Cleaned up matches from deleted signal ${req.params.id} — pulled: ${totalPulled}, flags fixed: ${cleanedCount}`);
    }

    recheckWhatsAppSignalMatches(true).then(waResult => {
      console.log('Re-checked existing WhatsApp messages after deleting signal:', waResult);
    }).catch(err => {
      console.error('Failed to re-check WhatsApp messages after deleting signal:', err);
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete signal', error);
    res.status(500).json({ error: 'Failed to delete signal' });
  }
});

// PATCH /api/signals/:id — update a signal's context and/or keywords
app.patch('/api/signals/:id', async (req, res) => {
  try {
    const { context, keywords } = req.body;
    const updateFields = {};

    if (context !== undefined) {
      updateFields.context = context.trim();
    }

    if (keywords !== undefined) {
      // Normalize keywords: trim, lowercase, dedupe, max 50 chars
      updateFields.keywords = (keywords || [])
        .map(k => String(k).trim().toLowerCase())
        .filter(k => k.length > 0 && k.length <= 50)
        .filter((k, i, arr) => arr.indexOf(k) === i);
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const signalId = new ObjectId(req.params.id);
    const signalsCollection = await getCollection('signals');
    const result = await signalsCollection.updateOne(
      { _id: signalId },
      { $set: { ...updateFields, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Signal not found' });
    }

    // Keep the context label in existing message matches in sync with the edited signal
    if (updateFields.context) {
      const messagesCollection = await getCollection('messages');
      await messagesCollection.updateMany(
        { 'signalMatches.matchedSignalId': signalId },
        { $set: { 'signalMatches.$[elem].context': updateFields.context, updatedAt: new Date() } },
        { arrayFilters: [{ 'elem.matchedSignalId': signalId }] }
      );
    }

    // Re-run matching so the edited signal's new intent is reflected
    recheckAllMessagesAgainstSignals().then(recheckResult => {
      console.log('Re-checked existing messages after editing signal:', recheckResult);
    }).catch(err => {
      console.error('Failed to re-check existing messages after editing signal:', err);
    });

    recheckKeywordMatches().then(kwResult => {
      console.log('Re-checked keyword matches after editing signal:', kwResult);
    }).catch(err => {
      console.error('Failed to re-check keyword matches after editing signal:', err);
    });

    recheckWhatsAppSignalMatches(true).then(waResult => {
      console.log('Re-checked WhatsApp messages after editing signal:', waResult);
    }).catch(err => {
      console.error('Failed to re-check WhatsApp messages after editing signal:', err);
    });

    const updated = await signalsCollection.findOne({ _id: signalId });
    res.json(updated);
  } catch (error) {
    console.error('Failed to update signal', error);
    res.status(500).json({ error: 'Failed to update signal' });
  }
});

app.get('/api/messages/important', async (_req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const signalsCollection = await getCollection('signals');

    // Load active signals and use string IDs for robust matching across types
    const signals = await signalsCollection.find({}, { projection: { _id: 1 } }).toArray();
    const activeSignalIdStrs = signals.map((s) => s._id.toString());
    const activeIdSet = new Set(activeSignalIdStrs);

    // Fetch all messages currently marked matched, then filter server-side to avoid type-mismatch misses
    const messages = (await messagesCollection.find({ matched: true }).sort({ timestamp: -1 }).toArray())
      .filter((message) => !isWhatsAppStatusMessage(message));

    const filtered = [];
    for (const msg of messages) {
      const remaining = (msg.signalMatches || []).filter((m) => {
        try {
          return m?.matchedSignalId && activeIdSet.has(m.matchedSignalId.toString());
        } catch (e) {
          return false;
        }
      });

      if (remaining.length > 0) {
        filtered.push({ ...msg, signalMatches: remaining });
      } else {
        // No remaining active matches — clear the matched flag to keep DB consistent
        await messagesCollection.updateOne(
          { _id: msg._id },
          { $set: { matched: false, signalMatches: [], updatedAt: new Date() } }
        );
      }
    }

    res.json(filtered);
  } catch (error) {
    console.error('Failed to load important messages', error);
    res.status(500).json({ error: 'Failed to load important messages' });
  }
});

app.get('/api/messages/inbox', async (_req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const persistedMessages = (await messagesCollection.find({}).sort({ timestamp: -1 }).toArray())
      .filter((message) => !isWhatsAppStatusMessage(message));
    const liveWhatsAppChats = getWhatsAppChatHistory();

    const persistedWhatsApp = persistedMessages.filter((m) => m.source === 'whatsapp');
    const otherMessages = persistedMessages.filter((m) => m.source !== 'whatsapp');

    // WhatsApp: one card per conversation, counting every persisted message and
    // previewing the newest one (see groupWhatsAppConversations).
    const whatsAppConversations = groupWhatsAppConversations(persistedWhatsApp, liveWhatsAppChats);

    // Non-WhatsApp (Gmail/Discord): keep the original per-message card behavior —
    // each stored message maps to its own card.
    const otherCards = otherMessages.map((msg) => ({
      ...msg,
      messageCount: 1,
      unreadCount: msg.status === 'unread' ? 1 : 0,
    }));

    const conversationList = [...otherCards, ...whatsAppConversations]
      .sort((a, b) => new Date(b.timestamp || b.createdAt || 0).getTime() - new Date(a.timestamp || a.createdAt || 0).getTime());

    res.json(conversationList);
  } catch (error) {
    console.error('Failed to load inbox messages', error);
    res.status(500).json({ error: 'Failed to load inbox messages' });
  }
});

app.get('/api/whatsapp/chats', (_req, res) => {
  res.json(getWhatsAppChatHistory());
});

// ─── Keyword-matched Inbox (All Inbox tab) ───

// GET /api/inbox — returns keyword-matched emails, filterable by signal ID
app.get('/api/inbox', async (req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const signalsCollection = await getCollection('signals');

    const signals = await signalsCollection.find({}, { projection: { _id: 1 } }).toArray();
    const activeSignalIdStrs = signals.map((s) => s._id.toString());
    const activeIdSet = new Set(activeSignalIdStrs);

    // Fetch all messages marked keywordMatched and filter in JS to avoid type mismatches
    const query = { keywordMatched: true };
    const messages = (await messagesCollection.find(query).sort({ timestamp: -1 }).toArray())
      .filter((message) => !isWhatsAppStatusMessage(message));

    const filtered = [];
    for (const msg of messages) {
      const remaining = (msg.keywordSignalMatches || []).filter((m) => {
        try {
          return m?.signalId && activeIdSet.has(m.signalId.toString());
        } catch (e) {
          return false;
        }
      });

      // If an optional signalId filter is provided, ensure at least one remaining match equals it
      if (req.query.signalId) {
        const qId = req.query.signalId.toString();
        if (!remaining.some((r) => r.signalId && r.signalId.toString() === qId)) {
          // ensure DB consistency if no remaining matches
          if (remaining.length === 0) {
            await messagesCollection.updateOne({ _id: msg._id }, { $set: { keywordMatched: false, keywordSignalMatches: [], updatedAt: new Date() } });
          }
          continue;
        }
      }

      if (remaining.length > 0) {
        filtered.push({ ...msg, keywordSignalMatches: remaining });
      } else {
        await messagesCollection.updateOne({ _id: msg._id }, { $set: { keywordMatched: false, keywordSignalMatches: [], updatedAt: new Date() } });
      }
    }

    res.json(filtered);
  } catch (error) {
    console.error('Failed to load keyword-matched inbox', error);
    res.status(500).json({ error: 'Failed to load keyword-matched inbox' });
  }
});

// ─── Signal-matched messages (Signals tab, LLM intent) ───

// GET /api/signals/messages — returns intent-matched emails, filterable by signal ID
app.get('/api/signals/messages', async (req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const signalsCollection = await getCollection('signals');

    const signals = await signalsCollection.find({}, { projection: { _id: 1 } }).toArray();
    const activeSignalIdStrs = signals.map((s) => s._id.toString());
    const activeIdSet = new Set(activeSignalIdStrs);

    // Fetch all messages marked matched and filter in JS
    const messages = (await messagesCollection.find({ matched: true }).sort({ timestamp: -1 }).toArray())
      .filter((message) => !isWhatsAppStatusMessage(message));

    const filtered = [];
    for (const msg of messages) {
      const remaining = (msg.signalMatches || []).filter((m) => {
        try {
          return m?.matchedSignalId && activeIdSet.has(m.matchedSignalId.toString());
        } catch (e) {
          return false;
        }
      });

      // Optional filter by a specific signalId
      if (req.query.signalId) {
        const qId = req.query.signalId.toString();
        if (!remaining.some((r) => r.matchedSignalId && r.matchedSignalId.toString() === qId)) {
          if (remaining.length === 0) {
            await messagesCollection.updateOne({ _id: msg._id }, { $set: { matched: false, signalMatches: [], updatedAt: new Date() } });
          }
          continue;
        }
      }

      if (remaining.length > 0) {
        filtered.push({ ...msg, signalMatches: remaining });
      } else {
        await messagesCollection.updateOne({ _id: msg._id }, { $set: { matched: false, signalMatches: [], updatedAt: new Date() } });
      }
    }

    res.json(filtered);
  } catch (error) {
    console.error('Failed to load signal-matched messages', error);
    res.status(500).json({ error: 'Failed to load signal-matched messages' });
  }
});

app.get('/api/messages/archive', async (_req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const messages = await messagesCollection.find({ status: 'archived' }).sort({ timestamp: -1 }).toArray();
    res.json(messages.filter((message) => !isWhatsAppStatusMessage(message)));
  } catch (error) {
    console.error('Failed to load archived messages', error);
    res.status(500).json({ error: 'Failed to load archived messages' });
  }
});

app.patch('/api/messages/:id/archive', async (req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const result = await messagesCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: 'archived', archivedAt: new Date() } }
    );
    res.json({ ok: result.modifiedCount > 0 });
  } catch (error) {
    console.error('Failed to archive message', error);
    res.status(500).json({ error: 'Failed to archive message' });
  }
});

app.patch('/api/messages/:id/restore', async (req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const result = await messagesCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: 'active' }, $unset: { archivedAt: '' } }
    );
    res.json({ ok: result.modifiedCount > 0 });
  } catch (error) {
    console.error('Failed to restore message', error);
    res.status(500).json({ error: 'Failed to restore message' });
  }
});

app.post('/api/gmail/fetch', async (_req, res) => {
  try {
    const result = await fetchAndStoreGmailMessages();
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Failed to fetch Gmail messages', error);
    res.status(500).json({ error: 'Failed to fetch Gmail messages' });
  }
});

// POST /api/messages/recheck — re-check all existing messages against all signals
app.post('/api/messages/recheck', async (_req, res) => {
  try {
    const result = await recheckAllMessagesAgainstSignals();
    // Also force a WhatsApp re-check so messages that were stamped signalChecked
    // before any signal existed (and hence never matched) get evaluated too.
    const whatsappResult = await recheckWhatsAppSignalMatches(true).catch((error) => {
      console.error('Failed to re-check WhatsApp messages', error);
      return { checkedCount: 0, matchedCount: 0, llmCalls: 0 };
    });
    res.json({ ok: true, ...result, whatsapp: whatsappResult });
  } catch (error) {
    console.error('Failed to re-check messages', error);
    res.status(500).json({ error: 'Failed to re-check messages' });
  }
});

// POST /api/messages/backfill-spam — backfill spam flags for existing messages
app.post('/api/messages/backfill-spam', async (_req, res) => {
  try {
    const result = await backfillSpamFlags();
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Failed to backfill spam flags', error);
    res.status(500).json({ error: 'Failed to backfill spam flags' });
  }
});

// Periodic Gmail fetch — every 15 minutes to keep messages fresh
cron.schedule('*/15 * * * *', async () => {
  try {
    console.log('[cron] Starting periodic Gmail fetch...');
    const result = await fetchAndStoreGmailMessages(50);
    console.log('[cron] Periodic Gmail fetch completed:', result);
  } catch (error) {
    console.error('[cron] Failed to fetch Gmail messages', error);
  }

  // Keep WhatsApp signal matches fresh too (messages ingested without a live
  // match get swept here). Fire-and-forget so it never blocks the Gmail cron.
  recheckWhatsAppSignalMatches().catch((error) => {
    console.error('[cron] Failed to re-check WhatsApp messages', error);
  });
});

// Prune old archived messages every 4 hours
cron.schedule('0 */4 * * *', async () => {
  try {
    const messagesCollection = await getCollection('messages');
    const cutoff = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    const result = await messagesCollection.deleteMany({ status: 'archived', archivedAt: { $lt: cutoff } });
    if (result.deletedCount > 0) {
      console.log(`[cron] Pruned ${result.deletedCount} old archived messages`);
    }
  } catch (error) {
    console.error('Failed to prune archived messages', error);
  }
});

async function startServer() {
  await connectToDatabase();
  registerAuthRoutes(app);
  registerVoiceRoutes(app);
  registerWhatsAppRoutes(app);
  registerDiscordRoutes(app);

  // Restore a previously-linked WhatsApp session automatically: if valid saved
  // Baileys credentials exist on disk, reconnect the socket as part of server
  // boot so a restarted backend resumes WhatsApp WITHOUT the user having to
  // re-click Connect in Settings. Resuming a saved session never issues a QR.
  if (hasSavedWhatsAppCredentials()) {
    startWhatsAppConnection().catch((error) => {
      console.error('[whatsapp] Failed to restore session on startup:', error.message);
    });
  } else {
    console.log('[whatsapp] No saved WhatsApp session found; a QR scan will be needed on first connect.');
  }

  // Start the persistent Discord bot connection (no OAuth flow needed). Runs
  // fire-and-forget so it never blocks server startup. Logs the bot's username
  // and servers on the 'ready' event.
  startDiscordClient().catch((error) => {
    console.error('[discord] Failed to start bot:', error.message);
  });

  // Restore saved contact names / group subjects / LID mappings so labels are
  // correct from the very first request after a restart.
  loadPersistedWhatsAppMetadata().catch((error) => {
    console.error('Failed to load persisted WhatsApp metadata:', error.message);
  });

  // Re-derive readable content/preview for WhatsApp messages that were stored
  // before system/protocol message extraction existed (fixes "No message" cards).
  backfillWhatsAppContent().catch((error) => {
    console.error('Failed to backfill WhatsApp message content:', error.message);
  });

  // Backfill signal matches for any WhatsApp messages stored before this feature
  // (or that arrived while no signals were defined). Force = true so messages
  // that an early ingest stamped signalChecked without ever checking get
  // re-evaluated now that signals exist. Fire-and-forget.
  recheckWhatsAppSignalMatches(true).catch((error) => {
    console.error('Failed to backfill WhatsApp signal matches on startup:', error.message);
  });

  // Backfill spam flags for existing messages that lack the spam field
  backfillSpamFlags().then(result => {
    console.log('Spam flag backfill completed on startup:', result);
  }).catch(err => {
    console.error('Failed to backfill spam flags on startup:', err.message);
  });

  app.listen(PORT, () => {
    console.log(`DailyEz backend running on port ${PORT}`);
  });
}

startServer();
