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
import { signalMessageMatches, getActiveSignals } from '../agents/signalMatching.js';

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

// This Baileys build does not attach an in-memory store to the socket, so we
// maintain our own caches filled from socket events. They power saving-name and
// group-subject lookups and let a resync re-ingest everything:
// - contactCache : jid (PN or LID) -> Baileys Contact ({name, lid, phoneNumber, ...})
// - chatCache    : jid -> Chat (group chats carry the subject in chat.name)
// - messageCache : message.id -> WAMessage (full history seen this session)
const contactCache = new Map();
const chatCache = new Map();
const messageCache = new Map();

// LID -> PN mappings synced from WhatsApp (messaging-history.set lidPnMappings
// and lid-mapping.update events). LID JIDs are opaque, rotating IDs; mapping
// them back to the phone number is what lets one conversation share a card even
// when history arrives keyed by a LID the phone has since changed.
const lidPnMappingCache = new Map();

// MongoDB collections used to persist contact/group metadata across restarts.
const CONTACTS_COLLECTION = 'whatsapp_contacts';
const CHATS_COLLECTION = 'whatsapp_chats';
const LID_MAPPINGS_COLLECTION = 'whatsapp_lid_mappings';

// Resync bookkeeping so the UI can wait for the history sync to actually
// complete (rather than reloading the moment the reconnect is only scheduled).
let resyncState = {
  resyncing: false,
  completedAt: null,
  cleared: 0,
  purged: 0,
};
let resyncTimeout = null;

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

  let message = messageValue;
  for (let depth = 0; depth < 5; depth += 1) {
    const wrapped =
      message?.ephemeralMessage?.message ||
      message?.viewOnceMessage?.message ||
      message?.viewOnceMessageV2?.message ||
      message?.viewOnceMessageV2Extension?.message ||
      message?.documentWithCaptionMessage?.message ||
      message?.editedMessage?.message ||
      message?.templateButtonReplyMessage?.message;
    if (!wrapped) break;
    message = wrapped;
  }

  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.imageMessage) return 'Photo was sent';
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.videoMessage) return 'Video was sent';
  if (message.audioMessage) return message.audioMessage.ptt ? 'Voice note' : 'Audio message';
  if (message.documentMessage) {
    return message.documentMessage.fileName
      ? `Document: ${message.documentMessage.fileName}`
      : 'Document was sent';
  }
  if (message.ptvMessage) return 'Video message';
  if (message.stickerMessage) return 'Sticker';
  if (message.locationMessage) return 'Location shared';
  if (message.liveLocationMessage) return 'Live location shared';
  if (message.contactMessage?.vcard) return 'Contact card';
  if (message.groupInviteMessage?.groupName) return `Group invite: ${message.groupInviteMessage.groupName}`;
  if (message.groupInviteMessage) return 'Group invite';
  if (message.pollCreationMessage) {
    const pollName = message.pollCreationMessage?.name;
    return pollName ? `Poll: ${pollName}` : 'Poll was created';
  }
  if (message.pollUpdateMessage) return 'Updated a poll';
  if (message.listMessage) {
    const listText = message.listMessage.title || message.listMessage.description;
    return listText ? `List: ${listText}` : 'List message';
  }
  if (message.listResponseMessage) {
    const selected = message.listResponseMessage?.singleSelectReply?.selectedRowId;
    return selected ? `Selected: ${selected}` : 'Responded to a list';
  }
  if (message.buttonsMessage?.contentText) return message.buttonsMessage.contentText;
  if (message.buttonsResponseMessage?.selectedButtonId) return `Pressed: ${message.buttonsResponseMessage.selectedButtonId}`;
  if (message.templateMessage?.hydratedTemplate?.hydratedContentText) return message.templateMessage.hydratedTemplate.hydratedContentText;
  if (message.templateMessage) return 'Template message';
  if (message.reactionMessage?.text) return `Reacted ${message.reactionMessage.text}`;
  if (message.scheduledCallCreationMessage) return 'Scheduled a call';
  if (message.requestPaymentMessage?.noteMessage?.extendedTextMessage?.text) {
    return message.requestPaymentMessage.noteMessage.extendedTextMessage.text;
  }
  if (message.sendPaymentMessage?.noteMessage?.extendedTextMessage?.text) {
    return message.sendPaymentMessage.noteMessage.extendedTextMessage.text;
  }
  if (message.keepInChatMessage?.keepInChatType != null) return 'Pinned a message';
  if (message.protocolMessage) return ''; // described by describeWhatsAppProtocol below

  // An empty message object (e.g. stub/system events) carries no payload — fall
  // through to describeWhatsAppStub/describeWhatsAppProtocol instead of labeling
  // it as media.
  if (Object.keys(message).length === 0) return '';

  return 'WhatsApp media message';
}

// Normalize a WhatsApp contact/JID label to a clean display name (strip every
// @s.whatsapp.net / @lid / @g.us suffix so raw JIDs never reach the UI).
function cleanWhatsAppName(value, fallback = 'Someone') {
  const v = String(value || '').trim();
  if (!v) return fallback;
  return v.replace(/@(s\.whatsapp\.net|lid|g\.us)$/i, '').trim() || fallback;
}

// Whether two JIDs (PN / LID / bare) point at the same WhatsApp account.
function isSameWhatsAppUser(jidA, jidB) {
  const a = jidBare(jidA);
  const b = jidBare(jidB);
  if (!a || !b) return false;
  if (a === b) return true;
  return lidPnMappingCache.get(a) === b || lidPnMappingCache.get(b) === a;
}

// Who performed a message event (used for system/protocol messages). Prefers
// the explicit participant and maps self-actions to "You".
function resolveWhatsAppActor(rawMessage) {
  if (rawMessage?.key?.fromMe) return 'You';
  const remoteJid = rawMessage?.key?.remoteJid;
  const participantJid = rawMessage?.key?.participant;
  const selfId = socket?.user?.id;
  if (participantJid && selfId && isSameWhatsAppUser(participantJid, selfId)) return 'You';
  const identity = participantJid
    ? resolveWhatsAppSenderLabel(remoteJid, participantJid, rawMessage?.key?.participantAlt || rawMessage?.key?.remoteJidAlt)
    : resolveWhatsAppSenderLabel(remoteJid, null);
  const label = String(identity?.sender || identity?.from || '').trim();
  return cleanWhatsAppName(label, 'Someone');
}

function resolveWhatsAppStubNames(rawMessage) {
  const names = (rawMessage?.messageStubParameters || [])
    .map((p) => (typeof p === 'string' && p.includes('@') ? cleanWhatsAppName(p) : p))
    .filter((p) => p && String(p).trim().length > 0)
    .map((p) => String(p).trim());
  return names.length ? [...new Set(names)].join(', ') : 'someone';
}

