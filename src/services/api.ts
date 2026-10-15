// Frontend API client: a typed fetch helper plus one function per backend endpoint
// (auth status, signals, messages, voice, WhatsApp), all relative to the Vite proxy.
const API_BASE_URL = '';

export class ApiError extends Error {
  status?: number;
  body?: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  if (error instanceof ApiError && error.message) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; error?: unknown; detail?: unknown };
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message.trim();
    }
    if (typeof candidate.error === 'string' && candidate.error.trim()) {
      return candidate.error.trim();
    }
    if (typeof candidate.detail === 'string' && candidate.detail.trim()) {
      return candidate.detail.trim();
    }
  }

  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      ...init,
    });

    if (!response.ok) {
      const text = await response.text();
      let body: any = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* not JSON — keep raw text */
      }

      const message =
        (body && (body.error || body.message || body.detail || body.errors?.[0]?.message)) ||
        text ||
        'Request failed';
      throw new ApiError(message, response.status, body);
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      getErrorMessage(error, 'Request failed'),
      0,
      error,
    );
  }
}

export interface AuthStatusResponse {
  gmail: boolean;
  whatsapp: boolean;
  loggedOut?: boolean;
  user?: {
    name: string | null;
    email: string | null;
    avatar: string | null;
    signedOut?: boolean;
  };
  message?: string;
}

export async function getAuthStatus() {
  return request<AuthStatusResponse>('/api/auth/status');
}

