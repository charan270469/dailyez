import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWhatsAppMessage } from '../whatsapp/connection.js';

test('normalizeWhatsAppMessage converts Baileys payloads into inbox-ready message docs', () => {
  const raw = {
    key: {
      remoteJid: '919876543210@s.whatsapp.net',
      fromMe: false,
      id: '3EB0ABCDEF123',
    },
    pushName: 'Alice',
    messageTimestamp: 1710000000,
    message: {
      conversation: 'Hey, we can do the project next week.',
    },
  };

  const result = normalizeWhatsAppMessage(raw);

  assert.equal(result.source, 'whatsapp');
  assert.equal(result.id, '3EB0ABCDEF123');
  assert.equal(result.from, 'Alice');
  assert.equal(result.subject, 'WhatsApp chat');
  assert.match(result.content, /project next week/);
  assert.equal(result.preview, result.content);
  assert.ok(result.timestamp instanceof Date);
});
