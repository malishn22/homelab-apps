import React, { useEffect, useMemo, useState } from 'react';
import { Modpack } from '../types';
import { fetchTopModpacks, ModrinthModpack } from '../src/api/modpacks';
import { Search, Download, Sparkles, Users, Clock } from 'lucide-react';

const formatDownloads = (downloads?: number): string => {
    if (typeof downloads !== 'number') return 'N/A';
    if (downloads >= 1_000_000) return `${(downloads / 1_000_000).toFixed(1)}M`;
    if (downloads >= 1_000) return `${(downloads / 1_000).toFixed(1)}K`;
    return downloads.toString();
};

const formatFollowers = (followers?: number): string => formatDownloads(followers);

const formatUpdated = (dateStr?: string): string => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
};

const isGameVersion = (value?: string): boolean => {
    if (!value) return false;
    const v = value.trim().toLowerCase();
    if (v.includes('fabric') || v.includes('forge') || v.includes('loader') || v.includes('quilt')) return false;
    const release = /^\d+(\.\d+){1,2}([.-](pre|rc)\d+)?$/i;
    return release.test(v);
};

const compareVersionsDesc = (a?: string, b?: string): number => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
    const pa = parse(a);
    const pb = parse(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const va = pa[i] ?? 0;
        const vb = pb[i] ?? 0;
        if (va !== vb) return vb - va;
    }
    return 0;
};

const mapApiHitToModpack = (hit: ModrinthModpack, idx: number): Modpack => ({
    id: hit.project_id || hit.slug || `modpack-${idx}`,
    slug: hit.slug,
    title: hit.title ?? 'Untitled',
    description: hit.description ?? 'No description available.',
    author: hit.author || 'Unknown',
    downloads: formatDownloads(hit.downloads),
    followers: formatFollowers(hit.followers),
    updatedAt: hit.updated || hit.date_modified || hit.date_created,
    categories: hit.categories || [],
    gameVersions: hit.game_versions || hit.versions || [],
    loaders: hit.loaders || [],
    imageUrl: hit.icon_url || `https://api.dicebear.com/7.x/shapes/svg?seed=${hit.slug || idx}`,
});

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedTop: Modpack[] | null = null;
let cachedAt = 0;
let cachedPromise: Promise<Modpack[]> | null = null;

const getCachedTop = (): Modpack[] | null => {
    if (cachedTop && Date.now() - cachedAt < CACHE_TTL_MS) {
        return cachedTop;
    }
    return null;
};

const fetchTopWithCache = async (limit: number): Promise<Modpack[]> => {
    const cached = getCachedTop();
    if (cached) return cached;
    if (cachedPromise) return cachedPromise;

    cachedPromise = fetchTopModpacks(limit)
        .then((items) => items.map(mapApiHitToModpack))
        .then((mapped) => {
            cachedTop = mapped;
            cachedAt = Date.now();
            return mapped;
        })
        .finally(() => {
            cachedPromise = null;
        });

    return cachedPromise;
};

interface ModpackBrowserProps {
    onSelect?: (modpack: Modpack) => void;
}