/** Updates the user's profile (name/avatar). Email is intentionally not changeable. */
export async function updateProfile(payload: { name?: string; avatar?: string | null }) {
  return request<{ ok: boolean; user?: AuthStatusResponse['user'] }>('/api/auth/profile', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/** Signs the user out: revokes Gmail + WhatsApp and returns to the login screen. */
export async function logoutUser() {
  return request<{ ok: boolean; message?: string }>('/api/auth/logout', {
    method: 'POST',
  });
}

// Manually trigger a Gmail fetch & sync so new matched mails can appear
// without waiting for the next periodic (2-min) fetch.
export async function triggerGmailFetch() {
  return request<{ ok: boolean }>('/api/gmail/fetch', {
    method: 'POST',
  });
}

export type PlatformName = 'gmail' | 'whatsapp';

/** Disconnects a platform (Gmail revokes the OAuth token, WhatsApp logs out the Baileys socket). */
export async function disconnectPlatform(name: PlatformName) {
  return request<{ ok: boolean; message?: string }>(`/api/auth/${name}/disconnect`, {
    method: 'POST',
  });
}

// ─── WhatsApp (Baileys pairing-code auth) ───

/** Starts the Baileys connection (no-op if already running). */
export async function connectWhatsApp() {
  return request<{ ok: boolean; status?: string; alreadyRunning?: boolean }>('/api/whatsapp/connect', {
    method: 'POST',
  });
}

/** Wipes all stored WhatsApp messages and re-ingests from the live socket store. */
export async function resyncWhatsApp() {
  return request<{ ok: boolean; cleared?: number; purged?: number; resyncing?: boolean }>(
    '/api/whatsapp/resync',
    { method: 'POST' },
  );
}

/** Polled after a resync POST: true while the full-history sync is still running. */
export async function getWhatsAppResyncState() {
  return request<{ resyncing: boolean; completedAt?: number | null }>('/api/whatsapp/resync');
}

export interface WhatsAppConnectionState {
  /** true when the session is live and authenticated */
  connected?: boolean;
  connectionAttemptId?: number;
  status?: string;
}

/** Returns the current WhatsApp pairing connection state. */
export async function getWhatsAppStatus(signal?: AbortSignal) {
  return request<WhatsAppConnectionState>('/api/whatsapp/status', { signal });
}

export interface WhatsAppSummaryResult {
  summary: string;
  messageCount: number;
}

/**
 * Summarizes one stored WhatsApp conversation (the inbox card's chatId) using the
 * server's existing WhatsApp summarizer. `range` = how many of the most recent
 * messages to include (clamped to 1-50 on the server, default 50).
 */
export async function summarizeWhatsAppChat(chatId: string, range = 50) {
  return request<WhatsAppSummaryResult>(
    `/api/whatsapp/groups/${encodeURIComponent(chatId)}/summarize?range=${range}`,
  );
}

/**
 * Summarizes one stored Gmail message by id (the detail modal's Gmail
 * "Generate summary" button). Same Groq paragraph style as the WhatsApp button.
 */
export async function summarizeEmailMessage(id: string) {
  return request<WhatsAppSummaryResult>(
    `/api/messages/${encodeURIComponent(id)}/summarize`,
  );
}

/**
 * Searches one stored WhatsApp conversation (the inbox card's chatId) for
 * messages whose content contains `query` (case-insensitive, newest first).
 * Plain MongoDB query on the backend — no LLM call. Returns raw message
 * documents in the same shape as the other message endpoints.
 */
export async function searchWhatsAppChat(chatId: string, query: string) {
  return request<Array<any>>(
    `/api/whatsapp/groups/${encodeURIComponent(chatId)}/search?q=${encodeURIComponent(query)}`,
  );
}

// ─── Signals API ───

export interface Signal {
  _id?: string;
  id?: string;
  context: string;
  excludedCriteria?: string;
  keywords: string[];
  platform: 'gmail';
  createdAt?: string;
  matchCount?: number;
  lastMatched?: string | null;
  // Per-signal push: browser notification when this signal finds a match
  notifyOnMatch?: boolean;
  // Allow PDF parsing for this signal (no parsing logic yet — schema + UI only).
  pdfParsingEnabled?: boolean;
}

export async function getSignals() {
  return request<Signal[]>('/api/signals');
}

export async function addSignal(payload: {
  context: string;
  excludedCriteria?: string;
  keywords?: string[];
  // Per-signal push: persisted on the signal; the Matched feed fires a browser
  // notification when a match belongs to a notify-enabled signal.
  notifyOnMatch?: boolean;
  // Allow PDF parsing for this signal (stored only, no parsing logic yet).
  pdfParsingEnabled?: boolean;
}) {
  return request<Signal>('/api/signals', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteSignal(id: string) {
  return request<{ ok: boolean }>('/api/signals/' + id, {
    method: 'DELETE',
  });
}

export async function patchSignal(
  id: string,
  payload: {
    context?: string;
    excludedCriteria?: string;
    keywords?: string[];
    notifyOnMatch?: boolean;
    pdfParsingEnabled?: boolean;
  },
) {
  return request<Signal>('/api/signals/' + id, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * One-click "Alert me": creates a sender/chat-scoped alert signal from a message
 * card without opening the Add Signal form. Backend dedups on alertTarget +
 * alertPlatform, so calling it again for the same sender is a no-op (responds
 * with alreadyExists so the caller can show the "already alerting" state).
 */
export async function quickAlertSignal(payload: {
  target: string;
  platform: 'gmail' | 'whatsapp';
  senderName?: string;
}) {
  return request<{
    ok: boolean;
    created?: boolean;
    alreadyExists?: boolean;
    signal?: Signal;
  }>('/api/signals/quick-alert', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Messages API ───

export interface MessageDetail {
  id: string;
  sender: string;
  source: string;
  platform: 'gmail' | 'whatsapp';
  date?: string;
  type?: string;
  body?: string;
  subject?: string;
  snippet?: string;
  matched?: boolean;
  summary?: string;
}

export async function getMessages() {
  return request<MessageDetail[]>('/api/messages');
}

export async function getMessageDetail(id: string) {
  return request<MessageDetail>(`/api/messages/${encodeURIComponent(id)}`);
}

export async function getMatchedMessages() {
  return request<MessageDetail[]>('/api/messages/matched');
}

export async function markMessageRead(id: string) {
  return request<{ ok: boolean }>(`/api/messages/${encodeURIComponent(id)}/read`, {
    method: 'POST',
  });
}

export async function getInboxMessages() {
  return request<Array<any>>('/api/messages/inbox');
}

export interface InboxPage {
  messages: Array<any>;
  nextCursor: string | null;
}

/** Paged All Inbox fetch: first 20 fast, then older batches via cursor. */
export async function getInboxPage(
  limit = 20,
  cursor?: string | null,
  filters?: { source?: string; keywordMatched?: boolean },
) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  if (filters?.source) params.set('source', filters.source);
  if (filters?.keywordMatched) params.set('keywordMatched', 'true');
  return request<InboxPage>('/api/messages/inbox?' + params.toString());
}

export async function getImportantMessages() {
  return request<Array<any>>('/api/messages/important');
}

export async function getArchiveMessages() {
  return request<Array<any>>('/api/messages/archive');
}

export async function archiveMessage(id: string) {
  return request<{ ok: boolean }>(`/api/messages/${encodeURIComponent(id)}/archive`, {
    method: 'PATCH',
  });
}

export async function restoreMessage(id: string) {
  return request<{ ok: boolean }>(`/api/messages/${encodeURIComponent(id)}/restore`, {
    method: 'PATCH',
  });
}

// ─── Voice Agent API ───

/** Sends base64-encoded audio to Whisper (Groq) and returns the transcript. */
export async function transcribeVoiceAudio(audioBase64: string, mimeType?: string) {
  return request<{ text: string }>('/api/voice/transcribe', {
    method: 'POST',
    body: JSON.stringify({ audioBase64, ...(mimeType ? { mimeType } : {}) }),
  });
}

export interface VoiceCommandResult {
  response: string;
  navigateTo?: string;
}

/** Routes + executes a (text) voice command and returns the spoken/displayed response. */
export async function sendVoiceCommand(text: string) {
  return request<VoiceCommandResult>('/api/voice/command', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

/**
 * Synthesizes assistant speech via local Kokoro TTS.
 * Throws on any failure so the caller can fall back to browser speechSynthesis.
 */
export async function synthesizeVoiceAudio(text: string) {
  return request<{
    ok: boolean;
    audioBase64: string;
    mimeType: string;
    samplingRate: number;
    voice: string;
  }>('/api/voice/synthesize', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

/** Requests Baileys' native 8-character phone pairing code. */
export async function requestWhatsAppPairingCode(phoneNumber: string) {
  return request<{ ok: boolean; code: string }>('/api/whatsapp/pairing-code', {
    method: 'POST',
    body: JSON.stringify({ phoneNumber }),
  });
}

// ─── Voice API ───

export async function sendVoiceMessage(payload: {
  message: string;
  conversationId?: string;
}) {
  return request<{ ok: boolean; reply?: string }>('/api/voice/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
