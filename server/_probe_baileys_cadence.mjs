// TEMPORARY probe: runs a REAL Baileys fresh-pairing socket in a throwaway auth
// folder (the user's real server/whatsapp/auth_session is NOT touched) and
// replicates the EXACT QR-handling logic from connection.js (incl. the current
// H/400 QR_OPTIONS and the temp [QR-TIMING] logging). It reports:
//   - how often Baileys really emits `qr` via connection.update (rotation cadence)
//   - how long QRCode.toDataURL() really takes per QR payload
//   - whether the staleness guard discards renders
// It then simulates the SECOND/confirm QR phase (which needs a phone to trigger
// for real) using the measured conversion timings, to show the served-image
// staleness window.
// Run: node server/_probe_baileys_cadence.mjs
import { makeWASocket, DisconnectReason, useMultiFileAuthState, Browsers } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const QR_OPTIONS = { width: 400, margin: 3, errorCorrectionLevel: 'H' }; // current ("regression") options
const PROBE_RUN_MS = 75_000;

// ── exact replica of connection.js state + handler (with temp logging) ──
let currentQrRaw = null;
let currentQrDataUrl = null;
let currentQrCount = 0;
let lastQrRaw = null;
let qrEmits = 0;
let newQrEmits = 0;
let discards = 0;
const emits = []; // {tMs, isNew, seq, rawLen}
let qrTimingEpochMs = null;
let lastServedRaw = null; // raw QR whose image is currently in currentQrDataUrl

function handleQr(connection, qr, servedLog) {
  if (!qr) return;
  qrEmits += 1;
  const qrArrivedAt = Date.now();
  if (qrTimingEpochMs === null) qrTimingEpochMs = qrArrivedAt;
  const qrIsNew = qr !== lastQrRaw;
  const qrSeq = qrIsNew ? currentQrCount + 1 : currentQrCount;
  const servingLen = currentQrDataUrl ? currentQrDataUrl.length : 0;
  const t = qrArrivedAt - qrTimingEpochMs;
  emits.push({ t, isNew: qrIsNew, seq: qrSeq, rawLen: qr.length, servingLen });
  servedLog(`[QR-TIMING] t+${t}ms QR EMIT (connection=${connection}, isNew=${qrIsNew}, seq=${qrSeq}, rawLen=${qr.length}, previouslyServedDataUrlLen=${servingLen})`);
  if (qrIsNew) {
    newQrEmits += 1;
    lastQrRaw = qr;
    currentQrCount += 1;
  }
  currentQrRaw = qr;
  const convertStartedAt = Date.now();
  QRCode.toDataURL(qr, QR_OPTIONS)
    .then((dataUrl) => {
      const convertEndedAt = Date.now();
      const convertMs = convertEndedAt - convertStartedAt;
      if (currentQrRaw === qr) {
        currentQrDataUrl = dataUrl;
        lastServedRaw = qr;
        servedLog(
          `[QR-TIMING] t+${convertEndedAt - qrTimingEpochMs}ms QR#${qrSeq} toDataURL finished in ${convertMs}ms → currentQrDataUrl SET (served, dataUrlLen=${dataUrl.length})`
        );
      } else {
        discards += 1;
        servedLog(
          `[QR-TIMING] t+${convertEndedAt - qrTimingEpochMs}ms QR#${qrSeq} toDataURL took ${convertMs}ms BUT IS STALE → render DISCARDED by staleness guard`
        );
      }
    })
    .catch((e) => servedLog(`[QR-TIMING] render error: ${e.message}`));
}

const authFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'signalstream-qr-probe-'));
const log = (s) => console.log(s);
log(`Probe auth folder (throwaway): ${authFolder}`);

const { state, saveCreds } = await useMultiFileAuthState(authFolder);
const socket = makeWASocket({
  auth: state,
  logger: pino({ level: 'silent' }),
  printQRInTerminal: false,
  browser: Browsers.macOS('Chrome'),
  syncFullHistory: true,
  fireInitQueries: true,
  connectTimeoutMs: 20000,
  keepAliveIntervalMs: 30000,
});
socket.ev.on('creds.update', saveCreds);
socket.ev.on('connection.update', (u) => {
  if (u.qr) handleQr(u.connection, u.qr, log);
  else if (u.lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) log('logged out');
});

// Wait for the first QR, then keep collecting until the cap expires.
const firstQr = new Promise((resolve) => {
  const t = setInterval(() => {
    if (currentQrRaw) {
      clearInterval(t);
      resolve();
    }
  }, 100);
});
const cap = new Promise((resolve) => setTimeout(resolve, PROBE_RUN_MS));
await Promise.race([firstQr, cap]);
log('First QR received. Collecting till cap...');
await cap;
log('Cap reached; ending real-Baileys phase.');

