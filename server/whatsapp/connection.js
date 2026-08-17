// Baileys WhatsApp socket lifecycle: builds the socket, handles QR generation, connection
// updates and automatic reconnect, and persists session credentials under auth_session/.
import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import { getCollection } from '../db.js';

// Session credentials live in this folder (multi-file auth state). It is gitignored.
const AUTH_FOLDER = path.resolve(process.cwd(), 'server', 'whatsapp', 'auth_session');
const RECONNECT_DELAY_MS = 5000;

/**
 * Connection lifecycle of the WhatsApp socket.
 * - 'not_started'  : POST /api/whatsapp/connect has not been called yet.
 * - 'connecting'   : socket created, waiting for QR or scanning in progress.
 * - 'open'         : QR scanned, session authenticated and live.
 * - 'reconnecting' : connection dropped; waiting for an automatic retry.
 * - 'logged_out'   : session revoked/logged out; needs a fresh QR pair.
 */
let status = 'not_started';
let socket = null;
let reconnectTimer = null;

// Latest QR delivered by Baileys. Stored twice:
// - currentQrRaw holds the raw QR string so we can discard stale async renders.
// - currentQrDataUrl holds the rendered PNG data URL exposed via the API.
let currentQrRaw = null;
let currentQrDataUrl = null;

// WhatsApp's "confirm linking" flow issues a SECOND QR after you scan the first
// one and press Continue on the phone. Track how many distinct QRs this session
// has generated so the UI can guide the user through that re-scan.
let currentQrCount = 0;
let lastQrRaw = null;

// Baileys logs a LOT of internal noise; keep our own console logs clean.
const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL || 'silent' });

const QR_OPTIONS = { width: 300, margin: 1, errorCorrectionLevel: 'L' };

function extractWhatsAppText(messageValue) {
  if (!messageValue) return '';

  if (typeof messageValue === 'string') return messageValue;

  if (messageValue.conversation) return messageValue.conversation;
  if (messageValue.extendedTextMessage?.text) return messageValue.extendedTextMessage.text;
  if (messageValue.imageMessage?.caption) return messageValue.imageMessage.caption;
  if (messageValue.videoMessage?.caption) return messageValue.videoMessage.caption;
  if (messageValue.audioMessage?.ptt) return 'Voice note';
  if (messageValue.documentMessage?.fileName) return `Document: ${messageValue.documentMessage.fileName}`;
  if (messageValue.stickerMessage) return 'Sticker';
  if (messageValue.locationMessage) return 'Location shared';
  if (messageValue.contactMessage?.vcard) return 'Contact card';

  return 'WhatsApp media message';
}

