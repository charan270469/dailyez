// Probes candidate Groq chat models with a minimal completion (dev diagnostic).
import dotenv from 'dotenv';
import Groq from 'groq-sdk';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const candidates = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'groq/compound',
  'groq/compound-mini',
];

// 1) Normal completion with enough tokens to actually emit text
for (const model of candidates) {
  try {
    const completion = await groq.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
      max_tokens: 64,
    });
    console.log(`✅ CONTENT ${model}: ${JSON.stringify((completion.choices?.[0]?.message?.content || '').trim())}`);
  } catch (error) {
    console.log(`❌ CONTENT ${model} (${error.status}) ${String(error.message).slice(0, 140)}`);
  }
}

// 3) Realistic routeIntent-style prompt in JSON mode for gpt-oss-120b
const prompt96 = `Reply in this exact JSON shape (no other text):
{ "action": "summarize_emails" | "create_signal" | "disconnect_platform" | "navigate" | "summarize_whatsapp" | "find_email" | "general_query", "params": { } }

USER COMMAND: "summarize my emails today"`;

for (const model of ['openai/gpt-oss-120b', 'openai/gpt-oss-20b']) {
  try {
    const completion = await groq.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt96 }],
      response_format: { type: 'json_object' },
      max_tokens: 120,
    });
    console.log(`✅ ROUTE-JSON ${model}: ${JSON.stringify((completion.choices?.[0]?.message?.content || '').trim())}`);
  } catch (error) {
    console.log(`❌ ROUTE-JSON ${model} (${error.status}) ${String(error.message).slice(0, 160)}`);
  }
}