// Ad-hoc validation for senderMemory key/update shape (no Mongo / network needed).
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

// Canonical homes (see DECISIONS): normalizeAlertTarget lives in orchestrator.js,
// normalizeWhatsAppChatIdForGrouping in whatsapp/connection.js.
const { buildSenderKey, buildSenderMemoryUpdate } = await import('../agents/senderMemory.js');
const { normalizeAlertTarget } = await import('../agents/orchestrator.js');
const { normalizeWhatsAppChatIdForGrouping } = await import('../whatsapp/connection.js');

// Keys reuse the existing normalization, prefixed so platforms never collide.
assert.equal(buildSenderKey('gmail', normalizeAlertTarget('gmail', 'ICFAI <Admissions@icfaiuniversity.in>')), 'gmail:admissions@icfaiuniversity.in');
assert.equal(buildSenderKey('whatsapp', normalizeWhatsAppChatIdForGrouping('919876543210@s.whatsapp.net')), 'whatsapp:919876543210');

// Unmatched first message: full shape, matchedCount 0, lastMatchedAt null.
{
  const now = new Date('2026-09-17T00:00:00Z');
  const { senderKey, update } = buildSenderMemoryUpdate({ platform: 'gmail', normalizedIdentity: 'a@x.com', displayName: 'A', matched: false, now });
  assert.equal(senderKey, 'gmail:a@x.com');
  assert.equal(update.$inc.totalMessages, 1);
  assert.equal(update.$setOnInsert.matchedCount, 0);
  assert.equal(update.$setOnInsert.lastMatchedAt, null);
  assert.equal(update.$setOnInsert.dismissedCount, 0);
  assert.equal(update.$set.lastSeenAt, now);
  assert.ok(!('lastMatchedAt' in update.$set));
}

// Matched message: lastMatchedAt set, matchedCount incremented, no update conflict
// (no path appears in both $inc and $setOnInsert).
{
  const now = new Date('2026-09-17T00:00:00Z');
  const { update } = buildSenderMemoryUpdate({ platform: 'whatsapp', normalizedIdentity: '123', displayName: 'Bob', matched: true, now });
  assert.equal(update.$inc.matchedCount, 1);
  assert.equal(update.$set.lastMatchedAt, now);
  const overlap = Object.keys(update.$inc).filter((k) => k in update.$setOnInsert);
  assert.deepEqual(overlap, []);
}

console.log('senderMemory self-check passed');
