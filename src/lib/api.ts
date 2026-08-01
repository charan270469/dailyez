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
    throw new Error(text || 'Request failed');
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

export async function connectPlatformStub(name: string) {
  return request<{ ok: boolean; message: string }>(`/api/auth/${name.toLowerCase()}/connect`, {
    method: 'POST',
  });
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

export async function getInboxSignals(signalId?: string) {
  const query = signalId ? `?signalId=${signalId}` : '';
  return request<Array<any>>(`/api/inbox${query}`);
}

export async function getSignalsMessages(signalId?: string) {
  const query = signalId ? `?signalId=${signalId}` : '';
  return request<Array<any>>(`/api/signals/messages${query}`);
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