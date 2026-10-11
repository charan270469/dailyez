// Server environment: the ONLY dotenv.config() in production server code.
// Every server module reads env through the frozen `config` object below —
// no direct process.env reads elsewhere. Getters stay live (read at access
// time) so tests that mutate process.env keep passing.
import dotenv from 'dotenv';

dotenv.config();

function positiveInt(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export const config = Object.freeze({
  // ── Google OAuth (Gmail) ──
  get googleClientId() { return process.env.GOOGLE_CLIENT_ID; },
  get googleClientSecret() { return process.env.GOOGLE_CLIENT_SECRET; },
  get googleRedirectUri() { return process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/auth/google/callback'; },

  // ── App URLs / ports ──
  get port() { return Number(process.env.PORT) || 3001; },
  get frontendUrl() { return process.env.FRONTEND_URL; },
  get frontendUrlOrDefault() { return process.env.FRONTEND_URL || 'http://localhost:3000'; },

  // ── MongoDB ──
  get mongodbUri() { return process.env.MONGODB_URI; },

  // ── Groq ──
  get groqApiKey() { return process.env.GROQ_API_KEY; },
  get groqMatchModel() { return process.env.GROQ_MATCH_MODEL || 'openai/gpt-oss-20b'; },
  get groqVerifyModel() { return process.env.GROQ_VERIFY_MODEL || 'openai/gpt-oss-120b'; },
  get groqExtractModel() { return process.env.GROQ_EXTRACT_MODEL || 'openai/gpt-oss-20b'; },
  get groqRouteModel() { return process.env.GROQ_ROUTE_MODEL || 'openai/gpt-oss-20b'; },
  get groqSummarizeModel() { return process.env.GROQ_SUMMARIZE_MODEL || 'openai/gpt-oss-120b'; },
  get groqAnswerModel() { return process.env.GROQ_ANSWER_MODEL || 'openai/gpt-oss-120b'; },
  get groqMatchMaxTokens() { return Math.max(64, Number(process.env.GROQ_MATCH_MAX_TOKENS) || 800); },
  get groqVerifyMaxTokens() { return Math.max(64, Number(process.env.GROQ_VERIFY_MAX_TOKENS) || 800); },
  get groqExtractMaxTokens() { return Math.max(64, Number(process.env.GROQ_EXTRACT_MAX_TOKENS) || 800); },
  get groqRouteMaxTokens() { return Math.max(64, Number(process.env.GROQ_ROUTE_MAX_TOKENS) || 800); },
  get groqSummarizeMaxTokens() { return Math.max(64, Number(process.env.GROQ_SUMMARIZE_MAX_TOKENS) || 1024); },
  get groqAnswerMaxTokens() { return Math.max(64, Number(process.env.GROQ_ANSWER_MAX_TOKENS) || 1024); },
  get groqMatchContentCharLimit() { return Math.max(1, Number(process.env.GROQ_MATCH_CONTENT_CHAR_LIMIT) || 4000); },
  get groqVerifyContentCharLimit() { return Math.max(1, Number(process.env.GROQ_VERIFY_CONTENT_CHAR_LIMIT) || 4000); },
  get groqExtractContentCharLimit() { return Math.max(1, Number(process.env.GROQ_EXTRACT_CONTENT_CHAR_LIMIT) || 4000); },
  get groqSummarizeMax() { return Number(process.env.GROQ_SUMMARIZE_MAX) || 100; },
  get groqMatchRpmLimit() { return Math.max(1, Number(process.env.GROQ_MATCH_RPM_LIMIT) || 4); },
  // Generic daily cap (null = use caller's built-in default); per-model
  // GROQ_DAILY_LIMIT_* overrides resolve through the helpers below.
  get groqDailyLimit() { return positiveInt(process.env.GROQ_DAILY_LIMIT); },
  groqDailyLimitVar(name) { return process.env[name]; },
  groqDailyLimitVarNames() {
    return Object.keys(process.env).filter((k) => k.startsWith('GROQ_DAILY_LIMIT_'));
  },

  // ── Gemini (PDF parsing only; optional) ──
  get geminiApiKey() { return process.env.GEMINI_API_KEY; },
  get geminiDailyLimit() { return positiveInt(process.env.GEMINI_DAILY_LIMIT) ?? 1500; },

  // ── WhatsApp ──
  get whatsappLogLevel() { return process.env.WHATSAPP_LOG_LEVEL || 'silent'; },
  get whatsappHistoryWindowDays() {
    const raw = Number(process.env.WHATSAPP_HISTORY_WINDOW_DAYS);
    return Number.isFinite(raw) && raw >= 0 ? raw : 3;
  },

  // ── Voice TTS ──
  get kokoroVoice() { return process.env.KOKORO_VOICE || 'af_heart'; },
});

// Startup validation: required vars fail fast with one message naming the
// missing names (never values). Feature keys like GEMINI_API_KEY stay
// optional — parsePdfAttachment.js warns at use time when unset.
const REQUIRED_VARS = ['MONGODB_URI', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GROQ_API_KEY'];

export function validateRequiredConfig() {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`);
  }
}
