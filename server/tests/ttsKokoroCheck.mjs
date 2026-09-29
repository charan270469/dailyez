// Minimal runnable check: Kokoro synthesize logic + route shapes.
// Usage: node server/tests/ttsKokoroCheck.mjs  (no backend needed; ~1-2 min first run for model download)
import express from 'express';
import { synthesizeKokoro } from '../ttsKokoro.js';
import { registerVoiceRoutes } from '../voiceRoutes.js';

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

// 1. Direct synthesis returns a WAV buffer (no HTTP layer involved).
const direct = await synthesizeKokoro('Hello from DailyEz.');
assert(Buffer.isBuffer(direct.wav), 'wav is a Buffer');
assert(direct.wav.subarray(0, 4).toString() === 'RIFF', 'RIFF header');
assert(direct.wav.length > 1000, 'non-trivial audio bytes, got ' + direct.wav.length);
assert(direct.voice === (process.env.KOKORO_VOICE || 'af_heart'), 'default voice');
console.log('PASS synthesize: voice=' + direct.voice + ' bytes=' + direct.wav.length + ' rate=' + direct.samplingRate);

// 2. Route validation shape: missing text -> 400 (fast, no model load).
const app = express();
app.use(express.json());
registerVoiceRoutes(app);
const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const port = server.address().port;
const bad = await fetch('http://localhost:' + port + '/api/voice/synthesize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
assert(bad.status === 400, 'empty text -> 400, got ' + bad.status);
console.log('PASS route validation: empty text -> 400');
server.close();
process.exit(0);
