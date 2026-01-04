const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

const buildApiUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
};

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

const parseSearchResponse = async (res: Response): Promise<SearchModpacksResponse> => {
  if (!res.ok) {
    throw new Error(`Failed to fetch modpacks: ${res.status}`);
  }

  const data = await res.json();
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  return {
    hits,
    limit: data?.limit,
    offset: data?.offset,
    total_hits: data?.total_hits,
  };
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

  const res = await fetch(buildApiUrl(`/api/modpacks/search?${searchParams.toString()}`));
  return parseSearchResponse(res);
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
  const res = await fetch(buildApiUrl(`/api/modpacks/${projectId}/server-files${suffix}`));
  if (!res.ok) {
    throw new Error(`Failed to fetch server files: ${res.status}`);
  }
  const data = await res.json();
  return {
    available: Boolean(data?.available),
    versions: Array.isArray(data?.versions) ? data.versions : [],
  };
}
