// System/debug routes: Groq + Gemini budget visibility.
// Same registerXRoutes(app) pattern as authRoutes/voiceRoutes/whatsappRoutes.
import { getGroqBudgetSnapshot } from './agents/groqBudget.js';
import { getGeminiBudgetSnapshot } from './agents/geminiBudget.js';

export function registerSystemRoutes(app) {
  // GET /api/system/groq-budget — today's per-model Groq usage vs its
  // configured daily limit (see server/agents/groqBudget.js).
  app.get('/api/system/groq-budget', (_req, res) => {
    res.json(getGroqBudgetSnapshot());
  });

  // GET /api/system/gemini-budget — today's shared Gemini usage (total +
  // per-source split) vs the configured daily limit. Visibility only, never defers.
  app.get('/api/system/gemini-budget', (_req, res) => {
    res.json(getGeminiBudgetSnapshot());
  });
}
