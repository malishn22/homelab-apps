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
};

type TopModpacksResponse = {
  items?: ModrinthModpack[];
};

export async function fetchTopModpacks(limit = 5): Promise<ModrinthModpack[]> {
  const res = await fetch(buildApiUrl(`/api/modpacks/top?limit=${limit}`));
  if (!res.ok) {
    throw new Error(`Failed to fetch modpacks: ${res.status}`);
  }

  const data: TopModpacksResponse = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}
