// Local Kokoro TTS singleton (kokoro-js 1.2.1, onnx-community/Kokoro-82M-v1.0-ONNX,
// dtype q8, device cpu — verified CPU-only, no GPU needed). The model is loaded
// lazily on first synthesis so server boot stays fast; generations are
// serialized through one shared instance so concurrent replies can't interleave.
let loadPromise = null;
let tail = Promise.resolve();

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const VOICE = process.env.KOKORO_VOICE || 'af_heart';

function loadModel() {
  if (!loadPromise) {
    loadPromise = (async () => {
      const { KokoroTTS } = await import('kokoro-js');
      return KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'cpu' });
    })();
    // A failed load must not poison the singleton — retry on the next call.
    loadPromise.catch(() => { loadPromise = null; });
  }
  return loadPromise;
}

export function synthesizeKokoro(text) {
  const run = tail.then(async () => {
    const tts = await loadModel();
    const audio = await tts.generate(text, { voice: VOICE });
    // RawAudio.toWav() already encodes a 16-bit PCM WAV — no hand-rolled header.
    return { wav: Buffer.from(audio.toWav()), samplingRate: audio.sampling_rate, voice: VOICE };
  });
  tail = run.catch(() => {});
  return run;
}

export function warmKokoroModel() {
  return loadModel();
}
