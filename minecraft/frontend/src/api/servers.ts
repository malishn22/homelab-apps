const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

const buildApiUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
};

export type ServerInstance = {
  id: string;
  name: string;
  project_id: string;
  version_id: string;
  version_number?: string;
  loader?: string;
  port: number;
  ram_gb: number;
  status: string;
  container_name?: string;
};

export type ServerStatus = {
  status: string;
  stats?: {
    ramUsage: number;
    ramTotal: number;
    cpuLoad: number;
    tps: number;
  };
};

export async function listServers(): Promise<ServerInstance[]> {
  const res = await fetch(buildApiUrl('/api/servers'));
  if (!res.ok) throw new Error(`Failed to list servers (${res.status})`);
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createServer(payload: {
  name: string;
  project_id: string;
  version_id: string;
  version_number?: string;
  loader?: string;
  port: number;
  ram_gb: number;
}): Promise<ServerInstance> {
  const res = await fetch(buildApiUrl('/api/servers'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create server (${res.status}): ${body}`);
  }
  return await res.json();
}

export async function startServer(serverId: string): Promise<{ status: string }> {
  const res = await fetch(buildApiUrl(`/api/servers/${serverId}/start`), { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to start server (${res.status})`);
  return await res.json();
}

export async function stopServer(serverId: string): Promise<{ status: string }> {
  const res = await fetch(buildApiUrl(`/api/servers/${serverId}/stop`), { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to stop server (${res.status})`);
  return await res.json();
}

export async function fetchStatus(serverId: string): Promise<ServerStatus> {
  const res = await fetch(buildApiUrl(`/api/servers/${serverId}/status`));
  if (!res.ok) throw new Error(`Failed to fetch status (${res.status})`);
  return await res.json();
}

export async function fetchLogs(serverId: string, tail = 200): Promise<string[]> {
  const res = await fetch(buildApiUrl(`/api/servers/${serverId}/logs?tail=${tail}`));
  if (!res.ok) throw new Error(`Failed to fetch logs (${res.status})`);
  const data = await res.json();
  return Array.isArray(data?.lines) ? data.lines : [];
}

export async function sendCommand(serverId: string, command: string): Promise<void> {
  const res = await fetch(buildApiUrl(`/api/servers/${serverId}/command`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to send command (${res.status}): ${body}`);
  }
}