// ── summary of the real phase ──
console.log('\n══════════ REAL BAILEYS FRESH-PAIRING PHASE SUMMARY ══════════');
console.log(`QR emits received: ${qrEmits}  |  new (rotated) QRs: ${newQrEmits}  |  stale-render discards by guard: ${discards}`);
if (emits.length) {
  const lastT = emits[emits.length - 1].t;
  if (newQrEmits > 1) {
    const rotGaps = [];
    const newEmits = emits.filter((e) => e.isNew);
    for (let i = 1; i < newEmits.length; i++) rotGaps.push(newEmits[i].t - newEmits[i - 1].t);
    console.log(`First QR arrived t+${emits[0].t}ms. New-QR rotation gaps (ms): ${rotGaps.join(', ')}`);
  }
  console.log('Per-emit details:');
  for (const e of emits) {
    console.log(`  t+${e.t}ms isNew=${e.isNew} seq=${e.seq} rawLen=${e.rawLen} servingDataUrlLen=${e.servingLen}`);
  }
  console.log(`Total window ${lastT}ms → avg new-QR cadence ${newQrEmits > 1 ? (lastT / (newQrEmits - 1)).toFixed(0) : 'n/a'} ms`);
}

// Stop the real socket so its ongoing 60s QR rotations cannot leak into the
// synthetic confirm-phase simulation below.
socket.ev.removeAllListeners('connection.update');
socket.end();

// ── synthetic confirm/second-QR phase ──
// A phone is required to trigger the real confirm QR, so we model it: the
// confirm QR (#2) is issued right after the first QR was scanned and Continue
// was pressed, then WhatsApp/Baileys rotate it on a short timer. We replay the
// EXACT handler above using REAL toDataURL timings and record what the served
// image is vs. what currentQrRaw means WhatsApp currently expects, sampled at
// ~every-800ms "UI poll" points (the real UI polls every 2s).
console.log('\n══════════ SYNTHETIC CONFIRM/SECOND-QR PHASE (real toDataURL timings) ══════════');

const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));

function makePayload(len) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let s = '';
  while (s.length < len) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function waitForServed() {
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (currentQrDataUrl) {
        clearInterval(t);
        resolve();
      }
    }, 3);
    setTimeout(() => {
      clearInterval(t);
      resolve();
    }, 15000);
  });
}

async function replayConfirmFlow({ confirmLen, rotationMs }) {
  currentQrRaw = null;
  currentQrDataUrl = null;
  currentQrCount = 0;
  lastQrRaw = null;
  lastServedRaw = null;
  discards = 0;
  qrTimingEpochMs = Date.now();
  emits.length = 0;

  const qr1 = makePayload(180); // first QR
  const qr2 = makePayload(confirmLen); // confirm QR (distinct from qr1)
  const qr3 = makePayload(confirmLen + 1); // 1st rotation (distinct)
  const qr4 = makePayload(confirmLen + 2); // 2nd rotation (distinct)
  const identity = new Map([
    [qr1, '#1'],
    [qr2, '#2'],
    [qr3, '#3'],
    [qr4, '#4'],
  ]);
  const idOf = (r) => (r === null ? 'none' : identity.get(r) || '?');

  const quiet = () => {};
  const rows = [];
  const snap = (tag) => {
    const t = Date.now() - qrTimingEpochMs;
    const servedMatchesCurrent = currentQrRaw !== null && lastServedRaw === currentQrRaw;
    rows.push({ tag, t, raw: idOf(currentQrRaw), served: idOf(lastServedRaw), matches: servedMatchesCurrent });
  };

  // 1. first QR served — user scans it, phone asks to confirm
  handleQr('connecting', qr1, quiet);
  await waitForServed();
  snap('#1 served — user scans it');

  // 2. user presses Continue on the phone → confirm QR #2 is emitted
  await sleep2(400);
  handleQr('connecting', qr2, quiet);
  snap('#2 confirm QR EMITTED (conversion in flight)');

  // 3. confirm QR rotates every rotationMs; sample the served-vs-current state.
  let rotationsLeft = 2;
  let nextRot = Date.now() + rotationMs;
  while (rotationsLeft > 0) {
    await sleep2(Math.min(800, Math.max(0, nextRot - Date.now())));
    if (Date.now() >= nextRot) {
      const next = rotationsLeft === 2 ? qr3 : qr4;
      handleQr('connecting', next, quiet);
      snap(`rotation → ${idOf(next)} EMITTED`);
      rotationsLeft -= 1;
      nextRot = Date.now() + rotationMs;
    } else {
      snap('UI poll');
    }
  }
  await sleep2(600);
  snap('final');

  console.log(`\n  case: confirmLen=${confirmLen}, rotation every ${rotationMs}ms → guard discards=${discards}`);
  for (const r of rows) {
    const stale = r.matches ? 'CURRENT ✓' : 'STALE ✗ (displayed ≠ what WhatsApp expects right now)';
    console.log(
      `     t+${String(r.t).padStart(6)}ms  raw=${r.raw.padEnd(4)}  servedImage=${r.served.padEnd(4)}  ${r.tag.padEnd(30)} ${stale}`
    );
  }
}

const baseLen = emits[0]?.rawLen || 180;
console.log(`observed real first-QR payload length = ${baseLen}\n`);

// Confirm payloads: 1.0x, 2.5x, and 1200 chars (realistic worst cases for the
// "confirm linking" QR, whose byte payload can be larger than the first QR).
for (const confirmLen of [baseLen, Math.round(baseLen * 2.5), 1200]) {
  for (const rotationMs of [6000, 12000]) {
    await replayConfirmFlow({ confirmLen, rotationMs });
  }
}

setTimeout(() => process.exit(0), 800);