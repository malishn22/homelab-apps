import { api } from './client';

// --- Response types ---

export interface ServerInstance {
  id: string;
  name: string;
  project_id: string;
  version_id: string;
  version_number?: string;
  loader?: string;
  source?: string;
  port: number;
  ram_mb: number;
  status: string;
  container_name?: string;
  minecraft_version?: string;
  file_url?: string;
  start_command?: string[];
}

export interface ListServersResponse {
  items: ServerInstance[];
}

export interface ServerStatsPayload {
  ramUsage?: number;
  ramTotal?: number;
  cpuLoad?: number;
  latency?: number | null;
  players?: number;
  maxPlayers?: number;
}

export interface ServerStatusResponse {
  status: string;
  stats?: ServerStatsPayload;
}

export interface LogsResponse {
  lines: string[];
}

export interface CommandResponse {
  ok: boolean;
  message?: string;
}

// --- Payload types ---

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

export type UpdateServerPayload = {
  name?: string;
  port?: number;
  max_players?: number;
  ram_mb?: number;
};

// --- API functions ---

export async function listServers(): Promise<ServerInstance[]> {
  const data = await api.get<ListServersResponse>('/servers');
  return data.items || [];
}

export async function createServer(payload: CreateServerPayload): Promise<ServerInstance> {
  return api.post<ServerInstance>('/servers', payload);
}

export async function updateServer(id: string, payload: UpdateServerPayload): Promise<ServerInstance> {
  return api.patch<ServerInstance>(`/servers/${id}`, payload);
}

export async function startServer(id: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/servers/${id}/start`);
}

export async function stopServer(id: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/servers/${id}/stop`);
}

export async function restartServer(id: string): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/servers/${id}/restart`);
}

export async function deleteServer(id: string): Promise<void> {
  await api.post<void>(`/servers/${id}/delete`);
}

export async function fetchLogs(id: string, lines: number): Promise<string[]> {
  const data = await api.get<LogsResponse>(`/servers/${id}/logs?lines=${lines}`);
  return data.lines || [];
}

export async function fetchStatus(id: string): Promise<ServerStatusResponse> {
  return api.get<ServerStatusResponse>(`/servers/${id}/status`);
}

export async function sendCommand(id: string, command: string): Promise<CommandResponse> {
  return api.post<CommandResponse>(`/servers/${id}/command`, { command });
}

export interface FileEntry {
  name: string;
  path: string;
}

export interface FilesResponse {
  files?: FileEntry[];
  dirs?: FileEntry[];
  content?: string;
}

export async function getFiles(instanceId: string, path: string = ''): Promise<FilesResponse> {
  const params = path ? `?path=${encodeURIComponent(path)}` : '';
  return api.get<FilesResponse>(`/servers/${instanceId}/files${params}`);
}

export async function writeFile(instanceId: string, path: string, content: string): Promise<void> {
  await api.put<void>(
    `/servers/${instanceId}/files?path=${encodeURIComponent(path)}`,
    content,
    { headers: { 'Content-Type': 'text/plain' } },
  );
}

export async function deleteFile(instanceId: string, path: string): Promise<void> {
  await api.delete<void>(`/servers/${instanceId}/files?path=${encodeURIComponent(path)}`);
}
