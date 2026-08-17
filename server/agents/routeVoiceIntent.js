// Voice intent router: sends a transcribed command to Groq to pick exactly one action
// (summarize/create_signal/disconnect/navigate/general_query) plus the params it needs.
import Groq from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config(); // load .env early — same pattern as auth.js / db.js

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const ROUTE_MODEL = process.env.GROQ_ROUTE_MODEL || 'llama-3.3-70b-versatile';

const VALID_ACTIONS = ['summarize_emails', 'create_signal', 'disconnect_platform', 'navigate', 'general_query'];
const VALID_TIME_RANGES = ['today', 'yesterday', 'this_week'];
const VALID_PLATFORMS = ['gmail', 'whatsapp', 'discord'];
const VALID_TABS = ['important', 'inbox', 'watchlist', 'analytics', 'archive', 'settings'];

/**
 * Validates/normalizes whatever JSON the LLM returned so we NEVER forward an
 * unknown action or malformed params downstream. Anything invalid falls back to
 * a safe "general_query" / sensible default.
 */
function sanitize(result) {
  const action = VALID_ACTIONS.includes(result?.action) ? result.action : 'general_query';
  const raw = result?.params || {};
  const params = {};

  if (action === 'summarize_emails') {
    params.timeRange = VALID_TIME_RANGES.includes(raw.timeRange) ? raw.timeRange : 'today';
  } else if (action === 'create_signal') {
    params.context = typeof raw.context === 'string' ? raw.context.trim() : '';
  } else if (action === 'disconnect_platform') {
    params.platform = VALID_PLATFORMS.includes(String(raw.platform || '').toLowerCase()) ? String(raw.platform).toLowerCase() : 'gmail';
  } else if (action === 'navigate') {
    params.tab = VALID_TABS.includes(raw.tab) ? raw.tab : 'important';
  }

  return { action, params };
}

/**
 * Classifies a transcribed voice command into exactly ONE action, extracting
 * the parameters the app needs. Returns strict JSON:
 *   { action: 'summarize_emails' | 'create_signal' | 'disconnect_platform' | 'navigate' | 'general_query',
 *     params: {...} }
 */
export async function routeIntent(transcribedText) {
  const text = String(transcribedText || '').trim();
  if (!text) {
    return { action: 'general_query', params: {} };
  }

  const prompt = `You are the intent router for a voice assistant that controls DailyEz — a personal email intelligence dashboard. Given a transcribed user command, pick EXACTLY ONE action and extract the parameters the app needs. Respond with STRICT JSON only — no prose, no markdown, no code fences.

Choose exactly one of these actions:

1. "summarize_emails" — the user wants a recap of the Gmail messages they received. Words like "summary", "summarize", "overview", "recap", "digest", "what came in", "what did I miss", "update me on my emails" all count. Params: { "timeRange": "today" | "yesterday" | "this_week" }. Default to "today" when the user does not name a period.

2. "create_signal" — the user wants to start watching/tracking a topic or a sender so future matching emails get surfaced. Words like "signal", "watch", "track", "alert me about", "notify me when", "let me know when", "add" (followed by what to track) all count. Params: { "context": "<the thing to track as a concise natural description, e.g. \\"emails from Amazon SDE interview\\" or \\"crypto news\\" or \\"URGENT project updates\\">" }. The context must capture WHAT to track, not the command verb. Example: "add a signal for emails from recruiters at Google" -> context = "emails from recruiters at Google". Strip lead-in words like "add a signal for", "I want to track", "watch for". Never leave context empty.

3. "disconnect_platform" — the user wants to revoke a connected platform. Words like "disconnect", "unlink", "revoke", "remove access", "log out of" count. Params: { "platform": "gmail" | "whatsapp" | "discord" }. Default to "gmail" unless a platform is explicitly named.

4. "navigate" — the user wants to switch screens in the app. Words like "go to", "open", "show me", "take me to", "jump to" + a screen count. Params: { "tab": "important" | "inbox" | "watchlist" | "analytics" | "archive" | "settings" }. Mapping: "important"/"matched"/"signals" -> "important"; "inbox"/"all inbox"/"emails" -> "inbox"; "watchlist" -> "watchlist"; "analytics"/"charts"/"stats" -> "analytics"; "archive"/"archived" -> "archive"; "settings" -> "settings".

5. "general_query" — anything else: questions, small talk, greetings, or commands that do not clearly match actions 1–4. Params: {} (empty).

Absolute rules:
- Return exactly ONE "action" value from the list above. Never invent a new action name.
- Always include the "params" object.
- If the intent is ambiguous, pick the action most strongly supported by the words; otherwise fall back to "general_query".

USER COMMAND: "${text}"

Reply in this exact JSON shape (no other text):
{ "action": "summarize_emails" | "create_signal" | "disconnect_platform" | "navigate" | "general_query", "params": { } }`;

  const completion = await groq.chat.completions.create({
    model: ROUTE_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) {
    return { action: 'general_query', params: {} };
  }

  try {
    return sanitize(JSON.parse(raw));
  } catch (parseError) {
    console.error('Failed to parse intent routing response as JSON:', raw);
    return { action: 'general_query', params: {} };
  }
}