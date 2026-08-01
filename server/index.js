import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ObjectId } from 'mongodb';
import { connectToDatabase, getCollection } from './db.js';
import { getValidAccessToken } from './auth.js';
import cron from 'node-cron';
import { registerAuthRoutes } from './authRoutes.js';
import { fetchAndStoreGmailMessages, recheckAllMessagesAgainstSignals, recheckKeywordMatches } from './gmail/fetchMessages.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

app.get('/stored-messages', async (_req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const messages = await messagesCollection.find({}).sort({ timestamp: -1 }).toArray();
    res.json(messages);
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
    const entries = await signalsCollection.find({}).sort({ createdAt: -1 }).toArray();
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

    res.status(201).json(entry);
  } catch (error) {
    console.error('Failed to add signal', error);
    res.status(500).json({ error: 'Failed to add signal' });
  }
});

// DELETE /api/signals/:id — delete a signal
app.delete('/api/signals/:id', async (req, res) => {
  try {
    const signalsCollection = await getCollection('signals');
    const result = await signalsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: result.deletedCount > 0 });
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

    const signalsCollection = await getCollection('signals');
    const result = await signalsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { ...updateFields, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Signal not found' });
    }

    const updated = await signalsCollection.findOne({ _id: new ObjectId(req.params.id) });
    res.json(updated);
  } catch (error) {
    console.error('Failed to update signal', error);
    res.status(500).json({ error: 'Failed to update signal' });
  }
});

app.get('/api/messages/important', async (_req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const messages = await messagesCollection.find({ matched: true }).sort({ timestamp: -1 }).toArray();
    res.json(messages);
  } catch (error) {
    console.error('Failed to load important messages', error);
    res.status(500).json({ error: 'Failed to load important messages' });
  }
});

app.get('/api/messages/inbox', async (_req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const messages = await messagesCollection.find({}).sort({ timestamp: -1 }).toArray();
    res.json(messages);
  } catch (error) {
    console.error('Failed to load inbox messages', error);
    res.status(500).json({ error: 'Failed to load inbox messages' });
  }
});

// ─── Keyword-matched Inbox (All Inbox tab) ───

// GET /api/inbox — returns keyword-matched emails, filterable by signal ID
app.get('/api/inbox', async (req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const query = { keywordMatched: true };

    // Optional filter by signal ID
    if (req.query.signalId) {
      query['keywordSignalMatches.signalId'] = new ObjectId(req.query.signalId);
    }

    const messages = await messagesCollection.find(query).sort({ timestamp: -1 }).toArray();
    res.json(messages);
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
    const query = { matched: true };

    // Optional filter by signal ID
    if (req.query.signalId) {
      query['signalMatches.matchedSignalId'] = new ObjectId(req.query.signalId);
    }

    const messages = await messagesCollection.find(query).sort({ timestamp: -1 }).toArray();
    res.json(messages);
  } catch (error) {
    console.error('Failed to load signal-matched messages', error);
    res.status(500).json({ error: 'Failed to load signal-matched messages' });
  }
});

app.get('/api/messages/archive', async (_req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const messages = await messagesCollection.find({ status: 'archived' }).sort({ timestamp: -1 }).toArray();
    res.json(messages);
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
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Failed to re-check messages', error);
    res.status(500).json({ error: 'Failed to re-check messages' });
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
  app.listen(PORT, () => {
    console.log(`DailyEz backend running on port ${PORT}`);
  });
}

startServer();
