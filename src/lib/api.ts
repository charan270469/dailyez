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

export async function getWatchlist() {
  return request<Array<{ _id?: string; id?: string; type: string; platform: string; value: string; active?: boolean; createdAt?: string }>>('/api/watchlist');
}

export async function addWatchlistEntry(payload: { type: string; platform: string; value: string }) {
  return request<{ _id?: string; id?: string; type: string; platform: string; value: string; active?: boolean; createdAt?: string }>('/api/watchlist', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteWatchlistEntry(id: string) {
  return request<{ ok: boolean }>('/api/watchlist/' + id, {
    method: 'DELETE',
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