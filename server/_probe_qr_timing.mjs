// TEMPORARY benchmark: how long does QRCode.toDataURL() take with the current
// quality-boosted options vs. the pre-regression settings, across payload sizes
// representative of Baileys QR strings (fresh-pairing QR vs. confirm/second QR).
// Run: node server/_probe_qr_timing.mjs
import QRCode from 'qrcode';
import crypto from 'node:crypto';

const OPTION_SETS = {
  'OLD    L/300 (pre-change)': { width: 300, margin: 1, errorCorrectionLevel: 'L' },
  'CURRENT H/400 (regression)': { width: 400, margin: 3, errorCorrectionLevel: 'H' },
  'M/400  (medium EC)      ': { width: 400, margin: 3, errorCorrectionLevel: 'M' },
  'H/350  (smaller width)  ': { width: 350, margin: 3, errorCorrectionLevel: 'H' },
  'M/350  (balanced)       ': { width: 350, margin: 2, errorCorrectionLevel: 'M' },
};

// Baileys QR payloads are base64-ish strings (~100-300 chars for the fresh
// pairing QR; the confirm/second QR is the same shape but usually longer).
// NOTE: errorCorrectionLevel 'H' caps byte-mode capacity at ~1273 chars
// (QR version 40) - longer payloads THROW "too big to be stored".
const PAYLOAD_LENGTHS = [100, 150, 250, 400, 600, 900, 1100, 1250];

function makePayload(n) {
  // Deterministic-ish pseudo base64 byte-mode payload (worst case for byte mode).
  return crypto.randomBytes(Math.ceil(n * 0.75)).toString('base64').slice(0, n);
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const RUNS = 5;
const results = [];

for (const length of PAYLOAD_LENGTHS) {
  const payload = makePayload(length);
  for (const [label, opts] of Object.entries(OPTION_SETS)) {
    let modulesPerSide = 0;
    let toBig = null;
    try {
      const info = QRCode.create(payload, { errorCorrectionLevel: opts.errorCorrectionLevel });
      modulesPerSide = info.modules.size;
    } catch (e) {
      toBig = e.message;
    }

    if (toBig) {
      results.push({ length, label, modulesPerSide: 0, medianMs: NaN, minMs: NaN, maxMs: NaN, dataUrlLen: 0, tooBig: true });
      continue;
    }

    const times = [];
    let lastLen = 0;
    for (let i = 0; i < RUNS; i++) {
      const t0 = process.hrtime.bigint();
      const url = await QRCode.toDataURL(payload, opts);
      const t1 = process.hrtime.bigint();
      times.push(Number(t1 - t0) / 1e6);
      lastLen = url.length;
    }
    const min = Math.min(...times);
    const max = Math.max(...times);
    results.push({
      length,
      label,
      modulesPerSide,
      medianMs: +median(times).toFixed(1),
      minMs: +min.toFixed(1),
      maxMs: +max.toFixed(1),
      dataUrlLen: lastLen,
      tooBig: false,
    });
  }
}

console.log('QRCode.toDataURL() benchmark — payload is random base64 byte-mode data');
console.log('Payload length × options | median / min / max ms over ' + RUNS + ' runs, output data-URL chars, QR modules/side');
console.log('"TOO BIG" = qrcode library refuses to encode at that error-correction level\n');
console.log('len  '.padEnd(6), 'option set'.padEnd(31), 'median ms', 'min', 'max', 'dataUrlLen', 'qrSize');
for (const r of results) {
  if (r.tooBig) {
    console.log(
      String(r.length).padEnd(6),
      r.label.padEnd(31),
      String('TOO BIG').padStart(9),
      String('-').padStart(7),
      String('-').padStart(7),
      String('n/a').padStart(12),
      String('-').padStart(5),
    );
    continue;
  }
  console.log(
    String(r.length).padEnd(6),
    r.label.padEnd(31),
    String(r.medianMs).padStart(9),
    String(r.minMs).padStart(7),
    String(r.maxMs).padStart(7),
    String(r.dataUrlLen).padStart(12),
    String(r.modulesPerSide).padStart(5),
  );
}

// Summary comparisons the fix decision hinges on:
console.log('\nKey deltas (median, ms):');
for (const len of [150, 600, 900]) {
  const current = results.find((r) => r.length === len && r.label.includes('CURRENT'));
  const old = results.find((r) => r.length === len && r.label.includes('OLD'));
  const m400 = results.find((r) => r.length === len && r.label.includes('M/400'));
  const h350 = results.find((r) => r.length === len && r.label.includes('H/350'));
  const m350 = results.find((r) => r.length === len && r.label.includes('M/350'));
  const f = (x) => (x && x.medianMs ? x.medianMs : 'TOO BIG / n/a');
  const pct = old && current && old.medianMs && current.medianMs ? ` (${((current.medianMs / old.medianMs - 1) * 100).toFixed(0)}% vs old)` : '';
  console.log(
    `len=${len}: OLD(L/300)=${f(old)}ms -> CURRENT(H/400)=${f(current)}ms${pct} | M/400=${f(m400)}ms H/350=${f(h350)}ms M/350=${f(m350)}ms`
  );
}