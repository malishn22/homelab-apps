import { api } from './client';

export async function getServerDefaults(): Promise<string> {
  const data = await api.get<{ content: string }>('/settings/server-defaults');
  return data.content ?? '';
}

export async function saveServerDefaults(content: string): Promise<void> {
  await api.put<void>('/settings/server-defaults', content, {
    headers: { 'Content-Type': 'text/plain' },
  });
}

export async function getWhitelistDefaults(): Promise<string> {
  const data = await api.get<{ content: string }>('/settings/whitelist-defaults');
  return data.content ?? '[]';
}

export async function saveWhitelistDefaults(content: string): Promise<void> {
  await api.put<void>('/settings/whitelist-defaults', content, {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function getOpsDefaults(): Promise<string> {
  const data = await api.get<{ content: string }>('/settings/ops-defaults');
  return data.content ?? '[]';
}

export async function saveOpsDefaults(content: string): Promise<void> {
  await api.put<void>('/settings/ops-defaults', content, {
    headers: { 'Content-Type': 'application/json' },
  });
}
