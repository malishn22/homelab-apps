import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modpack } from '../types';
import { fetchTopModpacks, ModrinthModpack, refreshModpacks } from '../src/api/modpacks';
import { Search, Download, Sparkles, Users, Clock, RefreshCcw } from 'lucide-react';

const formatDownloads = (downloads?: number): string => {
    if (typeof downloads !== 'number') return 'N/A';
    if (downloads >= 1_000_000) return `${(downloads / 1_000_000).toFixed(1)}M`;
    if (downloads >= 1_000) return `${(downloads / 1_000).toFixed(1)}K`;
    return downloads.toString();
};

const formatFollowers = (followers?: number): string | null => {
    if (typeof followers !== 'number') return null;
    return formatDownloads(followers);
};

const formatUpdated = (dateStr?: string): string => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return 'N/A';

    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays <= 7) {
        const diffHours = diffMs / (1000 * 60 * 60);
        if (diffHours < 1) {
            const mins = Math.max(1, Math.floor(diffHours * 60));
            return `${mins} min${mins === 1 ? '' : 's'} ago`;
        }
        if (diffHours < 24) {
            const hrs = Math.max(1, Math.floor(diffHours));
            return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
        }
        const days = Math.max(1, Math.floor(diffDays));
        return `${days} day${days === 1 ? '' : 's'} ago`;
    }

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

const formatRefreshedAt = (value?: string | null): string => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
};

const mapApiHitToModpack = (hit: ModrinthModpack, idx: number): Modpack => ({
    id: hit.project_id || hit.slug || `modpack-${idx}`,
    slug: hit.slug,
    title: hit.title ?? 'Untitled',
    description: hit.description ?? 'No description available.',
    author: hit.author || 'Unknown',
    downloads: formatDownloads(hit.downloads),
    downloadsCount: typeof hit.downloads === 'number' ? hit.downloads : undefined,
    followers: formatFollowers(hit.followers),
    followersCount: typeof hit.followers === 'number' ? hit.followers : undefined,
    updatedAt: hit.updated || hit.date_modified || hit.date_created,
    categories: hit.categories || [],
    gameVersions: hit.game_versions || hit.versions || [],
    loaders: hit.loaders || [],
    imageUrl: hit.icon_url || `https://api.dicebear.com/7.x/shapes/svg?seed=${hit.slug || idx}`,
});

const mapModrinthToModpacks = (items: ModrinthModpack[]): Modpack[] =>
    items.map((item, idx) => mapApiHitToModpack(item, idx));

interface ModpackBrowserProps {
    onSelect?: (modpack: Modpack) => void;
    onAddNotifications?: (messages: string[]) => void;
}

type SortMode = 'downloads' | 'updated' | 'title-asc' | 'title-desc';

