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
};

export type ServerVersion = {
  id?: string;
  version_number?: string;
  game_versions?: string[];
  loaders?: string[];
  date_published?: string;
  files?: { filename?: string; url?: string }[];
};

export type ServerFilesResponse = {
  available: boolean;
  versions: ServerVersion[];
};

export type TopModpacksResponse = {
  items?: ModrinthModpack[];
  count?: number;
  refreshed_at?: string;
};

const parseTopResponse = async (res: Response): Promise<TopModpacksResponse> => {
  if (!res.ok) {
    throw new Error(`Failed to fetch modpacks: ${res.status}`);
  }

  const data: TopModpacksResponse = await res.json();
  return data;
};

export async function fetchTopModpacks(limit = 5): Promise<TopModpacksResponse> {
  const res = await fetch(buildApiUrl(`/api/modpacks/top?limit=${limit}`));
  return parseTopResponse(res);
}

export async function refreshModpacks(limit = 25): Promise<TopModpacksResponse> {
  const res = await fetch(buildApiUrl(`/api/modpacks/refresh?limit=${limit}`), {
    method: 'POST',
  });
  return parseTopResponse(res);
}

export async function fetchServerFiles(projectId: string): Promise<ServerFilesResponse> {
  const res = await fetch(buildApiUrl(`/api/modpacks/${projectId}/server-files`));
  if (!res.ok) {
    throw new Error(`Failed to fetch server files: ${res.status}`);
  }
  const data = await res.json();
  return {
    available: Boolean(data?.available),
    versions: Array.isArray(data?.versions) ? data.versions : [],
  };
}
