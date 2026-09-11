// Ad-hoc validation for the quick-alert matcher (no Mongo / network needed).
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

// signalMatching.js instantiates the Groq client at import time (via matchSignal.js),
// so the API key must be loaded BEFORE the module graph is imported.
const { normalizeAlertTarget, matchAlertTarget } = await import('../agents/signalMatching.js');

// ─── normalizeAlertTarget ───
assert.equal(normalizeAlertTarget('gmail', 'ICFAI Admissions <admissions@icfaiuniversity.in>'), 'admissions@icfaiuniversity.in');
assert.equal(normalizeAlertTarget('gmail', 'Noreply@LinkedIn.com'), 'noreply@linkedin.com');
assert.equal(normalizeAlertTarget('whatsapp', '919876543210@s.whatsapp.net'), '919876543210');
assert.equal(normalizeAlertTarget('whatsapp', '9876543210@lid'), '9876543210');
assert.equal(normalizeAlertTarget('whatsapp', '1234567890-123456@g.US'), '1234567890-123456@g.us');

// ─── matchAlertTarget: Gmail ───
const gmailSignal = { alertEnabled: true, alertTarget: 'admissions@icfaiuniversity.in', alertPlatform: 'gmail', context: 'Alerts for messages from X' };
assert.equal(matchAlertTarget({ from: 'ICFAI Admissions <admissions@icfaiuniversity.in>', source: 'gmail' }, gmailSignal).matched, true, 'gmail exact email header match');
assert.equal(matchAlertTarget({ from: 'admissions@icfaiuniversity.in', source: 'gmail' }, gmailSignal).matched, true, 'gmail plain email match');
assert.equal(matchAlertTarget({ from: 'Other <other@x.com>', source: 'gmail' }, gmailSignal).matched, false, 'gmail different sender no match');
assert.equal(matchAlertTarget({ from: 'admissions@icfaiuniversity.in', source: 'whatsapp' }, gmailSignal).matched, false, 'gmail alert never matches whatsapp message');
assert.equal(matchAlertTarget({ from: 'x@y.com' }, { alertEnabled: false, alertTarget: 'x@y.com', alertPlatform: 'gmail' }).matched, false, 'alertEnabled false never matches');

// ─── matchAlertTarget: WhatsApp ───
const waSignal = { alertEnabled: true, alertTarget: '919876543210', alertPlatform: 'whatsapp', context: 'Alerts for messages from X' };
assert.equal(matchAlertTarget({ chatId: '919876543210', from: 'Alice', source: 'whatsapp' }, waSignal).matched, true, 'whatsapp bare chatId match');
assert.equal(matchAlertTarget({ chatId: '919876543210@s.whatsapp.net', from: 'Alice', source: 'whatsapp' }, waSignal).matched, true, 'whatsapp PN JID chatId match');
assert.equal(matchAlertTarget({ senderJid: '919876543210@lid', from: 'Alice', source: 'whatsapp' }, waSignal).matched, true, 'whatsapp LID senderJid match');
assert.equal(matchAlertTarget({ chatId: '9999999999', from: 'Bob', source: 'whatsapp' }, waSignal).matched, false, 'whatsapp different chat no match');
assert.equal(matchAlertTarget({ chatId: '919876543210' }, { alertEnabled: true, alertTarget: '919876543210', alertPlatform: 'whatsapp' }).matched, true, 'whatsapp no source still matches chatId');

// group alerts
const waGroupSignal = { alertEnabled: true, alertTarget: '1234567890-123456@g.us', alertPlatform: 'whatsapp', context: 'Alerts for messages from G' };
assert.equal(matchAlertTarget({ chatId: '1234567890-123456@g.us', from: 'Group', source: 'whatsapp' }, waGroupSignal).matched, true, 'group chatId match');
assert.equal(matchAlertTarget({ chatId: '555555@g.us', from: 'Other', source: 'whatsapp' }, waGroupSignal).matched, false, 'different group no match');

// disabled / no-target signals never create a match and never break the pipeline
assert.equal(matchAlertTarget({ from: 'admissions@icfaiuniversity.in' }, { alertEnabled: true, alertTarget: '', alertPlatform: 'gmail' }).matched, false);

console.log('quick-alert matcher assertions passed');