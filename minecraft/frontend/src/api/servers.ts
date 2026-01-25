const API_BASE = '/api';
const build = (path: string) => `${API_BASE}${path}`;

export type CreateServerPayload = {
  name: string;
  project_id: string;
  version_id: string;
  version_number: string;
  loader: string;
  source?: string;
  port: number;
  ram_mb: number;
};

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function listServers(): Promise<any[]> {
  const res = await fetch(build('/servers'), { method: 'GET' });
  const data = await handleJson<{ items: any[] }>(res);
  return data.items || [];
}

export async function createServer(payload: CreateServerPayload): Promise<any> {
  const res = await fetch(build('/servers'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleJson<any>(res);
}

export async function startServer(id: string): Promise<any> {
  const res = await fetch(build(`/servers/${id}/start`), { method: 'POST' });
  return handleJson<any>(res);
}

export async function stopServer(id: string): Promise<any> {
  const res = await fetch(build(`/servers/${id}/stop`), { method: 'POST' });
  return handleJson<any>(res);
}

export async function deleteServer(id: string): Promise<void> {
  const res = await fetch(build(`/servers/${id}/delete`), {
    method: 'POST',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete failed ${res.status}: ${text || res.statusText}`);
  }
}


export async function fetchLogs(id: string, lines: number): Promise<string[]> {
  const res = await fetch(build(`/servers/${id}/logs?lines=${lines}`), {
    method: 'GET',
  });
  const data = await handleJson<{ lines: string[] }>(res);
  return data.lines || [];
}

export async function fetchStatus(id: string): Promise<any> {
  // backend exposes both /{id} and /{id}/status; use the explicit one
  const res = await fetch(build(`/servers/${id}/status`), { method: 'GET' });
  return handleJson<any>(res);
}

export async function sendCommand(id: string, command: string): Promise<any> {
  const res = await fetch(build(`/servers/${id}/command`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  });
  return handleJson<any>(res);
}
