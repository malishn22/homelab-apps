const API_BASE = '/api';

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function getServerDefaults(): Promise<string> {
  const res = await fetch(`${API_BASE}/settings/server-defaults`, { method: 'GET' });
  const data = await handleJson<{ content: string }>(res);
  return data.content ?? '';
}

export async function saveServerDefaults(content: string): Promise<void> {
  const res = await fetch(`${API_BASE}/settings/server-defaults`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Save failed ${res.status}: ${text || res.statusText}`);
  }
}

export async function getWhitelistDefaults(): Promise<string> {
  const res = await fetch(`${API_BASE}/settings/whitelist-defaults`, { method: 'GET' });
  const data = await handleJson<{ content: string }>(res);
  return data.content ?? '[]';
}

export async function saveWhitelistDefaults(content: string): Promise<void> {
  const res = await fetch(`${API_BASE}/settings/whitelist-defaults`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: content,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Save failed ${res.status}: ${text || res.statusText}`);
  }
}

export async function getOpsDefaults(): Promise<string> {
  const res = await fetch(`${API_BASE}/settings/ops-defaults`, { method: 'GET' });
  const data = await handleJson<{ content: string }>(res);
  return data.content ?? '[]';
}

export async function saveOpsDefaults(content: string): Promise<void> {
  const res = await fetch(`${API_BASE}/settings/ops-defaults`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: content,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Save failed ${res.status}: ${text || res.statusText}`);
  }
}