const ModpackBrowser: React.FC<ModpackBrowserProps> = ({ onSelect }) => {
    const topLimit = 25;
    const [modpacks, setModpacks] = useState<Modpack[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        const cached = getCachedTop();
        if (cached) {
            setModpacks(cached);
        }
        const fetchTop = async () => {
            if (!cached) setIsLoading(true);
            setError(null);
            try {
                const items = await fetchTopWithCache(topLimit);
                if (!isMounted) return;
                setModpacks(items);
            } catch (err: any) {
                if (!isMounted) return;
                setError(err?.message || 'Failed to load modpacks.');
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        fetchTop();
        return () => {
            isMounted = false;
        };
    }, [topLimit]);

    const filteredPacks = useMemo(() => {
        const q = searchQuery.toLowerCase();
        return modpacks.filter((pack) =>
            pack.title.toLowerCase().includes(q) || pack.description.toLowerCase().includes(q)
        );
    }, [modpacks, searchQuery]);

    return (
        <div className="h-full flex flex-col p-2">
            <div className="flex justify-between items-end mb-8">
                <div>
                    <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-text-muted mb-2 flex items-center gap-2">
                        <Sparkles className="text-accent" size={24} />
                        Top Modrinth Packs
                    </h2>
                    <p className="text-text-muted">Live list fetched from your backend.</p>
                </div>
                <div className="text-right hidden md:block">
                    <div className="text-xs text-text-muted uppercase tracking-wider">Showing top {topLimit}</div>
                </div>
            </div>

            {/* Search */}
            <div className="mb-6 glass-panel p-4 rounded-2xl">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-primary" size={20} />
                    <input 
                        type="text" 
                        placeholder="Search within the top list..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-bg-surface/50 border border-border-main rounded-xl py-3 pl-12 pr-4 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-text-dim"
                    />
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto pb-10">
                {isLoading && (
                    <div className="glass-panel rounded-2xl p-6 text-text-muted">Fetching top modpacks…</div>
                )}

                {error && (
                    <div className="glass-panel rounded-2xl p-6 text-red-400 border border-red-500/30 bg-red-500/5">
                        {error}
                    </div>
                )}

                {!isLoading && !error && (
                    <div className="space-y-4">
                        {filteredPacks.map((pack, idx) => (
                            <button
                                key={pack.id}
                                onClick={() => onSelect?.(pack)}
                                className="w-full text-left glass-panel p-4 rounded-2xl flex items-center gap-4 glass-panel-hover transition-all hover:border-primary/40 hover:shadow-primary/20"
                            >
                                <div className="text-2xl font-bold text-primary w-10 text-center">{idx + 1}</div>
                                <div className="w-20 h-14 rounded-xl overflow-hidden bg-bg-surface border border-border-main/70 shrink-0">
                                    <img src={pack.imageUrl} alt={pack.title} className="w-full h-full object-cover" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="font-bold text-lg text-white truncate">{pack.title}</h3>
                                        {(() => {
                                            const loaderCandidates = [
                                                ...(pack.loaders || []),
                                                ...(pack.categories || []).filter((c) => ['fabric', 'forge', 'quilt', 'neoforge'].includes(c.toLowerCase())),
                                            ];
                                            const seenLoader = new Set<string>();
                                            const loaders = loaderCandidates.filter((l) => {
                                                const key = l.toLowerCase();
                                                if (seenLoader.has(key)) return false;
                                                seenLoader.add(key);
                                                return true;
                                            });

                                            const fabricLoader = loaders.find((l) => l.toLowerCase() === 'fabric');
                                            const primaryLoaderBase = fabricLoader || loaders[0];
                                            const isMultiLoader = loaders.length > 1 && !!primaryLoaderBase;
                                            const primaryLoader = isMultiLoader ? 'MULTI' : primaryLoaderBase;
                                            const otherLoaders = isMultiLoader
                                                ? []
                                                : loaders
                                                      .filter((l) => l !== primaryLoaderBase)
                                                      .sort((a, b) => a.localeCompare(b));

                                            const versionCandidates = [
                                                ...(pack.gameVersions || []),
                                                ...(pack.categories || []).filter((c) => isGameVersion(c)),
                                            ].filter(isGameVersion);
                                            const versions = Array.from(new Set(versionCandidates)).sort(compareVersionsDesc);
                                            const latestVersion = versions[0];

                                            const primaryBadges = [
                                                primaryLoader && (
                                                    <span
                                                        key={`loader-${pack.id}-${primaryLoader}`}
                                                        className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${
                                                            isMultiLoader
                                                                ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200'
                                                                : 'bg-primary/10 border-primary/20 text-primary'
                                                        }`}
                                                    >
                                                        {primaryLoader}
                                                    </span>
                                                ),
                                                latestVersion && (
                                                    <span
                                                        key={`ver-${pack.id}-${latestVersion}`}
                                                        className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-primary/10 border border-primary/20 rounded text-primary"
                                                    >
                                                        {latestVersion}
                                                    </span>
                                                ),
                                            ].filter(Boolean);

                                            const secondaryBadges = [
                                                ...otherLoaders.map((loader) => (
                                                    <span
                                                        key={`loader-${pack.id}-${loader}`}
                                                        className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-white/5 border border-white/5 rounded text-text-muted"
                                                    >
                                                        {loader}
                                                    </span>
                                                )),
                                                ...pack.categories
                                                    .filter(
                                                        (cat) =>
                                                            !['fabric', 'forge', 'quilt', 'neoforge'].includes(cat.toLowerCase()) &&
                                                            !isGameVersion(cat)
                                                    )
                                                    .sort((a, b) => a.localeCompare(b))
                                                    .slice(0, 3)
                                                    .map((cat) => (
                                                        <span
                                                            key={cat}
                                                            className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-white/5 border border-white/5 rounded text-text-muted"
                                                        >
                                                            {cat}
                                                        </span>
                                                    )),
                                            ];

                                            return (
                                                <>
                                                    {primaryBadges}
                                                    {secondaryBadges}
                                                </>
                                            );
                                        })()}
                                    </div>
                                    <p className="text-text-muted text-sm line-clamp-2 mt-1">{pack.description}</p>
                                    <div className="flex items-center gap-4 text-xs text-text-dim mt-2">
                                        <span>Author: {pack.author}</span>
                                        <span className="flex items-center gap-1 text-accent font-semibold">
                                            <Download size={14} /> {pack.downloads} downloads
                                        </span>
                                        {pack.followers && (
                                            <span className="flex items-center gap-1 text-text-muted">
                                                <Users size={14} /> {pack.followers} followers
                                            </span>
                                        )}
                                        {pack.updatedAt && (
                                            <span className="flex items-center gap-1 text-text-muted">
                                                <Clock size={14} /> {formatUpdated(pack.updatedAt)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </button>
                        ))}

                        {filteredPacks.length === 0 && (
                            <div className="glass-panel rounded-2xl p-6 text-text-muted">
                                No modpacks match your search.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ModpackBrowser;
