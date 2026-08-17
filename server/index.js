// Express server entry point for the DailyEz backend: registers all API routes,
// schedules periodic Gmail-fetch and archived-message-prune cron jobs, and starts the HTTP server.
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ObjectId } from 'mongodb';
import { getCollection } from './db.js';
import cron from 'node-cron';
import { registerAuthRoutes } from './authRoutes.js';
import { registerVoiceRoutes } from './voiceRoutes.js';
import { registerWhatsAppRoutes } from './whatsappRoutes.js';
import { fetchAndStoreGmailMessages, recheckAllMessagesAgainstSignals, recheckKeywordMatches, backfillSpamFlags, markMessageIdsAsDeleted } from './gmail/fetchMessages.js';
import { createSignal } from './agents/createSignal.js';
import { summarizeEmailsInRange } from './agents/summarizeEmails.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' })); // larger limit so base64 audio payloads are accepted

const PORT = process.env.PORT || 3001;

app.get('/', (_req, res) => {
  res.json({ message: 'DailyEz backend is running' });
});


app.get('/messages', async (_req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const messages = await messagesCollection.find({}).sort({ timestamp: -1 }).toArray();
    res.json(messages);
  } catch (error) {
    console.error('Failed to load messages', error);
    res.status(500).json({ ok: false, error: 'Failed to load messages' });
  }
});

// ─── Signals (LLM-based intent signals, replacing keyword watchlist) ───

// GET /api/signals — list all signals
app.get('/api/signals', async (_req, res) => {
  try {
    const signalsCollection = await getCollection('signals');
    const messagesCollection = await getCollection('messages');
    const entries = await signalsCollection.find({}).sort({ createdAt: -1 }).toArray();

    // Compute a TRUE current match count per signal instead of relying on the
    // cumulative `matchCount` counter (which only ever increments and never
    // drops when messages are archived/deleted or signals removed). This keeps
    // the Watchlist sidebar number consistent with the Matched tab.
    const enriched = [];
    for (const entry of entries) {
      const signalId = entry._id;
      const signalIdStr = signalId.toString();
      // Count currently-matched, non-archived messages that reference this signal.
      // matchedSignalId may be stored as ObjectId or string (legacy), so match either.
      const count = await messagesCollection.countDocuments({
        matched: true,
        status: { $ne: 'archived' },
        'signalMatches.matchedSignalId': { $in: [signalId, signalIdStr] },
      });
      enriched.push({ ...entry, matchCount: count });
    }

    res.json(enriched);
  } catch (error) {
    console.error('Failed to load signals', error);
    res.status(500).json({ ok: false, error: 'Failed to load signals' });
  }
});

// POST /api/signals — create a new signal
app.post('/api/signals', async (req, res) => {
  try {
    const { context, keywords } = req.body;

    // Validate: at least one of context or keywords must be provided
    if ((!context || !context.trim()) && (!keywords || keywords.length === 0)) {
      return res.status(400).json({ ok: false, error: 'Either context or keywords is required' });
    }

    // Shared creation logic also used by the voice agent's create_signal action
    const entry = await createSignal(context, keywords);

    res.status(201).json(entry);
  } catch (error) {
    console.error('Failed to add signal', error);
    res.status(500).json({ ok: false, error: 'Failed to add signal' });
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

    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete signal', error);
    res.status(500).json({ ok: false, error: 'Failed to delete signal' });
  }
});

