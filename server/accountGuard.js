// Per-platform account guard: records which WhatsApp number / Gmail address the
// stored data belongs to, and purges stale data when a different account links
// without an explicit Disconnect. One small doc per platform:
// { _id: 'whatsapp'|'gmail', accountId } in the `connections` collection.
import { getCollection } from './db.js';

/** Bare WhatsApp number from a Baileys user id ("9198...:46@s.whatsapp.net" -> "9198..."). */
export function bareWhatsAppNumber(userId) {
  return String(userId || '').split('@')[0].split(':')[0].trim();
}

/** Last-4 masking for logs (numbers) / domain-only for emails. */
export function maskAccountId(platform, accountId) {
  const value = String(accountId || '');
  if (platform === 'gmail') {
    const at = value.indexOf('@');
    return at >= 0 ? `***@${value.slice(at + 1)}` : '***';
  }
  return value.length > 4 ? `***${value.slice(-4)}` : '***';
}

/**
 * Compare the newly authenticated account id with the stored one and purge
 * stale data on mismatch. Reuses the Prompt 1 purge paths (never duplicated).
 * Ingestion callers must await this before starting.
 */
export async function ensurePlatformAccount(platform, accountId) {
  const name = String(platform || '').toLowerCase();
  const id = name === 'gmail' ? String(accountId || '').trim().toLowerCase() : String(accountId || '').trim();
  if ((name !== 'whatsapp' && name !== 'gmail') || !id) return { ok: true, changed: false };
  const masked = maskAccountId(name, id);
  const connections = await getCollection('connections');
  let stored = null;
  try {
    stored = await connections.findOne({ _id: name });
  } catch (error) {
    console.warn(`[guard] Failed to read ${name} account record:`, error.message);
    return { ok: true, changed: false };
  }
  if (stored?.accountId === id) return { ok: true, changed: false };
  const messagesCollection = await getCollection('messages');
  const existing = name === 'gmail'
    ? await messagesCollection.countDocuments({ $or: [{ source: 'gmail' }, { platform: 'gmail' }] })
    : await messagesCollection.countDocuments({ source: 'whatsapp' });
  if (!stored?.accountId) {
    await connections.updateOne({ _id: name }, { $set: { accountId: id, updatedAt: new Date() } }, { upsert: true });
    if (existing > 0) {
      console.warn(`[guard] No stored ${name} account; ${existing} message(s) already exist — keeping them and recording ${masked}.`);
    } else {
      console.log(`[guard] Recorded ${name} account ${masked}.`);
    }
    return { ok: true, changed: false };
  }
  // Different account linked without Disconnect: purge stale data, then record.
  console.log(`[guard] ${name} account changed from ${maskAccountId(name, stored.accountId)} to ${masked} — purging stale data.`);
  if (name === 'gmail') {
    const { clearAllGmailMessages } = await import('./gmail/fetchMessages.js');
    await clearAllGmailMessages();
  } else {
    const { clearWhatsAppAccountData, recomputeSignalMatchCounts } = await import('./whatsapp/connection.js');
    await clearWhatsAppAccountData();
    await recomputeSignalMatchCounts();
  }
  await connections.updateOne({ _id: name }, { $set: { accountId: id, updatedAt: new Date() } }, { upsert: true });
  console.log(`[guard] Recorded new ${name} account ${masked}.`);
  return { ok: true, changed: true };
}

/** Forget a platform's stored account id (explicit Disconnect only). */
export async function clearPlatformAccount(platform) {
  const name = String(platform || '').toLowerCase();
  if (name !== 'whatsapp' && name !== 'gmail') return;
  try {
    const connections = await getCollection('connections');
    await connections.deleteOne({ _id: name });
  } catch (error) {
    console.warn(`[guard] Failed to clear ${name} account record:`, error.message);
  }
}
