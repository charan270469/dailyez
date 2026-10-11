// Frontend API client: a typed fetch helper plus one function per backend endpoint
// (auth status, signals, messages, voice, WhatsApp), all relative to the Vite proxy.
const API_BASE_URL = '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
    const error = new Error((body && (body.error || body.message)) || text || 'Request failed') as Error & {
      status?: number;
      body?: any;
    };
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return response.json() as Promise<T>;
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

// ─── WhatsApp (Baileys QR auth) ───

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
  // One-click "Alert me" scoped signals (quick alert for a specific sender/chat)
  alertEnabled?: boolean;
  alertTarget?: string;
  alertPlatform?: 'gmail' | 'whatsapp';
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
  // Optional sender-alert targeting: exact-match scope for one sender/chat,
  // additive to (or instead of) the freeform context.
  alertEnabled?: boolean;
  alertTarget?: string;
  alertPlatform?: 'gmail' | 'whatsapp';
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

export async function archiveMessage(id: string) {
  return request<{ ok: boolean }>(`/api/messages/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
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