// PATCH /api/signals/:id — update a signal's context and/or keywords
app.patch('/api/signals/:id', async (req, res) => {
  try {
    const { context, keywords } = req.body;
    const updateFields = {};

    if (context !== undefined) {
      updateFields.context = context.trim();
      // Re-derive the extracted entity when the context changes so the
      // deterministic source matcher always works off the latest intent.
      const parsed = parseSignalEntity(context.trim());
      updateFields.entityName = parsed.entityName;
      updateFields.isSenderIntent = parsed.isSenderIntent;
    }

    if (keywords !== undefined) {
      // Normalize keywords: trim, lowercase, dedupe, max 50 chars
      updateFields.keywords = (keywords || [])
        .map(k => String(k).trim().toLowerCase())
        .filter(k => k.length > 0 && k.length <= 50)
        .filter((k, i, arr) => arr.indexOf(k) === i);
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ ok: false, error: 'No fields to update' });
    }

    const signalId = new ObjectId(req.params.id);
    const signalsCollection = await getCollection('signals');
    const result = await signalsCollection.updateOne(
      { _id: signalId },
      { $set: { ...updateFields, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ ok: false, error: 'Signal not found' });
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

    const updated = await signalsCollection.findOne({ _id: signalId });
    res.json(updated);
  } catch (error) {
    console.error('Failed to update signal', error);
    res.status(500).json({ ok: false, error: 'Failed to update signal' });
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

    // Fetch all messages currently marked matched, then filter server-side to avoid type-mismatch misses.
    // Archived messages are excluded — they are scheduled for deletion.
    const messages = await messagesCollection.find({ matched: true, status: { $ne: 'archived' } }).sort({ timestamp: -1 }).toArray();

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
    res.status(500).json({ ok: false, error: 'Failed to load important messages' });
  }
});

app.get('/api/messages/inbox', async (_req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    // Exclude archived messages — they are scheduled for deletion and should
    // not appear in the inbox.
    const messages = await messagesCollection.find({ status: { $ne: 'archived' } }).sort({ timestamp: -1 }).toArray();
    res.json(messages);
  } catch (error) {
    console.error('Failed to load inbox messages', error);
    res.status(500).json({ ok: false, error: 'Failed to load inbox messages' });
  }
});

// ─── Message summarization (voice agent + direct API) ───

// GET /api/messages/summarize?range=today — AI summary of Gmail messages received in a date range
app.get('/api/messages/summarize', async (req, res) => {
  try {
    const range = ['today', 'yesterday', 'this_week'].includes(req.query.range)
      ? req.query.range
      : 'today';
    const result = await summarizeEmailsInRange(range);
    res.json(result);
  } catch (error) {
    console.error('Failed to summarize messages', error);
    res.status(500).json({ ok: false, error: 'Failed to summarize messages' });
  }
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

    // Fetch all messages marked keywordMatched and filter in JS to avoid type mismatches.
    // Archived messages are excluded — they are scheduled for deletion.
    const query = { keywordMatched: true, status: { $ne: 'archived' } };
    const messages = await messagesCollection.find(query).sort({ timestamp: -1 }).toArray();

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
    res.status(500).json({ ok: false, error: 'Failed to load keyword-matched inbox' });
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

    // Fetch all messages marked matched and filter in JS.
    // Archived messages are excluded — they are scheduled for deletion.
    const messages = await messagesCollection.find({ matched: true, status: { $ne: 'archived' } }).sort({ timestamp: -1 }).toArray();

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
    res.status(500).json({ ok: false, error: 'Failed to load signal-matched messages' });
  }
});

app.get('/api/messages/archive', async (_req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const messages = await messagesCollection.find({ status: 'archived' }).sort({ timestamp: -1 }).toArray();
    res.json(messages);
  } catch (error) {
    console.error('Failed to load archived messages', error);
    res.status(500).json({ ok: false, error: 'Failed to load archived messages' });
  }
});

app.patch('/api/messages/:id/archive', async (req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const message = await messagesCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!message) {
      return res.status(404).json({ ok: false, error: 'Message not found' });
    }

    const result = await messagesCollection.updateOne(
      { _id: message._id },
      { $set: { status: 'archived', archivedAt: new Date() } }
    );

    // Record the Gmail message ID so it is never re-fetched or re-matched
    // against signals after it is pruned.
    if (message.id) {
      await markMessageIdsAsDeleted([message.id]);
    }

    res.json({ ok: result.modifiedCount > 0 });
  } catch (error) {
    console.error('Failed to archive message', error);
    res.status(500).json({ ok: false, error: 'Failed to archive message' });
  }
});

