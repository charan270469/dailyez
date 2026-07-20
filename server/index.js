import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ObjectId } from 'mongodb';
import { connectToDatabase, getCollection } from './db.js';
import { getValidAccessToken } from './auth.js';
import cron from 'node-cron';
import { registerAuthRoutes } from './authRoutes.js';
import { fetchAndStoreGmailMessages } from './gmail/fetchMessages.js';

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

app.get('/api/watchlist', async (_req, res) => {
  try {
    const watchlistCollection = await getCollection('watchlist');
    const entries = await watchlistCollection.find({}).sort({ createdAt: -1 }).toArray();
    res.json(entries);
  } catch (error) {
    console.error('Failed to load watchlist', error);
    res.status(500).json({ error: 'Failed to load watchlist' });
  }
});

app.post('/api/watchlist', async (req, res) => {
  try {
    const { type, platform, value } = req.body;

    if (!type || !platform || !value) {
      return res.status(400).json({ error: 'type, platform, and value are required' });
    }

    const watchlistCollection = await getCollection('watchlist');
    const result = await watchlistCollection.insertOne({
      type,
      platform,
      value,
      active: true,
      createdAt: new Date(),
    });

    const entry = await watchlistCollection.findOne({ _id: result.insertedId });
    res.status(201).json(entry);
  } catch (error) {
    console.error('Failed to add watchlist entry', error);
    res.status(500).json({ error: 'Failed to add watchlist entry' });
  }
});

app.delete('/api/watchlist/:id', async (req, res) => {
  try {
    const watchlistCollection = await getCollection('watchlist');
    const result = await watchlistCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: result.deletedCount > 0 });
  } catch (error) {
    console.error('Failed to delete watchlist entry', error);
    res.status(500).json({ error: 'Failed to delete watchlist entry' });
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

cron.schedule('0 */4 * * *', async () => {
  try {
    const messagesCollection = await getCollection('messages');
    const cutoff = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    await messagesCollection.deleteMany({ status: 'archived', archivedAt: { $lt: cutoff } });
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
