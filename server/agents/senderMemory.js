// Per-sender memory collection (storage + write path only).
// Tracks match history across messages from the same sender over time:
// { senderKey, platform, displayName (UI-only, never identity),
//   totalMessages, matchedCount, dismissedCount,
//   lastSeenAt, lastMatchedAt, createdAt, updatedAt }.
//
// Identity: callers pass the EXISTING normalized identity —
// normalizeAlertTarget('gmail', ...) for Gmail (server/agents/orchestrator.js,
// re-exported via signalMatching.js), normalizeWhatsAppChatIdForGrouping(...)
// for WhatsApp (server/whatsapp/connection.js) — prefixed here with the
// platform so keys never collide across platforms.
// Matching/confidence logic must NOT read this yet (deliberate follow-up).
import { getCollection } from '../db.js';

export const SENDER_MEMORY_COLLECTION = 'senderMemory';

let senderMemoryIndexReady = false;

async function ensureSenderMemoryIndex(collection) {
  if (senderMemoryIndexReady) return;
  await collection.createIndex({ senderKey: 1 }, { unique: true });
  senderMemoryIndexReady = true;
}

/** Pure key builder so the format is testable without Mongo. */
export function buildSenderKey(platform, normalizedIdentity) {
  return `${platform}:${normalizedIdentity || ''}`;
}

/** Pure update-doc builder so the write shape is testable without Mongo. */
export function buildSenderMemoryUpdate({ platform, normalizedIdentity, displayName, matched, now = new Date() }) {
  const senderKey = buildSenderKey(platform, normalizedIdentity);
  return {
    senderKey,
    update: {
      $set: {
        platform,
        displayName: displayName || normalizedIdentity,
        lastSeenAt: now,
        updatedAt: now,
        ...(matched ? { lastMatchedAt: now } : {}),
      },
      // Fresh docs start complete: $inc creates incremented fields on insert,
      // so only the non-incremented counterparts need $setOnInsert defaults.
      // (Same path in $inc + $setOnInsert would be an update conflict.)
      $setOnInsert: {
        senderKey,
        createdAt: now,
        // dismissedCount is NOT yet wired (needs the archive/dismiss action) — stays 0.
        dismissedCount: 0,
        ...(matched ? {} : { lastMatchedAt: null, matchedCount: 0 }),
      },
      $inc: { totalMessages: 1, ...(matched ? { matchedCount: 1 } : {}) },
    },
  };
}

/**
 * Record one fully-processed message against its sender's memory doc.
 */
export async function recordSenderMemory({ platform, normalizedIdentity, displayName, matched }) {
  if (!normalizedIdentity) return null;
  const collection = await getCollection(SENDER_MEMORY_COLLECTION);
  await ensureSenderMemoryIndex(collection);
  const { senderKey, update } = buildSenderMemoryUpdate({ platform, normalizedIdentity, displayName, matched });
  await collection.updateOne({ senderKey }, update, { upsert: true });
  return senderKey;
}
