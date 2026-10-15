// Signal routes: CRUD + matched-message views + sender-memory debug.
// Same registerXRoutes(app) pattern as authRoutes/voiceRoutes/whatsappRoutes.
// Handlers moved verbatim from server/index.js — no behavior change.
import { ObjectId } from 'mongodb';
import { getCollection } from './db.js';
import { fetchAndStoreGmailMessages, recheckAllMessagesAgainstSignals, recheckKeywordMatches, gmailHistoryFilter } from './gmail/fetchMessages.js';
import { normalizeWhatsAppChatIdForGrouping, recheckWhatsAppSignalMatches } from './whatsapp/connection.js';
import { refreshSignalsCache, normalizeAlertTarget } from './agents/signalMatching.js';
import { SENDER_MEMORY_COLLECTION } from './agents/senderMemory.js';
import { parseSignalEntity } from './agents/parseSignalEntity.js';
import { isWhatsAppStatusMessage, normalizeKeywords, normalizeSenderList } from './routeUtils.js';

export function registerSignalsRoutes(app) {
  // GET /api/signals — list all signals (matchCount recomputed live from
  // non-archived matched messages so it matches the Matched feed).
  app.get('/api/signals', async (_req, res) => {
    try {
      const signalsCollection = await getCollection('signals');
      const messagesCollection = await getCollection('messages');
      const entries = await signalsCollection.find({}).sort({ createdAt: -1 }).toArray();
      const bySignal = new Map(entries.map((s) => [s._id.toString(), s]));
      const matchedMessages = await messagesCollection
        .find({ matched: true, status: { $ne: 'archived' }, ...gmailHistoryFilter() })
        .toArray();
      for (const msg of matchedMessages) {
        const seen = new Set();
        for (const m of msg.signalMatches || []) {
          if (!m?.matchedSignalId) continue;
          const id = m.matchedSignalId.toString();
          if (seen.has(id)) continue;
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
      const { context, excludedCriteria, keywords, notifyOnMatch, pdfParsingEnabled, alertMailSenders, alertMessageSenders } = req.body;
      if (excludedCriteria !== undefined && typeof excludedCriteria !== 'string') {
        return res.status(400).json({ error: 'excludedCriteria must be a string' });
      }
      if ((!context || !context.trim()) && (!keywords || keywords.length === 0) && (!alertMailSenders || alertMailSenders.length === 0) && (!alertMessageSenders || alertMessageSenders.length === 0)) {
        return res.status(400).json({ error: 'Either context or keywords are required' });
      }
      const normalizedKeywords = normalizeKeywords(keywords);
      const { entityName, isSenderIntent } = parseSignalEntity(context ? context.trim() : '');
      const signalsCollection = await getCollection('signals');
      const result = await signalsCollection.insertOne({
        context: context ? context.trim() : '',
        excludedCriteria: typeof excludedCriteria === 'string' ? excludedCriteria.trim() : '',
        keywords: normalizedKeywords,
        entityName,
        isSenderIntent,
        platform: 'gmail',
        pdfParsingEnabled: pdfParsingEnabled === true,
        notifyOnMatch: notifyOnMatch === true,
        alertMailSenders: normalizeSenderList(alertMailSenders),
        alertMessageSenders: normalizeSenderList(alertMessageSenders),
        createdAt: new Date(),
        matchCount: 0,
        lastMatched: null,
      });
      const entry = await signalsCollection.findOne({ _id: result.insertedId });
      fetchAndStoreGmailMessages(50).then(fetchResult => {
        console.log('Re-fetched Gmail messages after adding signal:', fetchResult);
      }).catch(err => {
        console.error('Failed to re-fetch Gmail messages after adding signal:', err);
      });
      recheckAllMessagesAgainstSignals().then(recheckResult => {
        console.log('Re-checked existing messages after adding signal:', recheckResult);
      }).catch(err => {
        console.error('Failed to re-check existing messages after adding signal:', err);
      });
      recheckKeywordMatches().then(kwResult => {
        console.log('Re-checked keyword matches after adding signal:', kwResult);
      }).catch(err => {
        console.error('Failed to re-check keyword matches after adding signal:', err);
      });
      refreshSignalsCache().catch(err => {
        console.error('Failed to refresh signal cache:', err);
      });
      recheckWhatsAppSignalMatches(true).then(waResult => {
        console.log('Re-checked existing WhatsApp messages after adding signal:', waResult);
      }).catch(err => {
        console.error('Failed to re-check WhatsApp messages after adding signal:', err);
      });
      res.status(201).json(entry);
    } catch (error) {
      console.error('Failed to add signal', error);
      res.status(500).json({ error: 'Failed to add signal' });
    }
  });

  // POST /api/signals/quick-alert — one-click "Alert me" from a message card.
  // Dedups on alertTarget + alertPlatform so a second click is a no-op success.
  app.post('/api/signals/quick-alert', async (req, res) => {
    try {
      const { target, platform, senderName } = req.body || {};
      const alertPlatform = String(platform || '').toLowerCase() === 'whatsapp' ? 'whatsapp' : 'gmail';
      const rawTarget = String(target || '').trim();
      if (!rawTarget) {
        return res.status(400).json({ error: 'A sender target is required' });
      }
      const alertTarget = alertPlatform === 'whatsapp'
        ? normalizeWhatsAppChatIdForGrouping(rawTarget) || rawTarget.toLowerCase()
        : normalizeAlertTarget('gmail', rawTarget) || rawTarget.toLowerCase();
      const signalsCollection = await getCollection('signals');
      const existing = await signalsCollection.findOne({ alertTarget, alertPlatform, alertEnabled: true });
      if (existing) {
        return res.json({ ok: true, alreadyExists: true, signal: existing });
      }
      const displayName = (senderName && String(senderName).trim()) || alertTarget;
      const context = `Alerts for messages from ${displayName}`;
      const { entityName, isSenderIntent } = parseSignalEntity(context);
      const result = await signalsCollection.insertOne({
        context, keywords: [], entityName, isSenderIntent, platform: 'gmail',
        pdfParsingEnabled: false, alertEnabled: true, alertTarget, alertPlatform,
        createdAt: new Date(), matchCount: 0, lastMatched: null,
      });
      const entry = await signalsCollection.findOne({ _id: result.insertedId });
      if (!entry) {
        return res.status(500).json({ error: 'Failed to load created alert signal' });
      }
      fetchAndStoreGmailMessages(50).then((r) => console.log('Re-fetched Gmail messages after quick-alert:', r)).catch((err) => console.error('Failed to re-fetch Gmail messages after quick-alert:', err));
      recheckAllMessagesAgainstSignals().then((r) => console.log('Re-checked existing messages after quick-alert:', r)).catch((err) => console.error('Failed to re-check existing messages after quick-alert:', err));
      refreshSignalsCache().catch((err) => console.error('Failed to refresh signal cache after quick-alert:', err));
      recheckWhatsAppSignalMatches(true).then((r) => console.log('Re-checked existing WhatsApp messages after quick-alert:', r)).catch((err) => console.error('Failed to re-check WhatsApp messages after quick-alert:', err));
      res.status(201).json({ ok: true, created: true, signal: entry });
    } catch (error) {
      console.error('Failed to create quick alert signal', error);
      res.status(500).json({ error: 'Failed to create quick alert signal' });
    }
  });

  // DELETE /api/signals/:id — delete a signal + pull its refs from messages.
  app.delete('/api/signals/:id', async (req, res) => {
    try {
      const signalId = new ObjectId(req.params.id);
      const signalsCollection = await getCollection('signals');
      const result = await signalsCollection.deleteOne({ _id: signalId });
      if (result.deletedCount === 0) {
        return res.json({ ok: false });
      }
      const messagesCollection = await getCollection('messages');
      const signalIdStr = signalId.toString();
      await messagesCollection.updateMany({ 'signalMatches.matchedSignalId': signalId }, { $pull: { signalMatches: { matchedSignalId: signalId } } });
      await messagesCollection.updateMany({ 'signalMatches.matchedSignalId': signalIdStr }, { $pull: { signalMatches: { matchedSignalId: signalIdStr } } });
      await messagesCollection.updateMany({ 'keywordSignalMatches.signalId': signalId }, { $pull: { keywordSignalMatches: { signalId: signalId } } });
      await messagesCollection.updateMany({ 'keywordSignalMatches.signalId': signalIdStr }, { $pull: { keywordSignalMatches: { signalId: signalIdStr } } });
      const affectedCursor = await messagesCollection.find({ $or: [{ signalMatches: { $exists: true } }, { keywordSignalMatches: { $exists: true } }] });
      while (await affectedCursor.hasNext()) {
        const message = await affectedCursor.next();
        const newMatched = (message.signalMatches || []).length > 0;
        const newKeywordMatched = (message.keywordSignalMatches || []).length > 0;
        if (message.matched !== newMatched || message.keywordMatched !== newKeywordMatched) {
          await messagesCollection.updateOne({ _id: message._id }, { $set: { matched: newMatched, keywordMatched: newKeywordMatched, updatedAt: new Date() } });
        }
      }
      recheckWhatsAppSignalMatches(true).then((waResult) => {
        console.log('Re-checked existing WhatsApp messages after deleting signal:', waResult);
      }).catch((err) => console.error('Failed to re-check WhatsApp messages after deleting signal:', err));
      res.json({ ok: true });
    } catch (error) {
      console.error('Failed to delete signal', error);
      res.status(500).json({ error: 'Failed to delete signal' });
    }
  });

  // PATCH /api/signals/:id — update context/keywords/alert/PDF fields.
  app.patch('/api/signals/:id', async (req, res) => {
    try {
      const { context, excludedCriteria, keywords, notifyOnMatch, pdfParsingEnabled, alertMailSenders, alertMessageSenders } = req.body;
      const updateFields = {};
      if (excludedCriteria !== undefined) {
        if (typeof excludedCriteria !== 'string') {
          return res.status(400).json({ error: 'excludedCriteria must be a string' });
        }
        updateFields.excludedCriteria = excludedCriteria.trim();
      }
      if (context !== undefined) {
        const trimmedContext = context.trim();
        updateFields.context = trimmedContext;
        const { entityName, isSenderIntent } = parseSignalEntity(trimmedContext);
        updateFields.entityName = entityName;
        updateFields.isSenderIntent = isSenderIntent;
      }
      if (keywords !== undefined) {
        updateFields.keywords = normalizeKeywords(keywords);
      }
      if (notifyOnMatch !== undefined) {
        updateFields.notifyOnMatch = notifyOnMatch === true;
      }
      if (alertMailSenders !== undefined) {
        updateFields.alertMailSenders = normalizeSenderList(alertMailSenders);
      }
      if (alertMessageSenders !== undefined) {
        updateFields.alertMessageSenders = normalizeSenderList(alertMessageSenders);
      }
      if (pdfParsingEnabled !== undefined) {
        updateFields.pdfParsingEnabled = pdfParsingEnabled === true;
      }
      if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }
      const signalId = new ObjectId(req.params.id);
      const signalsCollection = await getCollection('signals');
      const result = await signalsCollection.updateOne({ _id: signalId }, { $set: { ...updateFields, updatedAt: new Date() } });
      if (result.matchedCount === 0) {
        return res.status(404).json({ error: 'Signal not found' });
      }
      const messagesCollection = await getCollection('messages');
      if (updateFields.context) {
        await messagesCollection.updateMany(
          { 'signalMatches.matchedSignalId': signalId },
          { $set: { 'signalMatches.$[elem].context': updateFields.context, updatedAt: new Date() } },
          { arrayFilters: [{ 'elem.matchedSignalId': signalId }] },
        );
      }
      await messagesCollection.updateMany({ lastEvaluatedSignalIds: signalId.toString() }, { $pull: { lastEvaluatedSignalIds: signalId.toString() } });
      recheckAllMessagesAgainstSignals().then((r) => console.log('Re-checked existing messages after editing signal:', r)).catch((err) => console.error('Failed to re-check existing messages after editing signal:', err));
      recheckKeywordMatches().then((r) => console.log('Re-checked keyword matches after editing signal:', r)).catch((err) => console.error('Failed to re-check keyword matches after editing signal:', err));
      recheckWhatsAppSignalMatches(true).then((r) => console.log('Re-checked WhatsApp messages after editing signal:', r)).catch((err) => console.error('Failed to re-check WhatsApp messages after editing signal:', err));
      const updated = await signalsCollection.findOne({ _id: signalId });
      res.json(updated);
    } catch (error) {
      console.error('Failed to update signal', error);
      res.status(500).json({ error: 'Failed to update signal' });
    }
  });

  // GET /api/sender-memory/:senderKey — debug/inspection only.
  app.get('/api/sender-memory/:senderKey', async (req, res) => {
    try {
      const collection = await getCollection(SENDER_MEMORY_COLLECTION);
      const record = await collection.findOne({ senderKey: req.params.senderKey });
      if (!record) return res.status(404).json({ error: 'No sender memory for this key' });
      res.json(record);
    } catch (error) {
      console.error('Failed to load sender memory', error);
      res.status(500).json({ error: 'Failed to load sender memory' });
    }
  });

  // GET /api/signals/messages — intent-matched mail, optional ?signalId=.
  app.get('/api/signals/messages', async (req, res) => {
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
}