export function normalizeWhatsAppMessage(rawMessage) {
  const key = rawMessage?.key || {};
  const remoteJid = key.remoteJid || key.participant || 'unknown@s.whatsapp.net';
  const senderName = rawMessage?.pushName || remoteJid.replace(/@s\.whatsapp\.net$/, '') || 'WhatsApp contact';
  const text = extractWhatsAppText(rawMessage?.message);
  const timestamp = new Date((Number(rawMessage?.messageTimestamp) || Date.now() / 1000) * 1000);

  return {
    id: key.id || `${remoteJid}-${timestamp.getTime()}`,
    from: senderName,
    source: 'whatsapp',
    subject: 'WhatsApp chat',
    content: text,
    preview: text,
    timestamp,
    matched: false,
    keywordMatched: false,
    signalMatches: [],
    keywordSignalMatches: [],
    status: 'active',
    chatId: remoteJid,
    raw: rawMessage,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function upsertWhatsAppMessage(rawMessage) {
  if (!rawMessage || !rawMessage.key) return;

  const normalized = normalizeWhatsAppMessage(rawMessage);
  const messagesCollection = await getCollection('messages');

  await messagesCollection.updateOne(
    { id: normalized.id, source: 'whatsapp' },
    { $set: normalized },
    { upsert: true }
  );
}

function getWhatsAppStoreEntries(store, key) {
  if (!store || !store[key]) return [];

  const value = store[key];
  if (typeof value.all === 'function') {
    return value.all();
  }
  if (typeof value.values === 'function') {
    return Array.from(value.values());
  }
  if (value instanceof Map) {
    return Array.from(value.values());
  }
  if (Array.isArray(value)) {
    return value;
  }
  return Object.values(value || {});
}

async function upsertWhatsAppChatPreview(chat) {
  if (!chat || !chat.id) return;

  const lastMessage = chat.lastMessage || {};
  const previewText = extractWhatsAppText(lastMessage.message || lastMessage)
    || 'WhatsApp chat';
  const remoteJid = chat.id;
  const preview = {
    key: {
      remoteJid,
      id: `${remoteJid}-${Date.now()}`,
    },
    pushName: chat.name || remoteJid.replace(/@s\.whatsapp\.net$/, ''),
    messageTimestamp: chat.lastMessageRecvTimestamp || chat.conversationTimestamp || Math.floor(Date.now() / 1000),
    message: { conversation: previewText },
  };

  await upsertWhatsAppMessage(preview);
}

async function syncWhatsAppStoreHistory(sock) {
  if (!sock?.store) return;

  const chats = getWhatsAppStoreEntries(sock.store, 'chats');
  const messages = getWhatsAppStoreEntries(sock.store, 'messages');

  for (const chat of chats) {
    try {
      await upsertWhatsAppChatPreview(chat);
    } catch (error) {
      console.error('[whatsapp] failed to store chat preview:', error.message);
    }
  }

  for (const msg of messages) {
    try {
      await upsertWhatsAppMessage(msg);
    } catch (error) {
      console.error('[whatsapp] failed to store history message:', error.message);
    }
  }
}

async function handleMessagesUpsert({ messages }) {
  if (!Array.isArray(messages)) return;

  for (const msg of messages) {
    try {
      await upsertWhatsAppMessage(msg);
    } catch (error) {
      console.error('[whatsapp] failed to store message:', error.message);
    }
  }
}

async function handleMessagesSet({ messages }) {
  await handleMessagesUpsert({ messages });
}

async function handleChatsUpsert(chats) {
  if (!Array.isArray(chats)) return;

  for (const chat of chats) {
    try {
      await upsertWhatsAppChatPreview(chat);
    } catch (error) {
      console.error('[whatsapp] failed to store chat snapshot:', error.message);
    }
  }
}

/**
 * Build the socket + wire its event handlers. Called on first connect and on
 * every automatic reconnect (Baileys' standard pattern: re-create the socket).
 */
async function connectSocket() {
  status = 'connecting';
  currentQrRaw = null;
  currentQrDataUrl = null;
  currentQrCount = 0;
  lastQrRaw = null;

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

  socket = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: Browsers.macOS('Chrome'),
    markOnlineOnConnect: true,
    syncFullHistory: true,
    fireInitQueries: true,
    connectTimeoutMs: 20000,
    keepAliveIntervalMs: 30000,
    defaultQueryTimeoutMs: 60000,
  });

  // Persist credentials whenever the session updates, so reconnects don't need a new QR.
  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('connection.update', handleConnectionUpdate);
  socket.ev.on('messages.upsert', handleMessagesUpsert);
  socket.ev.on('messages.set', handleMessagesSet);
  socket.ev.on('chats.upsert', handleChatsUpsert);

  setTimeout(() => {
    syncWhatsAppStoreHistory(socket).catch((error) => {
      console.error('[whatsapp] failed to sync chat history:', error.message);
    });
  }, 1500);

  console.log('[whatsapp] connection status: connecting');
}

