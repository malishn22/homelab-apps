import { api } from './client';

export type ModrinthModpack = {
  project_id: string;
  slug: string;
  title: string;
  icon_url: string | null;
  downloads: number;
  followers?: number;
  updated?: string;
  date_modified?: string;
  date_created?: string;
  description: string;
  author?: string;
  categories?: string[];
  game_versions?: string[];
  versions?: string[];
  loaders?: string[];
  refreshed_at?: string;
  server_side?: string;
  source?: 'modrinth' | 'curseforge' | 'ftb';
};

export type ServerVersion = {
  id?: string;
  version_number?: string;
  game_versions?: string[];
  loaders?: string[];
  date_published?: string;
  files?: { filename?: string; url?: string }[];
  server_supported?: boolean;
};

export type ServerFilesResponse = {
  available: boolean;
  versions: ServerVersion[];
};

export type SearchModpacksResponse = {
  hits: ModrinthModpack[];
  limit?: number;
  offset?: number;
  total_hits?: number;
};

export async function searchModpacks(params?: {
  query?: string;
  page?: number;
  limit?: number;
  sort?: string;
  sources?: string[];
  force?: boolean;
}): Promise<SearchModpacksResponse> {
  const { query = '', page = 0, limit = 20, sort = 'relevance', sources = [], force = false } = params || {};
  const searchParams = new URLSearchParams({
    query,
    page: String(page),
    limit: String(limit),
    sort,
  });
  if (sources.length > 0) {
    searchParams.set('sources', sources.join(','));
  }
  if (force) {
    searchParams.set('force', 'true');
  }

  const data = await api.get<SearchModpacksResponse>(`/modpacks/search?${searchParams.toString()}`);
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  return {
    hits,
    limit: data?.limit,
    offset: data?.offset,
    total_hits: data?.total_hits,
  };
}

export type ServerStatusResponse = {
  results: Record<string, 'required' | 'unsupported'>;
};

export async function fetchServerStatus(
  projectIds: string[],
  source: string
): Promise<ServerStatusResponse> {
  if (projectIds.length === 0) {
    return { results: {} };
  }
  const params = new URLSearchParams({
    ids: projectIds.join(','),
    source,
  });
  const data = await api.get<ServerStatusResponse>(`/modpacks/server-status?${params.toString()}`);
  return { results: data?.results ?? {} };
}

export async function getModpackDetail(
  projectId: string,
  source?: string
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams();
  if (source) {
    params.set('source', source);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return api.get<Record<string, unknown>>(`/modpacks/${projectId}${suffix}`);
}

export async function fetchServerFiles(
  projectId: string,
  source?: string,
  force?: boolean
): Promise<ServerFilesResponse> {
  const params = new URLSearchParams();
  if (source) {
    params.set('source', source);
  }
  if (force) {
    params.set('force', 'true');
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await api.get<ServerFilesResponse>(`/modpacks/${projectId}/server-files${suffix}`);
  return {
    available: Boolean(data?.available),
    versions: Array.isArray(data?.versions) ? data.versions : [],
  };
}