app.patch('/api/messages/:id/restore', async (req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const message = await messagesCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!message) {
      return res.status(404).json({ ok: false, error: 'Message not found' });
    }

    const result = await messagesCollection.updateOne(
      { _id: message._id },
      { $set: { status: 'active' }, $unset: { archivedAt: '' } }
    );

    // Un-mark the Gmail message ID so it can be re-fetched again if needed
    if (message.id) {
      const deletedCollection = await getCollection('deletedMessageIds');
      await deletedCollection.deleteOne({ id: message.id });
    }

    res.json({ ok: result.modifiedCount > 0 });
  } catch (error) {
    console.error('Failed to restore message', error);
    res.status(500).json({ ok: false, error: 'Failed to restore message' });
  }
});

app.post('/api/gmail/fetch', async (_req, res) => {
  try {
    const result = await fetchAndStoreGmailMessages();
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Failed to fetch Gmail messages', error);
    res.status(500).json({ ok: false, error: 'Failed to fetch Gmail messages' });
  }
});

// POST /api/messages/recheck — re-check all existing messages against all signals
app.post('/api/messages/recheck', async (_req, res) => {
  try {
    const result = await recheckAllMessagesAgainstSignals();
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Failed to re-check messages', error);
    res.status(500).json({ ok: false, error: 'Failed to re-check messages' });
  }
});

// POST /api/messages/backfill-spam — backfill spam flags for existing messages
app.post('/api/messages/backfill-spam', async (_req, res) => {
  try {
    const result = await backfillSpamFlags();
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Failed to backfill spam flags', error);
    res.status(500).json({ ok: false, error: 'Failed to backfill spam flags' });
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
});

// Prune archived messages older than 1 day — runs every 4 hours
cron.schedule('0 */4 * * *', async () => {
  try {
    const messagesCollection = await getCollection('messages');
    const cutoff = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const oldArchived = await messagesCollection.find({ status: 'archived', archivedAt: { $lt: cutoff } }).toArray();

    if (oldArchived.length > 0) {
      // Record the Gmail message IDs so they are never re-fetched or re-matched
      const ids = oldArchived.map(m => m.id).filter(Boolean);
      if (ids.length > 0) {
        await markMessageIdsAsDeleted(ids);
      }

      const result = await messagesCollection.deleteMany({ _id: { $in: oldArchived.map(m => m._id) } });
      console.log(`[cron] Pruned ${result.deletedCount} old archived messages`);
    }
  } catch (error) {
    console.error('Failed to prune archived messages', error);
  }
});

async function startServer() {
  registerAuthRoutes(app);
  registerVoiceRoutes(app);
  registerWhatsAppRoutes(app);

  // Start listening immediately so the HTTP API becomes available even if the
  // database is slow or unreachable. The WhatsApp QR endpoint (and several
  // other routes) do not depend on MongoDB, and every Mongo-backed route
  // connects lazily via getCollection(), so nothing should be gated on the DB
  // being up before we can serve requests (previously a slow/hanging MongoDB
  // connection blocked app.listen() and made the QR never appear).
  app.listen(PORT, () => {
    console.log(`DailyEz backend running on port ${PORT}`);
  });

  // Best-effort database startup tasks — never block the HTTP server.
  (async () => {
    // Prune archived messages older than 1 day on startup so stale messages disappear immediately
    try {
      const messagesCollection = await getCollection('messages');
      const cutoff = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
      const oldArchived = await messagesCollection.find({ status: 'archived', archivedAt: { $lt: cutoff } }).toArray();

      if (oldArchived.length > 0) {
        // Record the Gmail message IDs so they are never re-fetched or re-matched
        const ids = oldArchived.map(m => m.id).filter(Boolean);
        if (ids.length > 0) {
          await markMessageIdsAsDeleted(ids);
        }

        const result = await messagesCollection.deleteMany({ _id: { $in: oldArchived.map(m => m._id) } });
        console.log(`[startup] Pruned ${result.deletedCount} old archived messages`);
      }
    } catch (error) {
      console.error('Failed to prune archived messages on startup:', error);
    }

    // Backfill spam flags for existing messages that lack the spam field
    backfillSpamFlags().then(result => {
      console.log('Spam flag backfill completed on startup:', result);
    }).catch(err => {
      console.error('Failed to backfill spam flags on startup:', err.message);
    });
  })();
}

startServer();
