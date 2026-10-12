import express from 'express';
import cors from 'cors';
import { config, validateRequiredConfig } from './config/env.js';
import { connectToDatabase, ensureMessageIndexes, getCollection } from './db.js';
import cron from 'node-cron';
import { registerAuthRoutes } from './authRoutes.js';
import { registerVoiceRoutes } from './voiceRoutes.js';
import { registerWhatsAppRoutes } from './whatsappRoutes.js';
import { registerSignalsRoutes } from './signalsRoutes.js';
import { registerMessagesRoutes } from './messagesRoutes.js';
import { registerSystemRoutes } from './systemRoutes.js';
import { fetchAndStoreGmailMessages, backfillSpamFlags, gmailHistoryFilter, pruneOutdatedGmailMessages } from './gmail/fetchMessages.js';
import { recheckWhatsAppSignalMatches, backfillWhatsAppContent, startWhatsAppConnection, hasSavedWhatsAppCredentials, loadPersistedWhatsAppMetadata } from './whatsapp/connection.js';
import { isWhatsAppStatusMessage } from './routeUtils.js';

validateRequiredConfig();

const app = express();

// The frontend (Vite dev server) is pinned to port 3000 and proxies /api and
// /auth/google to this backend. Accept browser requests only from that origin
// (plus any FRONTEND_URL override) so the two ports always stay in sync.
const FRONTEND_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
if (config.frontendUrl) {
  FRONTEND_ORIGINS.unshift(config.frontendUrl);
}
app.use(cors({ origin: FRONTEND_ORIGINS }));
app.use(express.json({ limit: '25mb' })); // larger limit so base64 audio payloads are accepted

// Backend port — pinned to 3001 by default (frontend runs on 3000 via Vite).
const PORT = config.port;


// Health + legacy probes stay here; signals/messages/system live in their domain modules.
app.get('/', (_req, res) => {
  res.json({ message: 'DailyEz backend is running' });
});


app.get('/messages', async (_req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const messages = await messagesCollection.find(gmailHistoryFilter()).sort({ timestamp: -1 }).toArray();
    res.json(messages.filter((message) => !isWhatsAppStatusMessage(message)));
  } catch (error) {
    console.error('Failed to load messages', error);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

app.get('/stored-messages', async (_req, res) => {
  try {
    const messagesCollection = await getCollection('messages');
    const messages = await messagesCollection.find(gmailHistoryFilter()).sort({ timestamp: -1 }).toArray();
    res.json(messages.filter((message) => !isWhatsAppStatusMessage(message)));
  } catch (error) {
    console.error('Failed to load stored messages', error);
    res.status(500).json({ error: 'Failed to load stored messages' });
  }
});
// Periodic Gmail fetch — every 2 minutes to keep messages fresh. The faster
// cadence is safe because Stages 1-4 made each cycle efficient (rate limiting,
// incremental re-evaluation, deterministic sender matching); the in-flight guard
// in fetchAndStoreGmailMessages prevents a tick from overlapping a running sync.
cron.schedule('*/2 * * * *', async () => {
  try {
    console.log('[cron] Starting periodic Gmail fetch...');
    const result = await fetchAndStoreGmailMessages(50);
    console.log('[cron] Periodic Gmail fetch completed:', result);
  } catch (error) {
    // ponytail: message-only logging — full Gaxios errors embed the refresh_token; skip retry storm when Gmail auth is dead.
    if (error?.code === 'GMAIL_AUTH_INVALID') {
      console.error('[cron] Gmail auth invalid, skipping until reconnect:', error.message);
      return;
    }
    console.error('[cron] Failed to fetch Gmail messages:', error?.message || error);
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
  registerAuthRoutes(app);
  registerVoiceRoutes(app);
  registerWhatsAppRoutes(app);
  registerSignalsRoutes(app);
  registerMessagesRoutes(app);
  registerSystemRoutes(app);

  // Register routes and listen before the database handshake. OAuth and status
  // requests should return a useful error while MongoDB is unavailable instead
  // of leaving the browser waiting for the backend to start.
  app.listen(PORT, () => {
    console.log(`DailyEz backend running on port ${PORT}`);
  });

  let db;
  try {
    db = await connectToDatabase();
    if (db) {
      await ensureMessageIndexes(db);
    }
  } catch (error) {
    console.error('Initial MongoDB connection failed; the server remains available for retries:', error.message);
  }
  if (db) {
    try {
      await pruneOutdatedGmailMessages();
    } catch (error) {
      console.error('Failed to prune outdated Gmail messages on startup:', error.message);
    }
  }

  // Restore a previously-linked WhatsApp session automatically: if valid saved
  // Baileys credentials exist on disk, reconnect the socket as part of server
  // boot so a restarted backend resumes WhatsApp WITHOUT the user having to
  // re-click Connect in Settings. Resuming a saved session never issues a pairing code.
  if (hasSavedWhatsAppCredentials()) {
    startWhatsAppConnection().catch((error) => {
      console.error('[whatsapp] Failed to restore session on startup:', error.message);
    });
  } else {
    console.log('[whatsapp] No saved WhatsApp session found; a pairing code will be needed on first connect.');
  }

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
    console.error('Failed to backfill spam flags on startup:', err?.message || err);
  });

}

startServer();