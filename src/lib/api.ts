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
  discord: boolean;
  user?: {
    name: string | null;
    email: string | null;
    avatar: string | null;
  };
  message?: string;
}

export async function getAuthStatus() {
  return request<AuthStatusResponse>('/api/auth/status');
}

// Manually trigger a Gmail fetch & sync so new matched mails can appear
// without waiting for the next periodic (15-min) fetch.
export async function triggerGmailFetch() {
  return request<{ ok: boolean }>('/api/gmail/fetch', {
    method: 'POST',
  });
}

export async function connectPlatformStub(name: string) {
  return request<{ ok: boolean; message: string }>(`/api/auth/${name.toLowerCase()}/connect`, {
    method: 'POST',
  });
}

export type PlatformName = 'gmail' | 'whatsapp' | 'discord';

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

export interface WhatsAppConnectionState {
  /** true when the session is live and authenticated */
  connected?: boolean;
  /** PNG data URL of a pending QR (user hasn't scanned yet) */
  qr?: string;
  /** how many distinct QRs this pairing session has issued (1 = first, 2 = after confirming on the phone) */
  qrGeneration?: number;
  /** 'not_started' | 'connecting' | 'reconnecting' | 'logged_out' */
  status?: string;
}

/** Returns the current QR data URL or connection state. */
export async function getWhatsAppQr() {
  return request<WhatsAppConnectionState>('/api/whatsapp/qr');
}

// ─── Signals API ───

export interface Signal {
  _id?: string;
  id?: string;
  context: string;
  keywords: string[];
  platform: 'gmail';
  createdAt?: string;
  matchCount?: number;
  lastMatched?: string | null;
}

export async function getSignals() {
  return request<Signal[]>('/api/signals');
}

export async function addSignal(payload: { context: string; keywords?: string[] }) {
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

export async function patchSignal(id: string, payload: { context?: string; keywords?: string[] }) {
  return request<Signal>('/api/signals/' + id, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function getInboxMessages() {
  return request<Array<any>>('/api/messages/inbox');
}

export async function getImportantMessages() {
  return request<Array<any>>('/api/messages/important');
}

export async function getArchiveMessages() {
  return request<Array<any>>('/api/messages/archive');
}

export async function archiveMessage(id: string) {
  return request<{ ok: boolean }>('/api/messages/' + id + '/archive', {
    method: 'PATCH',
  });
}

export async function restoreMessage(id: string) {
  return request<{ ok: boolean }>('/api/messages/' + id + '/restore', {
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