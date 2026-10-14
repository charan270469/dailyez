// Ad-hoc check: per-platform account guard wiring (no Mongo / network needed).
import assert from 'node:assert/strict';
import fs from 'node:fs';

const guard = await import('../accountGuard.js');
const connectionSrc = fs.readFileSync(new URL('../whatsapp/connection.js', import.meta.url), 'utf8');
const authRoutes = fs.readFileSync(new URL('../authRoutes.js', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../auth.js', import.meta.url), 'utf8');

// Pure helpers: bare number strips device suffix + domain; logs mask.
assert.equal(guard.bareWhatsAppNumber('919876543210:46@s.whatsapp.net'), '919876543210');
assert.equal(guard.bareWhatsAppNumber('919876543210@s.whatsapp.net'), '919876543210');
assert.equal(guard.maskAccountId('whatsapp', '919876543210'), '***3210');
assert.equal(guard.maskAccountId('gmail', 'User@Example.COM'.toLowerCase()), '***@example.com');

// Guard reuses Prompt 1 purge paths (no duplicate deleteMany in the guard).
assert.ok(!/deleteMany/.test(fs.readFileSync(new URL('../accountGuard.js', import.meta.url), 'utf8')), 'guard has no deleteMany of its own');

// WhatsApp: guard runs at top of open, ingestion gates on it.
assert.ok(connectionSrc.includes('whatsappAccountGuardGate = (async ()'), 'open handler starts guard gate');
assert.ok(connectionSrc.includes('if (whatsappAccountGuardGate) await whatsappAccountGuardGate.catch'), 'ingestion awaits guard');
assert.ok(connectionSrc.includes("await ensurePlatformAccount('whatsapp'"), 'whatsapp guard call');

// Gmail: OAuth callback awaits guard before sync; explicit disconnect clears record.
assert.ok(authRoutes.includes("await ensurePlatformAccount('gmail', guardEmail)"), 'oauth guard call');
assert.ok(authRoutes.indexOf("await ensurePlatformAccount('gmail', guardEmail)") < authRoutes.indexOf('fetchAndStoreGmailMessages(50, oauth2Client)'), 'guard before sync');
assert.ok(auth.includes("await clearPlatformAccount('gmail')"), 'gmail disconnect clears record');
assert.ok(connectionSrc.includes("await clearPlatformAccount('whatsapp')"), 'whatsapp disconnect clears record');

console.log('account-guard wiring check passed');