function handleConnectionUpdate(update) {
  const { connection, lastDisconnect, qr } = update;

  // A QR is (re)issued while connecting. WhatsApp's confirmation flow can issue
  // a NEW QR in place of the first after you scan it and press Continue on the
  // phone — so we always serve whichever QR is current.
  if (qr) {
    if (qr !== lastQrRaw) {
      lastQrRaw = qr;
      currentQrCount += 1;
      console.log(`[whatsapp] QR #${currentQrCount} generated`);
    }
    currentQrRaw = qr;
    QRCode.toDataURL(qr, QR_OPTIONS)
      .then((dataUrl) => {
        // Ignore stale renders if a newer QR arrived while we were converting.
        if (currentQrRaw === qr) {
          currentQrDataUrl = dataUrl;
          console.log('[whatsapp] QR code ready at GET /api/whatsapp/qr');
        }
      })
      .catch((error) => {
        console.error('[whatsapp] Failed to render QR code:', error.message);
      });
  }

  if (connection === 'connecting') {
    status = 'connecting';
    console.log('[whatsapp] connection status: connecting');
  } else if (connection === 'open') {
    status = 'open';
    currentQrRaw = null;
    currentQrDataUrl = null;
    console.log('[whatsapp] connection status: open — session authenticated');
    if (socket?.user?.id) {
      console.log('[whatsapp] logged in as', socket.user.id);
    }
  } else if (connection === 'close') {
    // The connection closed. Determine why so we know whether to retry.
    const closeCode = lastDisconnect?.error?.output?.statusCode;
    const closeMessage = lastDisconnect?.error?.message;
    console.log(
      `[whatsapp] connection status: close` +
        (closeCode !== undefined ? ` (statusCode: ${closeCode})` : '') +
        (closeMessage ? ` — ${closeMessage}` : '')
    );

    socket = null;
    currentQrRaw = null;
    currentQrDataUrl = null;

    // Never auto-reconnect after an explicit logout — the session is gone.
    if (closeCode === DisconnectReason.loggedOut) {
      status = 'logged_out';
      console.log('[whatsapp] Session logged out. A fresh QR will be needed on next connect.');
      clearAuthSession();
      return;
    }

    // Any other reason (lost connection, timeout, restart...) → reconnect.
    status = 'reconnecting';
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  console.log(`[whatsapp] Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    console.log('[whatsapp] Attempting reconnect...');
    startWhatsAppConnection();
  }, RECONNECT_DELAY_MS);
}

/**
 * Remove the persisted session after a logout so the next connect starts with a
 * clean, valid QR pairing instead of reusing revoked credentials.
 */
function clearAuthSession() {
  try {
    if (fs.existsSync(AUTH_FOLDER)) {
      fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
      console.log('[whatsapp] Cleared auth session folder.');
    }
  } catch (error) {
    console.error('[whatsapp] Failed to clear auth session folder:', error.message);
  }
}

/**
 * Start (or restart) the WhatsApp socket. Safe to call repeatedly:
 * if a connection is already running or scheduled, it returns immediately.
 */
export async function startWhatsAppConnection() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (socket || status === 'connecting' || status === 'open') {
    return { status, alreadyRunning: true };
  }

  if (status === 'reconnecting') {
    status = 'not_started';
  }

  try {
    await connectSocket();
    return { status, alreadyRunning: false };
  } catch (error) {
    console.error('[whatsapp] Failed to start connection:', error);
    status = 'not_started';
    return { status: 'not_started', error: error.message };
  }
}

/**
 * Snapshot of the current connection state for the API route:
 * - { connected: true }            when the session is live
 * - { qr: <data URL> }             when a QR is pending (user hasn't scanned)
 * - { status: 'not_started' }      when connect has never been called
 * - { status: 'connecting' | 'reconnecting' | 'logged_out' } otherwise
 */
export function getWhatsAppConnectionState() {
  if (status === 'open') {
    return { connected: true };
  }
  if (status === 'not_started') {
    return { status: 'not_started' };
  }
  if (currentQrDataUrl) {
    return { qr: currentQrDataUrl, qrGeneration: currentQrCount };
  }
  return { status };
}

export function getWhatsAppChatHistory() {
  if (!socket?.store) return [];

  const chats = getWhatsAppStoreEntries(socket.store, 'chats');
  return chats
    .filter((chat) => chat && (chat.id || chat.name || chat.lastMessage))
    .map((chat) => {
      const id = chat.id || `${chat.name || 'whatsapp'}-${Date.now()}`;
      const lastMessage = chat.lastMessage || {};
      const text = extractWhatsAppText(lastMessage.message || lastMessage) || 'WhatsApp chat';
      const timestampValue = Number(lastMessage.messageTimestamp || chat.lastMessageRecvTimestamp || chat.conversationTimestamp || Date.now() / 1000);

      return {
        id: `wa-chat-${String(id).replace(/[^a-zA-Z0-9@._-]/g, '-')}`,
        from: chat.name || (typeof id === 'string' ? id.replace(/@s\.whatsapp\.net$/, '') : 'WhatsApp contact'),
        source: 'whatsapp',
        platform: 'WhatsApp',
        subject: 'WhatsApp chat',
        content: text,
        preview: text,
        timestamp: new Date(timestampValue * 1000 || Date.now()),
        matched: false,
        keywordMatched: false,
        signalMatches: [],
        keywordSignalMatches: [],
        status: 'active',
        chatId: id,
      };
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * Explicitly disconnect WhatsApp (user-initiated, e.g. "Disconnect" in Settings).
 * Logs the Baileys socket out so WhatsApp revokes the credentials on its side,
 * cancels any pending auto-reconnect, and wipes the persisted session so the
 * next connect starts with a clean, valid QR pairing.
 *
 * @returns {Promise<{ ok: boolean, status: string }>}
 */
export async function disconnectWhatsApp() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const activeSocket = socket;

  // Gracefully end the session so the phone no longer shows this device as linked.
  try {
    if (activeSocket) {
      await activeSocket.logout();
      console.log('[whatsapp] Socket logged out.');
    }
  } catch (error) {
    // Some sockets are already half-closed and reject logout; still clear locally.
    console.warn('[whatsapp] Socket logout error (continuing cleanup):', error.message);
  }

  socket = null;
  status = 'not_started';
  currentQrRaw = null;
  currentQrDataUrl = null;
  currentQrCount = 0;
  lastQrRaw = null;

  // Remove any persisted session so the next connect starts fresh.
  clearAuthSession();

  console.log('[whatsapp] WhatsApp disconnected.');
  return { ok: true, status: 'not_started' };
}

