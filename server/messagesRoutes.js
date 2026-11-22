// Message/inbox routes: SSE, feeds, archive, Gmail fetch, recheck.
// Same registerXRoutes(app) pattern. Handlers moved verbatim — no behavior change.
import { ObjectId } from 'mongodb';
import { getCollection } from './db.js';
import { fetchAndStoreGmailMessages, recheckAllMessagesAgainstSignals, backfillSpamFlags, gmailHistoryFilter } from './gmail/fetchMessages.js';
import { summarizeSingleEmail } from './agents/summarizeEmails.js';
import { getWhatsAppChatHistory, groupWhatsAppConversations, refreshWhatsAppConversationGroupNames, getWhatsAppHistoryCutoffMs, recheckWhatsAppSignalMatches } from './whatsapp/connection.js';
import { addMatchedClient, removeMatchedClient } from './matchedEvents.js';
import { isWhatsAppStatusMessage } from './routeUtils.js';
import { parseInboxPageParams, sliceInboxPage } from './inboxPagination.js';

export function registerMessagesRoutes(app) {
  // GET /api/messages/matched-stream — SSE push for newly matched messages.
  // ponytail: single-process client set; multi-instance deploy would need redis fan-out.
  app.get('/api/messages/matched-stream', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('\n');
    addMatchedClient(res);
    req.on('close', () => removeMatchedClient(res));
  });

  // GET /api/messages/important — LLM-matched feed (self-heals deleted-signal refs).
  app.get('/api/messages/important', async (_req, res) => {
    try {
      const messagesCollection = await getCollection('messages');
      const signalsCollection = await getCollection('signals');
      const signals = await signalsCollection.find({}, { projection: { _id: 1 } }).toArray();
      const activeIdSet = new Set(signals.map((s) => s._id.toString()));
      const messages = (await messagesCollection.find({ matched: true, ...gmailHistoryFilter() }).sort({ timestamp: -1 }).toArray())
        .filter((message) => !isWhatsAppStatusMessage(message));
      const filtered = [];
      for (const msg of messages) {
        const remaining = (msg.signalMatches || []).filter((m) => {
          try { return m?.matchedSignalId && activeIdSet.has(m.matchedSignalId.toString()); } catch { return false; }
        });
        if (remaining.length > 0) {
          filtered.push({ ...msg, signalMatches: remaining });
        } else {
          await messagesCollection.updateOne({ _id: msg._id }, { $set: { matched: false, signalMatches: [], updatedAt: new Date() } });
        }
      }
      res.json(filtered);
    } catch (error) {
      console.error('Failed to load important messages', error);
      res.status(500).json({ error: 'Failed to load important messages' });
    }
  });

  // GET /api/messages/inbox — All Inbox (full array legacy, or paged + grouped).
  app.get('/api/messages/inbox', async (req, res) => {
    try {
      const messagesCollection = await getCollection('messages');
      const { limit, cursorTime, sourceFilter, keywordOnly } = parseInboxPageParams(req.query);
      const recentWhatsAppCutoff = new Date(getWhatsAppHistoryCutoffMs());
      const persistedMessages = (
        await messagesCollection
          .find({
            ...gmailHistoryFilter(),
            ...(Number.isNaN(cursorTime) ? {} : { timestamp: { $lt: new Date(cursorTime) } }),
            ...(sourceFilter === 'gmail' || sourceFilter === 'whatsapp' ? { source: sourceFilter } : {}),
            ...(keywordOnly ? { keywordMatched: true } : {}),
            $or: [
              { source: { $ne: 'whatsapp' } },
              { source: 'whatsapp', isSystemEvent: { $ne: true }, timestamp: { $gte: recentWhatsAppCutoff } },
              { source: 'whatsapp', timestamp: { $exists: false } },
            ],
          })
          .sort({ timestamp: -1 })
          .limit(limit + 1)
          .toArray()
      ).filter((message) => !isWhatsAppStatusMessage(message));
      const liveWhatsAppChats = getWhatsAppChatHistory();
      const { pageMessages, nextCursor } = sliceInboxPage(persistedMessages, limit);
      const persistedWhatsApp = pageMessages.filter((m) => m.source === 'whatsapp');
      const otherMessages = pageMessages.filter((m) => m.source !== 'whatsapp');
      await refreshWhatsAppConversationGroupNames(persistedWhatsApp);
      const whatsAppConversations = groupWhatsAppConversations(persistedWhatsApp, liveWhatsAppChats);
      const otherCards = otherMessages.map((msg) => ({
        ...msg,
        messageCount: 1,
        unreadCount: msg.status === 'unread' ? 1 : 0,
      }));
      const conversationList = [...otherCards, ...whatsAppConversations]
        .sort((a, b) => new Date(b.timestamp || b.createdAt || 0).getTime() - new Date(a.timestamp || a.createdAt || 0).getTime());
      if (req.query.limit === undefined && req.query.cursor === undefined) {
        res.json(conversationList);
        return;
      }
      res.json({ messages: conversationList, nextCursor });
    } catch (error) {
      console.error('Failed to load inbox messages', error);
      res.status(500).json({ error: 'Failed to load inbox messages' });
    }
  });

  app.get('/api/whatsapp/chats', (_req, res) => {
    res.json(getWhatsAppChatHistory());
  });

  // GET /api/inbox — keyword-matched mail, optional ?signalId=.
  app.get('/api/inbox', async (req, res) => {
    try {
      const messagesCollection = await getCollection('messages');
      const signalsCollection = await getCollection('signals');
      const signals = await signalsCollection.find({}, { projection: { _id: 1 } }).toArray();
      const activeIdSet = new Set(signals.map((s) => s._id.toString()));
      const messages = (await messagesCollection.find({ keywordMatched: true, ...gmailHistoryFilter() }).sort({ timestamp: -1 }).toArray())
        .filter((message) => !isWhatsAppStatusMessage(message));
      const filtered = [];
      for (const msg of messages) {
        const remaining = (msg.keywordSignalMatches || []).filter((m) => {
          try { return m?.signalId && activeIdSet.has(m.signalId.toString()); } catch { return false; }
        });
        if (req.query.signalId) {
          const qId = req.query.signalId.toString();
          if (!remaining.some((r) => r.signalId && r.signalId.toString() === qId)) {
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

  app.get('/api/messages/archive', async (_req, res) => {
    try {
      const messagesCollection = await getCollection('messages');
      const messages = await messagesCollection.find({ status: 'archived', ...gmailHistoryFilter() }).sort({ timestamp: -1 }).toArray();
      res.json(messages.filter((message) => !isWhatsAppStatusMessage(message)));
    } catch (error) {
      console.error('Failed to load archived messages', error);
      res.status(500).json({ error: 'Failed to load archived messages' });
    }
  });

  app.patch('/api/messages/:id/archive', async (req, res) => {
    try {
      const messagesCollection = await getCollection('messages');
      const result = await messagesCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: 'archived', archivedAt: new Date() } });
      res.json({ ok: result.modifiedCount > 0 });
    } catch (error) {
      console.error('Failed to archive message', error);
      res.status(500).json({ error: 'Failed to archive message' });
    }
  });

  app.patch('/api/messages/:id/restore', async (req, res) => {
    try {
      const messagesCollection = await getCollection('messages');
      const result = await messagesCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: 'active' }, $unset: { archivedAt: '' } });
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

  // GET /api/messages/:id/summarize — single Gmail summary (above :id routes).
  app.get('/api/messages/:id/summarize', async (req, res) => {
    try {
      const messagesCollection = await getCollection('messages');
      let doc = null;
      try {
        doc = await messagesCollection.findOne({ _id: new ObjectId(req.params.id) });
      } catch {
        doc = null;
      }
      if (!doc) {
        res.status(404).json({ ok: false, error: 'Message not found.' });
        return;
      }
      const result = await summarizeSingleEmail(doc);
      res.json({ summary: result.summary, messageCount: result.count });
    } catch (error) {
      console.error('[gmail] summarize failed:', error);
      res.status(500).json({ ok: false, error: 'Failed to summarize this email.' });
    }
  });

  // POST /api/messages/recheck — re-check all messages against all signals.
  app.post('/api/messages/recheck', async (_req, res) => {
    try {
      const result = await recheckAllMessagesAgainstSignals();
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

  // POST /api/messages/backfill-spam — backfill spam flags for existing messages.
  app.post('/api/messages/backfill-spam', async (_req, res) => {
    try {
      const result = await backfillSpamFlags();
      res.json({ ok: true, ...result });
    } catch (error) {
      console.error('Failed to backfill spam flags:', error?.message || error);
      res.status(500).json({ error: 'Failed to backfill spam flags' });
    }
  });
}