// Human-readable text for Baileys "stub" system messages — the events WhatsApp
// shows in chats ("Karthik G added Ankitha", "X changed the group subject to").
// These arrive with messageStubType + messageStubParameters and no message body.
function describeWhatsAppStub(rawMessage) {
  const stubType = rawMessage?.messageStubType;
  if (typeof stubType !== 'number') return '';
  const actor = resolveWhatsAppActor(rawMessage);
  const names = resolveWhatsAppStubNames(rawMessage);
  const params = rawMessage?.messageStubParameters || [];

  switch (stubType) {
    case 15: return `${actor} created this group`;
    case 16: {
      const subject = params[0];
      return subject
        ? `${actor} changed the group subject to "${cleanWhatsAppName(subject)}"`
        : `${actor} changed the group subject`;
    }
    case 17: return `${actor} changed the group icon`;
    case 18: return `${actor} changed this group's invite link`;
    case 19: return `${actor} changed the group description`;
    case 20: return `${actor} added ${names}`;
    case 21: return `${actor} removed ${names}`;
    case 22: return `${actor} invited ${names}`;
    case 23: return `${actor} joined the group`;
    case 24: return `${actor} left the group`;
    case 25: return `${actor} promoted ${names} to admin`;
    case 26: return `${actor} demoted ${names} from admin`;
    case 27: return `${names} joined via an invite link`;
    case 28: return `${actor} requested to join the group`;
    case 29: return `${actor} added ${names} from a join request`;
    case 30: return `${names}'s join request was removed`;
    case 31: return `${actor} changed this group's announcement setting`;
    default: return '';
  }
}

// Human-readable text for modern WhatsApp protocol/system messages (the
// protocolMessage payload Baileys uses for adds/removes/subject changes/pins).
function describeWhatsAppProtocol(rawMessage) {
  const protocol = rawMessage?.message?.protocolMessage;
  if (!protocol) return '';
  const actor = resolveWhatsAppActor(rawMessage);
  const type = typeof protocol.type === 'number' ? protocol.type : -1;
  const referredNames = (protocol.participantJidList || [])
    .map((jid) => {
      const identity = resolveWhatsAppSenderLabel(rawMessage?.key?.remoteJid, jid);
      return cleanWhatsAppName(identity?.sender || identity?.from || '');
    })
    .filter((n) => n && n !== 'Someone');
  const names = referredNames.length ? [...new Set(referredNames)].join(', ') : 'some members';

  switch (type) {
    case 7: return '(edited message)';
    case 9: return `${actor} requested to join the group`;
    case 10: return `${actor} changed the group permissions`;
    case 11: return `${actor} added ${names}`;
    case 12: return `${actor} removed ${names}`;
    case 13: return `${actor} changed group members`;
    case 14: return `${actor} forgave ${names}`;
    case 15: return `${actor} approved ${names}'s join request`;
    case 16: return `${actor} rejected ${names}'s join request`;
    case 17: {
      return protocol.pinMessage ? `${actor} pinned a message` : `${actor} unpinned a message`;
    }
    case 20: {
      const subject = protocol.subjectAndTimestamp?.subject || protocol.subject;
      return subject
        ? `${actor} changed the group subject to "${cleanWhatsAppName(subject)}"`
        : `${actor} changed the group subject`;
    }
    case 21: return `${actor} changed the group description`;
    case 22: return `${actor} changed the group icon`;
    case 23: return `${actor} revoked this group's invite link`;
    case 24: return `${actor} changed this chat's archive setting`;
    case 25: return `${actor} changed this group's invite link`;
    default: return '';
  }
}

// Full content extraction for one WhatsApp raw message: real message text
// first, then stub/protocol system events; '' only for genuinely empty ones.
function describeWhatsAppMessage(rawMessage) {
  return (
    extractWhatsAppText(rawMessage?.message) ||
    describeWhatsAppStub(rawMessage) ||
    describeWhatsAppProtocol(rawMessage) ||
    ''
  );
}

export function isWhatsAppStatusJid(jid) {
  return typeof jid === 'string' && jid.toLowerCase() === 'status@broadcast';
}

export function isWhatsAppGroupJid(jid) {
  return typeof jid === 'string' && /@g\.us$/i.test(jid);
}

// Reduce a JID like '919876543210@s.whatsapp.net' -> '919876543210' so contacts
// with no saved name display as their bare phone number.
function stripJid(jid) {
  if (typeof jid !== 'string') return '';
  const bare = jid.split('@')[0];
  return (bare && bare.trim()) || jid;
}

// The bare part of a JID (before the '@...' domain). Used so WhatsApp's three
// ID formats can be matched together: PN JIDs (9198...@s.whatsapp.net), LID
// JIDs (98765...@lid) and bare numbers.
function jidBare(jid) {
  if (typeof jid !== 'string') return '';
  return jid.split('@')[0].toLowerCase();
}

// True when a contact record matches the JID we are looking for, across the
// PN / LID / bare-number forms WhatsApp uses for the same person.
function contactMatchesJid(contact, jid) {
  if (!contact || typeof jid !== 'string') return false;
  if (contact.id && contact.id === jid) return true;
  if (contact.lid && (contact.lid === jid || `${jidBare(contact.lid)}@lid` === jid)) return true;
  if (contact.phoneNumber && contact.phoneNumber === jid) return true;
  const jb = jidBare(jid);
  if (!jb) return false;
  return (
    jidBare(contact.id) === jb ||
    jidBare(contact.lid) === jb ||
    jidBare(contact.phoneNumber) === jb
  );
}

function getStoreChat(jid) {
  if (!jid) return null;
  // Own cache first (this Baileys build has no socket.store).
  const cached = chatCache.get(jid) || chatCache.get(jid.toLowerCase());
  if (cached) return cached;

  if (!socket?.store) return null;
  if (typeof socket.store.chats?.get === 'function') {
    const hit = socket.store.chats.get(jid);
    if (hit) return hit;
  }
  return (
    getWhatsAppStoreEntries(socket.store, 'chats').find(
      (c) => c && (c.id === jid || c.jid === jid)
    ) || null
  );
}

function getStoreContact(jid) {
  if (!jid) return null;
  // Own cache: matches exact id first, then any of the PN/LID/bare forms.
  if (contactCache.has(jid)) return contactCache.get(jid);
  const jb = jidBare(jid);
  for (const candidate of contactCache.values()) {
    if (contactMatchesJid(candidate, jid) || (jb && jidBare(candidate.id) === jb)) {
      return candidate;
    }
  }

  // LID JIDs don't appear in the contacts cache until WhatsApp maps them to a
  // phone number. If we have a stored LID->PN mapping, resolve the record so a
  // LID-keyed message still surfaces the saved phone number AND the saved name.
  const mappedPn = lidPnMappingCache.get(jid) || (jb ? lidPnMappingCache.get(`${jb}@lid`) : null);
  if (mappedPn) {
    // The mapped phone may itself have a saved contact (by PN JID or bare
    // number) carrying the user's name for this person.
    const sourceContact =
      contactCache.get(mappedPn) ||
      (jb ? contactCache.get(jidBare(mappedPn)) : undefined) ||
      (Array.from(contactCache.values()).find((c) => contactMatchesJid(c, mappedPn)) || null);
    const mappedContact = {
      id: mappedPn,
      phoneNumber: mappedPn,
      lid: jid,
      // Carry the saved name from the phone-numbered contact if we have it.
      ...(sourceContact?.name ? { name: sourceContact.name } : {}),
      ...(sourceContact?.verifiedName ? { verifiedName: sourceContact.verifiedName } : {}),
    };
    // Cache it so later lookups don't redo the mapping work.
    contactCache.set(jid, mappedContact);
    return mappedContact;
  }

  if (!socket?.store) return null;
  if (typeof socket.store.contacts?.get === 'function') {
    const fast = socket.store.contacts.get(jid);
    if (fast) return fast;
  }
  return (
    getWhatsAppStoreEntries(socket.store, 'contacts').find(
      (c) => c && contactMatchesJid(c, jid)
    ) || null
  );
}

