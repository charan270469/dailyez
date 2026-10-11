// Shared route helpers: single home for the guards index.js handlers reuse,
// so the domain route modules below don't each redefine them.
import { isWhatsAppStatusJid, normalizeWhatsAppChatIdForGrouping } from './whatsapp/connection.js';
import { normalizeAlertTarget } from './agents/signalMatching.js';

export function isWhatsAppStatusMessage(message) {
  return message?.source === 'whatsapp' && (
    isWhatsAppStatusJid(message.chatId) ||
    isWhatsAppStatusJid(message.raw?.key?.remoteJid)
  );
}

// Normalizes the Add/Edit Signal form's alert trio to the canonical form the
// alert matcher compares (same form quick-alert signals are stored in).
export function buildAlertFields(alertEnabled, alertTarget, alertPlatform) {
  const rawTarget = String(alertTarget || '').trim();
  const platform = String(alertPlatform || '').toLowerCase() === 'whatsapp' ? 'whatsapp' : 'gmail';

  if (!rawTarget) {
    return { alertEnabled: false, alertTarget: '', alertPlatform: 'gmail' };
  }

  const enabled = alertEnabled !== false;

  return {
    alertEnabled: enabled,
    alertTarget: platform === 'whatsapp'
      ? normalizeWhatsAppChatIdForGrouping(rawTarget) || rawTarget.toLowerCase()
      : normalizeAlertTarget('gmail', rawTarget) || rawTarget.toLowerCase(),
    alertPlatform: platform,
  };
}

// Keywords: trim, lowercase, dedupe, max 50 chars (used by create + patch).
export function normalizeKeywords(keywords) {
  return (keywords || [])
    .map((k) => String(k).trim().toLowerCase())
    .filter((k) => k.length > 0 && k.length <= 50)
    .filter((k, i, arr) => arr.indexOf(k) === i);
}
