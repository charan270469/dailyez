// Ad-hoc check: explicit Disconnect passes { purgeData: true }; logout,
// voice, and reconnect paths never do (no Mongo / network needed).
import assert from 'node:assert/strict';
import fs from 'node:fs';

const authRoutes = fs.readFileSync(new URL('../authRoutes.js', import.meta.url), 'utf8');
const whatsappRoutes = fs.readFileSync(new URL('../whatsappRoutes.js', import.meta.url), 'utf8');
const voice = fs.readFileSync(new URL('./executeVoiceAction.js', import.meta.url), 'utf8');

// Explicit Disconnect routes purge.
assert.ok(authRoutes.includes("disconnectGmail('default', { purgeData: true })"), 'authRoutes gmail purge');
assert.ok(authRoutes.includes('disconnectWhatsApp({ purgeData: true })'), 'authRoutes whatsapp purge');
assert.ok(whatsappRoutes.includes('disconnectWhatsApp({ purgeData: true })'), 'whatsappRoutes purge');

// Logout keeps session + data (no purge flag anywhere near it).
const logoutBlock = authRoutes.slice(authRoutes.indexOf('/api/auth/logout'));
assert.ok(logoutBlock.includes("disconnectWhatsApp({ preserveSession: true })"), 'logout preserves session');
assert.ok(!logoutBlock.includes('purgeData'), 'logout never purges');

// Voice disconnect keeps stored messages (no purge).
assert.ok(!voice.includes('purgeData'), 'voice never purges');
assert.ok(voice.includes('tored messages were kept, use Settings to delete them'), 'voice reply text');

console.log('disconnect-purge wiring check passed');