// The name the user saved for this contact in their own WhatsApp address book —
// Baileys' Contact.name field. This is STRICTLY what the user typed into their
// phone's contacts: it is never the contact's self-chosen pushName (notify),
// because the user wants names shown exactly as they saved them. Falls back to
// the chat record's name (the display name WhatsApp's server sends for the chat,
// which is also the saved contact name or group subject), then to verifiedName
// for businesses. Returns '' only when the user has no saved name — callers then
// display the phone number instead.
function resolveSavedName(jid) {
  const contact = getStoreContact(jid);
  if (contact?.name && typeof contact.name === 'string' && contact.name.trim()) {
    return contact.name.trim();
  }
  if (contact?.verifiedName && typeof contact.verifiedName === 'string' && contact.verifiedName.trim()) {
    return contact.verifiedName.trim();
  }
  const chat = getStoreChat(jid);
  if (chat?.name && typeof chat.name === 'string' && chat.name.trim()) {
    return chat.name.trim();
  }
  return '';
}

function resolveWhatsAppNumber(jid) {
  const contact = getStoreContact(jid);
  const phoneJid = contact?.phoneNumber || contact?.id;
  if (typeof phoneJid === 'string' && /@s\.whatsapp\.net$/i.test(phoneJid)) {
    return stripJid(phoneJid);
  }
  return stripJid(jid);
}

/**
 * Canonical conversation id used to group WhatsApp chats in the inbox.
 *
 * WhatsApp identifies the same 1:1 contact under several JID string formats:
 *   - phone-number JID : 919876543210@s.whatsapp.net
 *   - LID JID          : 9876543210@lid
 *   - bare number      : 919876543210
 *
 * The Baileys chat store and the incoming message events frequently carry
 * DIFFERENT forms for the same person (e.g. the chat is keyed by the PN JID
 * while the message's remoteJid is the LID). Grouping by the raw chatId would
 * split one conversation into duplicate cards, so we unify every form to the
 * contact's saved phone number when we know it and fall back to the bare
 * number otherwise. Group JIDs are already unique and returned unchanged.
 *
 * This is applied both when persisting messages (so stored chatIds agree) and
 * when the inbox merges live chats with persisted messages.
 */
export function normalizeWhatsAppChatIdForGrouping(jid) {
  if (typeof jid !== 'string' || !jid) return jid || '';
  if (isWhatsAppGroupJid(jid)) return jid.toLowerCase();
  const contact = getStoreContact(jid) || {};
  const phoneJid = contact.phoneNumber || contact.id;
  if (typeof phoneJid === 'string' && /@s\.whatsapp\.net$/i.test(phoneJid)) {
    return jidBare(phoneJid);
  }
  return jidBare(jid) || stripJid(jid) || jid;
}

// Cache of group subjects fetched from the live socket (avoid hammering
// groupMetadata() once per message in a busy group).
const groupSubjectCache = new Map();

// Asynchronous group-subject lookup: tries what's already cached / in the store
// (chat.name is the group subject WhatsApp's server sends for group chats), then
// falls back to a live groupMetadata() call. Cached afterwards.
async function fetchGroupSubject(groupJid) {
  if (typeof groupJid !== 'string') return '';
  if (groupSubjectCache.has(groupJid)) return groupSubjectCache.get(groupJid) || '';

  const chat = getStoreChat(groupJid);
  if (chat?.name && typeof chat.name === 'string' && chat.name.trim()) {
    groupSubjectCache.set(groupJid, chat.name.trim());
    return chat.name.trim();
  }
  if (chat?.metadata?.subject && String(chat.metadata.subject).trim()) {
    groupSubjectCache.set(groupJid, String(chat.metadata.subject).trim());
    return String(chat.metadata.subject).trim();
  }
  const contact = getStoreContact(groupJid);
  if (contact?.name && typeof contact.name === 'string' && contact.name.trim()) {
    groupSubjectCache.set(groupJid, contact.name.trim());
    return contact.name.trim();
  }

  if (socket?.groupMetadata && typeof socket.groupMetadata === 'function') {
    try {
      const meta = await socket.groupMetadata(groupJid);
      const subject = meta?.subject ? String(meta.subject).trim() : '';
      groupSubjectCache.set(groupJid, subject);
      return subject;
    } catch (error) {
      // Group metadata can fail (e.g. after leaving the group); remember empty.
      groupSubjectCache.set(groupJid, '');
      return '';
    }
  }
  return '';
}

// Synchronous group-subject lookup — only what's already cached or in the store.
// Also kicks off a background groupMetadata() fetch so later calls get the name.
function fetchGroupNameSync(groupJid) {
  if (typeof groupJid !== 'string') return '';
  if (groupSubjectCache.has(groupJid)) return groupSubjectCache.get(groupJid) || '';

  const chat = getStoreChat(groupJid);
  if (chat?.name && typeof chat.name === 'string' && chat.name.trim()) return chat.name.trim();
  if (chat?.metadata?.subject && String(chat.metadata.subject).trim()) {
    return String(chat.metadata.subject).trim();
  }
  const contact = getStoreContact(groupJid);
  if (contact?.name && typeof contact.name === 'string' && contact.name.trim()) return contact.name.trim();

  fetchGroupSubject(groupJid).catch(() => {});
  return '';
}

// For a group message whose subject wasn't known at normalize time, enrich the
// persisted doc with the live group name fetched from the socket.
async function enrichWhatsAppGroupSubject(messageDoc) {
  if (!messageDoc || !messageDoc.isGroup || !messageDoc.groupJid) return messageDoc;
  if (!messageDoc.groupName) {
    const subject = await fetchGroupSubject(messageDoc.groupJid);
    if (subject) {
      messageDoc.groupName = subject;
      messageDoc.from = subject;
      messageDoc.subject = `WhatsApp · ${subject}`;
    }
  }
  return messageDoc;
}

// Decide what to label the sender of a message:
// - for a group: the group's subject (mentioning which group it came from);
// - for a 1:1 chat: the contact name the user saved (else the bare number).
function resolveWhatsAppSenderLabel(remoteJid, participantJid, alternateJid) {
  const isGroup = isWhatsAppGroupJid(remoteJid);
  if (isGroup) {
    const groupName = fetchGroupNameSync(remoteJid);
    const senderJid = participantJid || alternateJid || null;
    return {
      isGroup: true,
      groupJid: remoteJid,
      groupName: groupName || null,
      from: groupName || stripJid(remoteJid) || 'WhatsApp group',
      sender: resolveSavedName(senderJid) || resolveWhatsAppNumber(senderJid),
      senderJid,
    };
  }

  const displayJid = participantJid || remoteJid;
  const lookupJid = alternateJid || displayJid;
  const saved = resolveSavedName(displayJid) || resolveSavedName(lookupJid);
  const sender = saved || resolveWhatsAppNumber(lookupJid) || 'WhatsApp contact';
  return {
    isGroup: false,
    groupJid: null,
    groupName: null,
    from: sender,
    sender,
    senderJid: lookupJid,
  };
}