const ModpackBrowser: React.FC<ModpackBrowserProps> = ({ onSelect, onAddNotifications }) => {
    const topLimit = 25;
    const [modpacks, setModpacks] = useState<Modpack[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sortMode, setSortMode] = useState<SortMode>('downloads');

    const loadTopModpacks = useCallback(async () => {
        const response = await fetchTopModpacks(topLimit);
        return response;
    }, [topLimit]);

    useEffect(() => {
        let isMounted = true;

        const fetchTop = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const resp = await loadTopModpacks();
                if (!isMounted) return;
                const items = Array.isArray(resp.items) ? resp.items : [];
                setModpacks(mapModrinthToModpacks(items));
                setLastRefreshed(resp.refreshed_at ?? null);
            } catch (err: any) {
                if (!isMounted) return;
                setError(err?.message || 'Failed to load modpacks.');
            } finally {
                if (!isMounted) return;
                setIsLoading(false);
            }
        };

        fetchTop();
        return () => {
            isMounted = false;
        };
    }, [loadTopModpacks]);

    const handleRefreshClick = async () => {
        const prevById = new Map(modpacks.map((p) => [p.id, p]));
        setIsRefreshing(true);
        setError(null);
        try {
            const resp = await refreshModpacks(topLimit);
            const items = Array.isArray(resp.items) ? resp.items : [];
            const mapped = mapModrinthToModpacks(items);
            setModpacks(mapped);
            setLastRefreshed(resp.refreshed_at ?? new Date().toISOString());

            if (onAddNotifications) {
                const updatedMods = mapped.filter((p) => {
                    const prev = prevById.get(p.id);
                    return prev && prev.updatedAt !== p.updatedAt;
                });
                if (updatedMods.length) {
                    onAddNotifications(updatedMods.map((p) => `${p.title} updated.`));
                }
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to refresh modpacks.');
        } finally {
            setIsRefreshing(false);
        }
    };

    const filteredPacks = useMemo(() => {
        const q = searchQuery.toLowerCase();
        const filtered = modpacks.filter((pack) =>
            pack.title.toLowerCase().includes(q) || pack.description.toLowerCase().includes(q)
        );

        const sorted = [...filtered].sort((a, b) => {
            switch (sortMode) {
                case 'downloads': {
                    const da = a.downloadsCount ?? 0;
                    const db = b.downloadsCount ?? 0;
                    if (db !== da) return db - da;
                    return a.title.localeCompare(b.title);
                }
                case 'updated': {
                    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
                    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
                    if (tb !== ta) return tb - ta;
                    return a.title.localeCompare(b.title);
                }
                case 'title-asc':
                    return a.title.localeCompare(b.title);
                case 'title-desc':
                    return b.title.localeCompare(a.title);
                default:
                    return 0;
            }
        });

        return sorted;
    }, [modpacks, searchQuery, sortMode]);

    return (
        <div className="h-full flex flex-col p-2">
            <div className="flex justify-between items-start mb-8 gap-4 flex-wrap">
                <div>
                    <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-text-muted mb-2 flex items-center gap-2">
                        <Sparkles className="text-accent" size={24} />
                        Modpack Library
                    </h2>
                    <p className="text-text-muted">
                        Served from your cached modpack database. Refresh to sync with Modrinth.
                    </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <button
                        onClick={handleRefreshClick}
                        disabled={isRefreshing || isLoading}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:border-primary/50 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(88,28,135,0.12)]"
                    >
                        <RefreshCcw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                        {isRefreshing ? 'Refreshing...' : 'Refresh Mods'}
                    </button>
                    <div className="text-[11px] text-text-dim">
                        {lastRefreshed ? `Refreshed ${formatRefreshedAt(lastRefreshed)}` : ''}
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-auto pb-10">
                <div className="flex flex-col lg:flex-row gap-6">
                    <div className="flex-1 min-w-0 space-y-4">
                        {isLoading && (
                            <div className="glass-panel rounded-2xl p-6 text-text-muted">Fetching top modpacks...</div>
                        )}

                        {error && (
                            <div className="glass-panel rounded-2xl p-6 text-red-400 border border-red-500/30 bg-red-500/5">
                                {error}
                            </div>
                        )}

                        {!isLoading && (
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

                                {filteredPacks.length === 0 && !error && (
                                    <div className="glass-panel rounded-2xl p-6 text-text-muted">
                                        No modpacks match your search.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <aside className="w-full lg:w-80 xl:w-96 flex-shrink-0 order-first lg:order-last">
                        <div className="glass-panel p-4 rounded-2xl space-y-3">
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

                            <div className="space-y-3">
                                <div className="text-xs uppercase tracking-wide text-text-dim">Order by</div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {[
                                        { key: 'downloads', label: 'Most Downloaded' },
                                        { key: 'updated', label: 'Recently Updated' },
                                        { key: 'title-asc', label: 'Title A → Z' },
                                        { key: 'title-desc', label: 'Title Z → A' },
                                    ].map((opt) => (
                                        <button
                                            key={opt.key}
                                            onClick={() => setSortMode(opt.key as SortMode)}
                                            className={`w-full text-left px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                                                sortMode === opt.key
                                                    ? 'border-primary/60 bg-primary/15 text-primary shadow-[0_0_0_1px_rgba(129,140,248,0.25)]'
                                                    : 'border-border-main bg-bg-surface/60 text-text-muted hover:border-primary/30 hover:text-white'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
};

export default ModpackBrowser;