export function normalizeWhatsAppMessage(rawMessage) {
  const key = rawMessage?.key || {};
  const remoteJid = key.remoteJid || key.participant || 'unknown@s.whatsapp.net';

  // NEVER ingest WhatsApp status updates ('status@broadcast') — including their
  // image/video captions — into the shared inbox.
  if (isWhatsAppStatusJid(remoteJid) || isWhatsAppStatusJid(key.participant)) {
    return null;
  }

  const identity = resolveWhatsAppSenderLabel(
    remoteJid,
    key.participant,
    key.participantAlt || key.remoteJidAlt,
  );
  const text = describeWhatsAppMessage(rawMessage);
  const timestamp = new Date((Number(rawMessage?.messageTimestamp) || Date.now() / 1000) * 1000);

  return {
    id: key.id || `${remoteJid}-${timestamp.getTime()}`,
    from: identity.from,
    sender: identity.sender,
    senderJid: identity.senderJid,
    source: 'whatsapp',
    subject: identity.isGroup && identity.groupName ? `WhatsApp · ${identity.groupName}` : 'WhatsApp chat',
    content: text,
    preview: text,
    timestamp,
    matched: false,
    keywordMatched: false,
    signalMatches: [],
    keywordSignalMatches: [],
    status: 'active',
    chatId: remoteJid,
    isGroup: identity.isGroup,
    groupName: identity.groupName,
    groupJid: identity.groupJid,
    raw: rawMessage,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Delete every persistence status update that may have been stored by earlier
 * versions (before statuses were filtered). Called on server startup and whenever
 * the socket (re)connects so legacy 'status@broadcast' records never reappear.
 */
export async function purgePersistedWhatsAppStatuses() {
  try {
    const messagesCollection = await getCollection('messages');
    const result = await messagesCollection.deleteMany({
      source: 'whatsapp',
      $or: [{ chatId: /^status@broadcast$/i }, { groupJid: /^status@broadcast$/i }],
    });
    if (result.deletedCount > 0) {
      console.log(`[whatsapp] Purged ${result.deletedCount} persisted status update(s) from the inbox.`);
    }
    return { purged: result.deletedCount };
  } catch (error) {
    console.warn('[whatsapp] Failed to purge persisted status updates:', error.message);
    return { purged: 0 };
  }
}

/**
 * Wipe every persisted WhatsApp message from the inbox so the next sync starts
 * completely fresh with the current (corrected) normalization logic.
 */
export async function clearAllWhatsAppMessages() {
  try {
    const messagesCollection = await getCollection('messages');
    const result = await messagesCollection.deleteMany({ source: 'whatsapp' });
    if (result.deletedCount > 0) {
      console.log(`[whatsapp] Cleared ${result.deletedCount} persisted WhatsApp message(s) from the inbox.`);
    } else {
      console.log('[whatsapp] No persisted WhatsApp messages to clear.');
    }
    return { cleared: result.deletedCount };
  } catch (error) {
    console.warn('[whatsapp] Failed to clear persisted WhatsApp messages:', error.message);
    return { cleared: 0 };
  }
}
// ─── Persisted WhatsApp metadata (survives server restarts) ───

// All the JID forms one contact/chat can be stored under, so backfills can match
// persisted message docs regardless of which form was used at save time.
function jidForms(jid) {
  if (typeof jid !== 'string' || !jid) return [];
  const forms = new Set([jid, jidBare(jid), jid.toLowerCase()]);
  return [...forms].filter(Boolean);
}

function contactForms(contact) {
  const forms = new Set();
  for (const jid of [contact?.id, contact?.lid, contact?.phoneNumber]) {
    for (const form of jidForms(jid)) forms.add(form);
  }
  return [...forms];
}

async function bulkPersistContacts(contacts) {
  const ops = [];
  for (const contact of contacts) {
    if (!contact?.id) continue;
    ops.push({
      updateOne: {
        filter: { _id: contact.id },
        update: {
          $set: {
            id: contact.id,
            lid: contact.lid || null,
            phoneNumber: contact.phoneNumber || null,
            name: contact.name || null,
            verifiedName: contact.verifiedName || null,
            notify: contact.notify || null,
            updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    });
  }
  if (!ops.length) return;
  try {
    const collection = await getCollection(CONTACTS_COLLECTION);
    await collection.bulkWrite(ops, { ordered: false });
  } catch (error) {
    console.warn('[whatsapp] Failed to persist contacts:', error.message);
  }
}

async function bulkPersistChats(chats) {
  const ops = [];
  for (const chat of chats) {
    if (!chat?.id) continue;
    if (isWhatsAppStatusJid(chat.id)) continue;
    ops.push({
      updateOne: {
        filter: { _id: chat.id },
        update: {
          $set: {
            id: chat.id,
            name: chat.name || null,
            subject: chat.subject || chat.metadata?.subject || null,
            lastMessageRecvTimestamp: chat.lastMessageRecvTimestamp || null,
            conversationTimestamp: chat.conversationTimestamp || null,
            updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    });
  }
  if (!ops.length) return;
  try {
    const collection = await getCollection(CHATS_COLLECTION);
    await collection.bulkWrite(ops, { ordered: false });
  } catch (error) {
    console.warn('[whatsapp] Failed to persist chat metadata:', error.message);
  }
}

async function bulkPersistLidMappings(mappings) {
  const ops = [];
  for (const mapping of mappings) {
    if (!mapping?.lid || !mapping?.pn) continue;
    lidPnMappingCache.set(mapping.lid, mapping.pn);
    ops.push({
      updateOne: {
        filter: { _id: mapping.lid },
        update: { $set: { lid: mapping.lid, pn: mapping.pn, updatedAt: new Date() } },
        upsert: true,
      },
    });
  }
  if (!ops.length) return;
  try {
    const collection = await getCollection(LID_MAPPINGS_COLLECTION);
    await collection.bulkWrite(ops, { ordered: false });
  } catch (error) {
    console.warn('[whatsapp] Failed to persist LID mappings:', error.message);
  }
}

function addContactToCache(contact) {
  if (!contact) return;
  const key = contact.id || contact.lid || contact.phoneNumber;
  if (!key) return;
  const existing = contactCache.get(key);
  const merged = existing ? { ...existing, ...contact } : contact;
  // Index under every alias so getStoreContact finds it by any JID form.
  for (const alias of [merged.id, merged.lid, merged.phoneNumber]) {
    if (alias) contactCache.set(alias, merged);
  }
}

function addChatToCache(chat) {
  if (!chat?.id) return;
  const existing = chatCache.get(chat.id) || chatCache.get(chat.id.toLowerCase());
  const merged = existing ? { ...existing, ...chat } : chat;
  chatCache.set(chat.id, merged);
  chatCache.set(chat.id.toLowerCase(), merged);
  if (isWhatsAppGroupJid(chat.id) && (chat.name || chat.metadata?.subject)) {
    groupSubjectCache.set(chat.id, (chat.name || chat.metadata.subject).trim());
  }
}
/**
 * Recompute the display labels of already-persisted WhatsApp messages after new
 * contact/group metadata arrives (contact names, LID->PN mappings, group
 * subjects). Only updates docs whose JID forms match the given list, so a live
 * contact rename or a history-sync chunk stays cheap.
 */
export async function reapplyWhatsAppLabels(jids) {
  const forms = [...new Set((jids || []).flatMap(jidForms).filter(Boolean))];
  if (forms.length === 0) return { updated: 0 };

  try {
    const messagesCollection = await getCollection('messages');
    const docs = await messagesCollection
      .find({
        source: 'whatsapp',
        $or: [
          { chatId: { $in: forms } },
          { senderJid: { $in: forms } },
          { groupJid: { $in: forms } },
          { 'raw.key.remoteJid': { $in: forms } },
          { 'raw.key.participant': { $in: forms } },
        ],
      })
      .toArray();

    let updated = 0;
    for (const doc of docs) {
      if (!doc.raw) continue;
      const normalized = normalizeWhatsAppMessage(doc.raw);
      if (!normalized) continue;
      normalized.chatId = normalizeWhatsAppChatIdForGrouping(
        normalized.chatId || normalized.senderJid || doc.raw?.key?.remoteJid
      );

      const setFields = {};
      for (const field of ['from', 'sender', 'senderJid', 'chatId', 'subject', 'groupName', 'groupJid', 'isGroup']) {
        if (doc[field] !== normalized[field]) setFields[field] = normalized[field];
      }
      if (Object.keys(setFields).length === 0) continue;

      setFields.updatedAt = new Date();
      await messagesCollection.updateOne({ _id: doc._id }, { $set: setFields });
      updated += 1;
    }

    if (updated > 0) {
      console.log(`[whatsapp] Backfilled ${updated} message label(s) after metadata change.`);
    }
    return { updated };
  } catch (error) {
    console.warn('[whatsapp] Failed to backfill message labels:', error.message);
    return { updated: 0 };
  }
}

/**
 * Load persisted contact/chat/LID metadata from MongoDB into the in-memory
 * caches at server startup, so saved names and group subjects survive restarts.
 */
export async function loadPersistedWhatsAppMetadata() {
  const counts = { contacts: 0, chats: 0, lidMappings: 0 };

  try {
    const collection = await getCollection(CONTACTS_COLLECTION);
    const contacts = await collection.find({}).toArray();
    for (const contact of contacts) {
      addContactToCache(contact);
      counts.contacts += 1;
    }
  } catch (error) {
    console.warn('[whatsapp] Failed to load persisted contacts:', error.message);
  }

  try {
    const collection = await getCollection(CHATS_COLLECTION);
    const chats = await collection.find({}).toArray();
    for (const chat of chats) {
      addChatToCache(chat);
      counts.chats += 1;
    }
  } catch (error) {
    console.warn('[whatsapp] Failed to load persisted chats:', error.message);
  }

  try {
    const collection = await getCollection(LID_MAPPINGS_COLLECTION);
    const mappings = await collection.find({}).toArray();
    for (const mapping of mappings) {
      if (mapping?.lid && mapping?.pn) {
        lidPnMappingCache.set(mapping.lid, mapping.pn);
        counts.lidMappings += 1;
      }
    }
  } catch (error) {
    console.warn('[whatsapp] Failed to load persisted LID mappings:', error.message);
  }

  console.log('[whatsapp] Loaded persisted metadata:', counts);
  return counts;
}

// ─── Resync state (used by the UI to wait for history to actually finish) ───

export function beginWhatsAppResync({ cleared = 0, purged = 0 } = {}) {
  if (resyncState.resyncing) return getWhatsAppResyncState();
  resyncState = { resyncing: true, completedAt: null, cleared, purged };
  if (resyncTimeout) clearTimeout(resyncTimeout);
  // Safety net: if the socket cannot reconnect or the history sync never
  // completes, release the UI after 2 minutes so it isn't stuck spinning.
  resyncTimeout = setTimeout(() => {
    completeWhatsAppResync();
  }, 2 * 60 * 1000);
  return getWhatsAppResyncState();
}

export function completeWhatsAppResync() {
  if (resyncTimeout) {
    clearTimeout(resyncTimeout);
    resyncTimeout = null;
  }
  if (!resyncState.resyncing) return getWhatsAppResyncState();
  resyncState.resyncing = false;
  resyncState.completedAt = Date.now();
  return getWhatsAppResyncState();
}

export function getWhatsAppResyncState() {
  return { ...resyncState };
}

/**
 * Full WhatsApp re-ingestion used by POST /api/whatsapp/resync (and the UI button):
 * 1. Delete every stored WhatsApp message so none of the stale
 *    pushName labels / old status captions / missing group names remain.
 * 2. Drop any status broadcasts again as a safety net.
 * 3. Force a FRESH history sync from the phone: Baileys skips replaying the
 *    backlog on normal reconnects (accountSyncCounter > 0), so we reset the
 *    sync checkpoint and re-establish the socket — WhatsApp then pushes the
 *    full history again, which flows through the corrected naming pipeline.
 */
export async function resyncWhatsAppMessages() {
  if (resyncState.resyncing) {
    // A resync is already in flight — return the current state instead of
    // wiping the store a second time (idempotent).
    return { ok: true, ...getWhatsAppResyncState() };
  }

  const clearResult = await clearAllWhatsAppMessages();
  const purgeResult = await purgePersistedWhatsAppStatuses();

  // Reset each own cache so re-ingestion can't reuse stale labels.
  contactCache.clear();
  chatCache.clear();
  messageCache.clear();
  groupSubjectCache.clear();

  beginWhatsAppResync({ cleared: clearResult.cleared, purged: purgeResult.purged });

  const willReconnect = resetHistorySyncCheckpoint();

  if (socket) {
    // Close softly (no logout) and let scheduleReconnect rebuild the socket
    // with the fresh checkpoint, which triggers the full-history sync.
    try {
      socket.ev.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: DisconnectReason.connectionClosed } } },
      });
    } catch (error) {
      console.warn('[whatsapp] Could not close socket for resync:', error.message);
    }
  } else if (willReconnect) {
    // Creds exist but no live socket (e.g. server restarted while disconnected):
    // start one so the full-history sync can actually run.
    startWhatsAppConnection().catch((error) => {
      console.warn('[whatsapp] Resync could not start a connection:', error.message);
    });
  }

  console.log(
    `[whatsapp] Resync scheduled: cleared=${clearResult.cleared} purged=${purgeResult.purged} reconnect=${willReconnect}`
  );
  return { ok: true, ...getWhatsAppResyncState() };
}

/**
 * Reset Baileys' persisted history-sync checkpoint (creds.json) so the next
 * socket connect asks WhatsApp for the full history again instead of skipping
 * it. Returns true when creds were found and reset.
 */
function resetHistorySyncCheckpoint() {
  try {
    const credsFile = path.join(AUTH_FOLDER, 'creds.json');
    if (!fs.existsSync(credsFile)) return false;

    const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
    const changed =
      creds.accountSyncCounter !== 0 || (creds.processedHistoryMessages && creds.processedHistoryMessages.length > 0);
    creds.accountSyncCounter = 0;
    creds.processedHistoryMessages = [];
    fs.writeFileSync(credsFile, JSON.stringify(creds, null, 2));
    return changed || true;
  } catch (error) {
    console.warn('[whatsapp] Failed to reset history-sync checkpoint:', error.message);
    return false;
  }
}

async function upsertWhatsAppMessage(rawMessage) {
  if (!rawMessage || !rawMessage.key) return;

  if (isWhatsAppStatusJid(rawMessage.key.remoteJid) || isWhatsAppStatusJid(rawMessage.key.participant)) return;

  const normalized = normalizeWhatsAppMessage(rawMessage);
  if (!normalized) return; // status updates are dropped entirely

  // Unify PN / LID / bare-number JID forms of the same contact so every stored
  // record for one conversation shares a stable chatId (prevents the inbox from
  // splitting one chat into duplicate cards).
  normalized.chatId = normalizeWhatsAppChatIdForGrouping(
    normalized.chatId || normalized.senderJid || rawMessage.key.remoteJid
  );

  // For group messages the subject may come in late (from groupMetadata), so
  // enrich just before persisting.
  await enrichWhatsAppGroupSubject(normalized);

  const messagesCollection = await getCollection('messages');

  // Carry forward any prior match state so a re-ingest (history re-sync, message
  // update, chat preview) never wipes a signal match. normalizeWhatsAppMessage
  // always resets these fields to empty, so we must merge with stored values.
  const existing = await messagesCollection.findOne({ id: normalized.id, source: 'whatsapp' });
  const alreadyMatched = !!(existing?.signalMatches?.length > 0);

  if (alreadyMatched) {
    // Already matched — don't re-run the LLM, and keep the stored match fields.
    normalized.matched = existing.matched || false;
    normalized.signalMatches = existing.signalMatches;
    normalized.keywordMatched = existing.keywordMatched || false;
    normalized.keywordSignalMatches = existing.keywordSignalMatches || [];
  } else if (!existing?.signalChecked) {
    // New or not-yet-checked message: run the shared signal-matching pipeline so
    // WhatsApp matches light up just like Gmail. Wrapped in try/catch so a
    // matching failure never blocks message ingestion.
    try {
      const signals = await getActiveSignals();
      if (signals.length > 0 && normalized.content && normalized.content.trim()) {
        const result = await signalMessageMatches(
          { from: normalized.from, subject: normalized.subject, content: normalized.content },
          signals
        );
        if (result.matches.length > 0) {
          normalized.matched = true;
          normalized.signalMatches = [...(existing?.signalMatches || []), ...result.matches];

          for (const match of result.matches) {
            const signalsCollection = await getCollection('signals');
            await signalsCollection.updateOne(
              { _id: match.matchedSignalId },
              { $inc: { matchCount: 1 }, $set: { lastMatched: new Date() } }
            );
          }
        }
        if (result.keywordMatched) {
          normalized.keywordMatched = true;
          normalized.keywordSignalMatches = [
            ...(existing?.keywordSignalMatches || []),
            ...result.keywordMatches,
          ];
        }
      } else if (existing) {
        normalized.matched = existing.matched || false;
        normalized.signalMatches = existing.signalMatches || [];
        normalized.keywordMatched = existing.keywordMatched || false;
        normalized.keywordSignalMatches = existing.keywordSignalMatches || [];
      }
      // Mark as checked so the periodic sweep doesn't re-LLM it.
      normalized.signalChecked = true;
    } catch (error) {
      console.warn('[whatsapp] Signal matching failed (storing message unchecked):', error.message);
      if (existing) {
        normalized.matched = existing.matched || false;
        normalized.signalMatches = existing.signalMatches || [];
        normalized.keywordMatched = existing.keywordMatched || false;
        normalized.keywordSignalMatches = existing.keywordSignalMatches || [];
      }
    }
  }

  await messagesCollection.updateOne(
    { id: normalized.id, source: 'whatsapp' },
    { $set: normalized },
    { upsert: true }
  );
}

/**
 * Match all stored WhatsApp messages that haven't been signal-checked yet
 * against the current signals. Backfills match state for messages that were
 * persisted before WhatsApp signal matching existed, or that arrived while no
 * signals were defined. Runs the same shared LLM/keyword pipeline Gmail uses.
 *
 * Each processed message is marked `signalChecked` so it is not re-scanned by
 * subsequent runs (it still gets re-checked by the generic add-signal recheck).
 *
 * @returns {Promise<{checkedCount:number, matchedCount:number, llmCalls:number}>}
 */
export async function recheckWhatsAppSignalMatches() {
  const messagesCollection = await getCollection('messages');
  const signals = await getActiveSignals();
  if (signals.length === 0) return { checkedCount: 0, matchedCount: 0, llmCalls: 0 };

  const docs = await messagesCollection
    .find({
      source: 'whatsapp',
      status: { $ne: 'archived' },
      signalChecked: { $ne: true },
    })
    .toArray();

  let checkedCount = 0;
  let matchedCount = 0;
  let llmCalls = 0;

  for (const doc of docs) {
    if (!doc.content || !String(doc.content).trim()) {
      await messagesCollection.updateOne(
        { _id: doc._id },
        { $set: { signalChecked: true, updatedAt: new Date() } }
      );
      continue;
    }

    const result = await signalMessageMatches(
      { from: doc.from || '', subject: doc.subject || '', content: doc.content || '' },
      signals
    );
    llmCalls += result.llmCalls;
    if (result.matches.length > 0) matchedCount++;

    await messagesCollection.updateOne(
      { _id: doc._id },
      {
        $set: {
          matched: result.matches.length > 0,
          signalMatches: result.matches,
          keywordMatched: result.keywordMatched,
          keywordSignalMatches: result.keywordMatches,
          signalChecked: true,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matches.length > 0) {
      const signalsCollection = await getCollection('signals');
      for (const match of result.matches) {
        await signalsCollection.updateOne(
          { _id: match.matchedSignalId },
          { $inc: { matchCount: 1 }, $set: { lastMatched: new Date() } }
        );
      }
    }
    checkedCount++;
  }

  console.log(
    `[whatsapp] Signal re-check complete: ${checkedCount} checked, ${matchedCount} matched, ${llmCalls} LLM calls`
  );
  return { checkedCount, matchedCount, llmCalls };
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

// Backfills readable content for WhatsApp message docs that were stored before
// extraction handled stubs/protocols/etc. Re-runs normalization on the stored
// raw WAMessage and persists whatever content/preview we can now derive. Safe
// to call repeatedly — only empty-content docs are touched.
export async function backfillWhatsAppContent() {
  try {
    const messagesCollection = await getCollection('messages');
    const docs = await messagesCollection
      .find({
        source: 'whatsapp',
        raw: { $exists: true, $ne: null },
        $or: [
          { content: { $in: ['', null] } },
          { content: { $exists: false } },
        ],
      })
      .limit(5000)
      .toArray();

    let updated = 0;
    for (const doc of docs) {
      if (!doc.raw?.key) continue;
      const normalized = normalizeWhatsAppMessage(doc.raw);
      if (!normalized || !normalized.content || !String(normalized.content).trim()) continue;

      const setFields = {
        content: normalized.content,
        preview: normalized.preview,
        updatedAt: new Date(),
      };
      for (const field of ['from', 'sender', 'subject', 'groupName', 'isGroup']) {
        if (doc[field] !== normalized[field]) setFields[field] = normalized[field];
      }

      await messagesCollection.updateOne({ _id: doc._id }, { $set: setFields });
      updated += 1;
    }

    if (updated > 0) {
      console.log(`[whatsapp] Backfilled readable content for ${updated} message(s).`);
    }
    return { scanned: docs.length, updated };
  } catch (error) {
    console.warn('[whatsapp] Failed to backfill WhatsApp content:', error.message);
    return { scanned: 0, updated: 0 };
  }
}

async function upsertWhatsAppChatPreview(chat) {
  if (!chat || !chat.id) return;
  if (isWhatsAppStatusJid(chat.id)) return;

  const lastMessage = chat.lastMessage || {};
  const previewText =
    describeWhatsAppMessage(lastMessage) ||
    extractWhatsAppText(lastMessage.message || lastMessage) ||
    'WhatsApp chat';
  const remoteJid = chat.id;
  // Stable id so repeated history-syncs update the same chat-preview doc instead
  // of creating duplicates (a chat preview is one per chat).
  const stableId = `wa-chat-${String(remoteJid).replace(/[^a-zA-Z0-9@._-]/g, '-')}`;
  const preview = {
    key: {
      remoteJid,
      id: stableId,
    },
    messageTimestamp: chat.lastMessageRecvTimestamp || chat.conversationTimestamp || Math.floor(Date.now() / 1000),
    message: { conversation: previewText },
  };

  await upsertWhatsAppMessage(preview);
}

async function syncWhatsAppStoreHistory(sock) {
  // No store on this socket build — iterate our own caches instead.
  const chats = chatCache.size > 0 ? Array.from(chatCache.values()) : (sock?.store ? getWhatsAppStoreEntries(sock.store, 'chats') : []);
  const messages = messageCache.size > 0 ? Array.from(messageCache.values()) : (sock?.store ? getWhatsAppStoreEntries(sock.store, 'messages') : []);

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
    // Cache every message we see (history + live) so a resync can re-ingest it.
    if (msg?.key?.id) {
      messageCache.set(msg.key.id, msg);
    }
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

  const groupJids = [];
  for (const chat of chats) {
    if (chat?.id) {
      addChatToCache(chat);
      if (isWhatsAppGroupJid(chat.id)) groupJids.push(chat.id);
    }
    try {
      await upsertWhatsAppChatPreview(chat);
    } catch (error) {
      console.error('[whatsapp] failed to store chat snapshot:', error.message);
    }
  }

  // Persist the metadata so group names survive restarts, and backfill any
  // messages that had been saved before this chat metadata arrived.
  bulkPersistChats(chats).catch((error) => {
    console.warn('[whatsapp] Failed to persist chats:', error.message);
  });
  if (groupJids.length) {
    reapplyWhatsAppLabels(groupJids).catch((error) => {
      console.warn('[whatsapp] Group backfill failed:', error.message);
    });
  }
}
async function handleChatsUpdate(chatUpdates) {
  if (!Array.isArray(chatUpdates)) return;
  const groupJids = [];
  const toPersist = [];
  for (const update of chatUpdates) {
    const existing = update?.id ? chatCache.get(update.id) : undefined;
    const merged = existing ? { ...existing, ...update } : { id: update?.id, ...update };
    if (merged?.id) {
      addChatToCache(merged);
      toPersist.push(merged);
      if (isWhatsAppGroupJid(merged.id)) groupJids.push(merged.id);
    }
  }

  bulkPersistChats(toPersist).catch((error) => {
    console.warn('[whatsapp] Failed to persist chat updates:', error.message);
  });
  if (groupJids.length) {
    reapplyWhatsAppLabels(groupJids).catch((error) => {
      console.warn('[whatsapp] Group update backfill failed:', error.message);
    });
  }
}

async function handleContactsUpsert(contacts) {
  if (!Array.isArray(contacts)) return;
  const affectedJids = [];
  for (const contact of contacts) {
    if (!(contact?.id || contact?.lid || contact?.phoneNumber)) continue;
    addContactToCache(contact);
    affectedJids.push(...contactForms(contact));
  }

  bulkPersistContacts(contacts).catch((error) => {
    console.warn('[whatsapp] Failed to persist contacts:', error.message);
  });
  if (affectedJids.length) {
    reapplyWhatsAppLabels(affectedJids).catch((error) => {
      console.warn('[whatsapp] Contact backfill failed:', error.message);
    });
  }
}

async function handleContactsUpdate(updates) {
  if (!Array.isArray(updates)) return;
  const affectedJids = [];
  const toPersist = [];
  for (const update of updates) {
    const key = update?.id || update?.lid || update?.phoneNumber;
    if (!key) continue;
    const merged = contactCache.get(key)
      ? { ...contactCache.get(key), ...update }
      : { id: key, ...update };
    addContactToCache(merged);
    toPersist.push(merged);
    affectedJids.push(...contactForms(merged));
  }

  bulkPersistContacts(toPersist).catch((error) => {
    console.warn('[whatsapp] Failed to persist contact updates:', error.message);
  });
  if (affectedJids.length) {
    reapplyWhatsAppLabels(affectedJids).catch((error) => {
      console.warn('[whatsapp] Contact update backfill failed:', error.message);
    });
  }
}

async function handleLidMappingUpdate(mapping) {
  if (!mapping?.lid || !mapping?.pn) return;
  await bulkPersistLidMappings([mapping]);
}

/**
 * Full-history sync entries pushed by the phone right after a connection.
 * In Baileys 7.x this is the event that replaces the old `messages.set`
 * payload — it carries chats, contacts AND the historical messages.
 */
async function handleMessagingHistorySet(eventData) {
  const { chats = [], contacts = [], messages = [], lidPnMappings = [] } = eventData || {};

  // Cache + persist LID<->PN mappings first so contacts resolve by phone.
  if (lidPnMappings.length) {
    await bulkPersistLidMappings(lidPnMappings).catch((error) => {
      console.warn('[whatsapp] Failed to persist history LID mappings:', error.message);
    });
  }

  const affectedJids = [];
  for (const mapping of lidPnMappings) {
    if (mapping?.lid) affectedJids.push(mapping.lid);
  }

  // Contacts first: names for the historical messages in this same chunk.
  for (const contact of contacts) {
    if (contact?.id || contact?.lid || contact?.phoneNumber) {
      addContactToCache(contact);
      affectedJids.push(...contactForms(contact));
    }
  }
  if (contacts.length) {
    await bulkPersistContacts(contacts).catch((error) => {
      console.warn('[whatsapp] Failed to persist history contacts:', error.message);
    });
  }

  // Chats second: group subjects for those same messages.
  for (const chat of chats) {
    if (chat?.id) {
      addChatToCache(chat);
      affectedJids.push(chat.id);
    }
  }
  if (chats.length) {
    await bulkPersistChats(chats).catch((error) => {
      console.warn('[whatsapp] Failed to persist history chats:', error.message);
    });
  }

  // Persist the actual historical messages (this is the full history).
  for (const msg of messages) {
    if (msg?.key?.id) messageCache.set(msg.key.id, msg);
    try {
      await upsertWhatsAppMessage(msg);
    } catch (error) {
      console.error('[whatsapp] failed to store history message:', error.message);
    }
  }

  // Metadata arrived after earlier chunks/messages were saved — backfill labels.
  if (affectedJids.length) {
    await reapplyWhatsAppLabels(affectedJids).catch((error) => {
      console.warn('[whatsapp] History backfill failed:', error.message);
    });
  }

  console.log(
    `[whatsapp] History set: chats=${chats.length} contacts=${contacts.length} messages=${messages.length} lidMappings=${lidPnMappings.length}`
  );
}

/**
 * History-sync completion signal (Baileys 7.x emits 'complete' once the phone
 * has pushed the full backlog). This is the moment a resync is considered done
 * — NOT the moment the reconnect was merely scheduled.
 */
async function handleMessagingHistoryStatus({ syncType, status: syncStatus, progress } = {}) {
  if (syncStatus === 'complete' && resyncState.resyncing) {
    console.log('[whatsapp] Full-history sync completed.');
    completeWhatsAppResync();
    // Newly synced (or re-synced) messages now exist — backfill signal matches.
    recheckWhatsAppSignalMatches().catch((error) => {
      console.warn('[whatsapp] Post-resync signal re-check failed:', error.message);
    });
  }
}

async function handleMessagesUpdate(messageUpdates) {
  if (!Array.isArray(messageUpdates)) return;
  for (const { key, update } of messageUpdates) {
    if (!key?.id) continue;
    const existing = messageCache.get(key.id);
    if (!existing) continue;
    const merged = { ...existing, ...update, key: { ...existing.key, ...(update.key || {}) } };
    messageCache.set(key.id, merged);
    try {
      await upsertWhatsAppMessage(merged);
    } catch (error) {
      console.error('[whatsapp] failed to store updated message:', error.message);
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
  socket.ev.on('chats.update', handleChatsUpdate);
  socket.ev.on('contacts.upsert', handleContactsUpsert);
  socket.ev.on('contacts.update', handleContactsUpdate);
  socket.ev.on('messages.update', handleMessagesUpdate);
  socket.ev.on('lid-mapping.update', handleLidMappingUpdate);
  socket.ev.on('messaging-history.set', handleMessagingHistorySet);
  socket.ev.on('messaging-history.status', handleMessagingHistoryStatus);

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

    // Once live, drop any legacy 'status@broadcast' records that earlier versions
    // may have persisted so they never reappear in the inbox.
    purgePersistedWhatsAppStatuses()
      .then((r) => {
        if (r.purged > 0) console.log(`[whatsapp] Purged ${r.purged} legacy status(es) on connect.`);
      })
      .catch((err) => console.warn('[whatsapp] Status purge on connect failed:', err.message));
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

  // Clear any legacy persisted status updates before (re)establishing the socket.
  purgePersistedWhatsAppStatuses()
    .catch((err) => console.warn('[whatsapp] Status purge on connect failed:', err.message));

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

/**
 * Returns the set of chat IDs (remoteJids) that exist in the user's WhatsApp
 * RIGHT NOW, read from the live Baileys socket store. Both the full JID and the
 * bare-number form are included so persisted records can be matched robustly.
 *
 * This is the source of truth for "what's currently in my WhatsApp". It is used
 * to hide stale persisted WhatsApp messages whose chat has been deleted or whose
 * contact is no longer present (or that came from the old full-history sync).
 */
export function getCurrentWhatsAppChatIds() {
  const ids = new Set();
  const chats = socket?.store
    ? getWhatsAppStoreEntries(socket.store, 'chats')
    : Array.from(chatCache.values());

  for (const chat of chats) {
    const jid = chat?.id;
    if (!jid) continue;
    if (isWhatsAppStatusJid(jid)) continue;
    if (typeof jid === 'string') {
      ids.add(jid);
      ids.add(jid.split('@')[0].toLowerCase()); // bare number form
    }
  }
  return ids;
}

export function getWhatsAppChatHistory() {
  const chats = socket?.store
    ? getWhatsAppStoreEntries(socket.store, 'chats')
    : Array.from(new Map(Array.from(chatCache.entries()).filter(([k]) => k.includes('@'))).values());

  return chats
    .filter((chat) => chat && !isWhatsAppStatusJid(chat.id) && (chat.id || chat.name || chat.lastMessage))
    .map((chat) => {
      const id = chat.id || `${chat.name || 'whatsapp'}-${Date.now()}`;
      const lastMessage = chat.lastMessage || {};
      const text = describeWhatsAppMessage(lastMessage)
        || extractWhatsAppText(lastMessage.message || lastMessage)
        || 'WhatsApp chat';
      const timestampValue = Number(lastMessage.messageTimestamp || chat.lastMessageRecvTimestamp || chat.conversationTimestamp || Date.now() / 1000);

      const identity = resolveWhatsAppSenderLabel(id, null);

      return {
        id: `wa-chat-${String(id).replace(/[^a-zA-Z0-9@._-]/g, '-')}`,
        from: identity.from,
        source: 'whatsapp',
        platform: 'WhatsApp',
        subject: identity.isGroup && identity.groupName ? `WhatsApp · ${identity.groupName}` : 'WhatsApp chat',
        content: text,
        preview: text,
        timestamp: new Date(timestampValue * 1000 || Date.now()),
        matched: false,
        keywordMatched: false,
        signalMatches: [],
        keywordSignalMatches: [],
        status: 'active',
        chatId: normalizeWhatsAppChatIdForGrouping(id),
        isGroup: identity.isGroup,
        groupName: identity.groupName,
        groupJid: identity.groupJid,
      };
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
/**
 * Group persisted WhatsApp message docs into one conversation card per chat.
 * messageCount = exactly the number of real (non-synthetic) persisted messages,
 * preview = the newest real message. The live chat list is only a fallback so a
 * chat still shows before its full history has been ingested.
 *
 * Pure (no DB/socket) so it is unit-testable and shared with GET /api/messages/inbox.
 */
export function groupWhatsAppConversations(persistedMessages, liveChats) {
  const liveByChat = new Map();
  for (const chat of liveChats || []) {
    const key = normalizeWhatsAppChatIdForGrouping(chat?.chatId || chat?.id);
    if (key) liveByChat.set(key, chat);
  }

  const groups = new Map();
  const persistedChatKeys = new Set();

  for (const msg of persistedMessages || []) {
    // Never surface status broadcasts as a conversation (including legacy
    // records that only carry the status JID in senderJid/groupJid).
    if (
      !msg ||
      isWhatsAppStatusJid(msg.chatId) ||
      isWhatsAppStatusJid(msg.raw?.key?.remoteJid) ||
      isWhatsAppStatusJid(msg.senderJid) ||
      isWhatsAppStatusJid(msg.groupJid)
    ) {
      continue;
    }

    const rawChatId = msg.chatId || msg.id || msg._id?.toString?.() || JSON.stringify(msg);
    const key = normalizeWhatsAppChatIdForGrouping(rawChatId);
    const conversationKey = `whatsapp:${key}`;
    persistedChatKeys.add(conversationKey);

    if (!groups.has(conversationKey)) {
      groups.set(conversationKey, { lastMessage: msg, messageCount: 0, unreadCount: 0 });
    }
    const conv = groups.get(conversationKey);
    const isPreviewDoc = typeof msg.id === 'string' && msg.id.startsWith('wa-chat-');

    if (!isPreviewDoc) {
      const currentTime = new Date(msg.timestamp || msg.createdAt || 0).getTime();
      const lastTime = new Date(conv.lastMessage.timestamp || conv.lastMessage.createdAt || 0).getTime();
      if (currentTime > lastTime) conv.lastMessage = msg;
      conv.messageCount += 1;
      if (msg.status === 'unread') conv.unreadCount += 1;
    } else if (conv.messageCount === 0) {
      // Only a synthetic preview doc exists for this chat — keep it as the
      // preview until the real history is persisted.
      const currentTime = new Date(msg.timestamp || msg.createdAt || 0).getTime();
      const lastTime = new Date(conv.lastMessage.timestamp || conv.lastMessage.createdAt || 0).getTime();
      if (currentTime > lastTime || String(conv.lastMessage.id).startsWith('wa-chat-')) {
        conv.lastMessage = msg;
      }
    }
  }

  // Live-only chats (nothing persisted yet) still appear as a card pre-sync.
  for (const [chatKey, chat] of liveByChat) {
    const conversationKey = `whatsapp:${chatKey}`;
    if (persistedChatKeys.has(conversationKey)) continue;
    groups.set(conversationKey, { lastMessage: chat, messageCount: 0, unreadCount: chat?.unreadCount || 0 });
  }

  return Array.from(groups.values()).map((conv) => ({
    ...conv.lastMessage,
    messageCount: conv.messageCount,
    unreadCount: conv.unreadCount,
  }));
}

// Exported hooks so unit tests can seed/drain the in-memory metadata caches and
// exercise deterministic name/group resolution without a live socket or DB.
export function __seedWhatsAppContact(contact) {
  addContactToCache(contact);
}
export function __seedWhatsAppChat(chat) {
  addChatToCache(chat);
}
export function __seedWhatsAppLidMapping(lid, pn) {
  lidPnMappingCache.set(lid, pn);
}
export function __clearWhatsAppCaches() {
  contactCache.clear();
  chatCache.clear();
  messageCache.clear();
  groupSubjectCache.clear();
  lidPnMappingCache.clear();
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

