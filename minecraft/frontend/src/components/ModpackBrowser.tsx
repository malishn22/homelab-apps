import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modpack, ModpackSource } from '../types';
import { ModrinthModpack, searchModpacks } from '../api/modpacks';
import { Search, Download, Sparkles, Users, Clock, RefreshCcw, ServerCrash, Server as ServerIcon, ChevronLeft, ChevronRight, CheckCircle2, Loader2 } from 'lucide-react';

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
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const minutes = Math.floor(diffMs / (1000 * 60));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
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
    serverSide: (hit.server_side || '').toLowerCase() || 'unsupported',
    imageUrl: hit.icon_url || `https://api.dicebear.com/7.x/shapes/svg?seed=${hit.slug || idx}`,
    source: (hit.source as ModpackSource) || 'modrinth',
});

const mapModrinthToModpacks = (items: ModrinthModpack[]): Modpack[] =>
    items.map((item, idx) => mapApiHitToModpack(item, idx));

interface ModpackBrowserProps {
    onSelect?: (modpack: Modpack) => void;
    onAddNotifications?: (messages: string[]) => void;
}

type SortMode = 'downloads' | 'updated' | 'relevance' | 'follows';
type SourceFilterOption = {
    key: ModpackSource;
    label: string;
    dotClass: string;
};

const SOURCE_FILTERS: SourceFilterOption[] = [
    { key: 'modrinth', label: 'Modrinth', dotClass: 'bg-violet-400' },
    { key: 'curseforge', label: 'CurseForge', dotClass: 'bg-amber-400' },
];

const SOURCE_BADGES: Record<
    ModpackSource,
    { label: string; className: string }
> = {
    modrinth: {
        label: 'Modrinth',
        className: 'bg-violet-500/15 border-violet-400/40 text-violet-200',
    },
    curseforge: {
        label: 'CurseForge',
        className: 'bg-amber-500/15 border-amber-400/40 text-amber-200',
    },
    ftb: {
        label: 'FTB',
        className: 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200',
    },
};

const ModpackBrowser: React.FC<ModpackBrowserProps> = ({ onSelect, onAddNotifications: _onAddNotifications }) => {
    const [modpacks, setModpacks] = useState<Modpack[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sortMode, setSortMode] = useState<SortMode>('downloads');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [serverFilter, setServerFilter] = useState<'all' | 'server' | 'client'>('all');
    const [selectedSources, setSelectedSources] = useState<ModpackSource[]>(['modrinth', 'curseforge']);
    const [totalHits, setTotalHits] = useState(0);
    const [reloadToken, setReloadToken] = useState(0);
    const forceRefreshRef = useRef(false);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 250);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        let isMounted = true;
        setIsLoading(true);
        setError(null);

        const fetchSearchResults = async () => {
            try {
                const forceRefresh = forceRefreshRef.current;
                const resp = await searchModpacks({
                    query: debouncedQuery,
                    page: Math.max(0, page - 1),
                    limit: pageSize,
                    sort: sortMode,
                    sources: selectedSources,
                    force: forceRefresh,
                });
                if (!isMounted) return;
                const hits = Array.isArray(resp.hits) ? resp.hits : [];
                setModpacks(mapModrinthToModpacks(hits));
                const total = typeof resp.total_hits === 'number' ? resp.total_hits : hits.length;
                setTotalHits(total);
                setLastFetchedAt(new Date().toISOString());
                if (forceRefresh) {
                    forceRefreshRef.current = false;
                }
            } catch (err: any) {
                if (!isMounted) return;
                setError(err?.message || 'Failed to load modpacks.');
                setModpacks([]);
                setTotalHits(0);
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        fetchSearchResults();

        return () => {
            isMounted = false;
        };
    }, [debouncedQuery, page, pageSize, sortMode, reloadToken, selectedSources]);

    const handleRefreshClick = () => {
        forceRefreshRef.current = true;
        setReloadToken((token) => token + 1);
        setPage(1);
    };

    useEffect(() => {
        setPage(1);
    }, [debouncedQuery, sortMode, pageSize, serverFilter, selectedSources]);

    const filteredPacks = useMemo(() => {
        const activeSources = new Set(selectedSources);
        const filtered = modpacks.filter((pack) => {
            const packSource = (pack.source || 'modrinth') as ModpackSource;
            if (activeSources.size > 0 && !activeSources.has(packSource)) {
                return false;
            }
            const serverSide = (pack.serverSide || '').toLowerCase() || 'unsupported';
            if (serverFilter === 'server') {
                return serverSide !== 'unsupported';
            }
            if (serverFilter === 'client') {
                return serverSide === 'unsupported';
            }
            return true;
        });
        return filtered;
    }, [modpacks, serverFilter, selectedSources]);

    const toggleSource = (source: ModpackSource) => {
        setSelectedSources((prev) => {
            const isActive = prev.includes(source);
            if (isActive) {
                return prev.length > 1 ? prev.filter((item) => item !== source) : prev;
            }
            return [...prev, source];
        });
    };

    const totalPages = useMemo(() => {
        const total = totalHits || filteredPacks.length;
        const pages = Math.ceil(total / pageSize);
        return pages > 0 ? pages : 1;
    }, [filteredPacks.length, pageSize, totalHits]);

    useEffect(() => {
        if (page > totalPages) {
            setPage(totalPages);
        }
    }, [page, totalPages]);

    const pagedPacks = filteredPacks;

    return (
        <div className="h-full flex flex-col p-2">
            <div className="flex justify-between items-start mb-8 gap-4 flex-wrap">
                <div>
                    <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-text-muted mb-2 flex items-center gap-2">
                        <Sparkles className="text-accent" size={24} />
                        Modpack Library
                    </h2>
                    <p className="text-text-muted">
                        Live modpack search proxied by your backend (5 min in-memory cache).
                    </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <button
                        onClick={handleRefreshClick}
                        disabled={isLoading}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:border-primary/50 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(88,28,135,0.12)]"
                    >
                        <RefreshCcw size={16} className={isLoading ? 'animate-spin' : ''} />
                        {isLoading ? 'Loading...' : 'Refresh search'}
                    </button>
                    <div className="text-[11px] text-text-dim">
                        {lastFetchedAt
                            ? `Fetched ${formatRefreshedAt(lastFetchedAt)} (cached ≤5m)`
                            : 'First fetch may take a moment.'}
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-auto pb-10">
                <div className="flex flex-col lg:flex-row gap-6">
                    <div className="flex-1 min-w-0 space-y-4">
                        {isLoading && modpacks.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-20 px-6 rounded-2xl glass-panel border border-border-main/50">
                                <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" strokeWidth={2} />
                                <p className="text-lg font-medium text-white mb-1">Loading modpacks</p>
                                <p className="text-sm text-text-muted text-center max-w-sm">Fetching from Modrinth and CurseForge. First load may take a few seconds.</p>
                            </div>
                        )}

                        {isLoading && modpacks.length > 0 && (
                            <div className="glass-panel rounded-2xl p-4 text-text-muted text-sm flex items-center gap-2">
                                <Loader2 size={16} className="animate-spin shrink-0" />
                                Updating results…
                            </div>
                        )}

                        {error && (
                            <div className="glass-panel rounded-2xl p-6 text-red-400 border border-red-500/30 bg-red-500/5">
                                {error}
                            </div>
                        )}

                        {(!isLoading || modpacks.length > 0) && (
                            <div className="space-y-4">
                                {pagedPacks.map((pack, idx) => (
                                    <button
                                        key={pack.id}
                                        onClick={() => onSelect?.(pack)}
                                        className="w-full text-left glass-panel p-4 rounded-2xl flex items-center gap-4 glass-panel-hover transition-all hover:border-primary/40 hover:shadow-primary/20"
                                    >
                                        <div className="text-2xl font-bold text-primary w-10 text-center">
                                            {(page - 1) * pageSize + idx + 1}
                                        </div>
                                        <div className="w-20 h-14 rounded-xl overflow-hidden bg-bg-surface border border-border-main/70 shrink-0">
                                            <img src={pack.imageUrl} alt={pack.title} className="w-full h-full object-cover" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="font-bold text-lg text-white truncate flex items-center gap-2">
                                                    {pack.title}
                                                    {(() => {
                                                        const sourceKey = (pack.source || 'modrinth') as ModpackSource;
                                                        const sourceBadge = SOURCE_BADGES[sourceKey];
                                                        return sourceBadge ? (
                                                            <span
                                                                className={`inline-flex items-center gap-1 px-2 py-[2px] rounded-full border text-[9px] leading-none uppercase tracking-wide ${sourceBadge.className}`}
                                                            >
                                                                {sourceBadge.label}
                                                            </span>
                                                        ) : null;
                                                    })()}
                                                    {pack.serverSide ? (
                                                        (pack.serverSide || '').toLowerCase() === 'unsupported' ? (
                                                            <span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full bg-red-500/10 text-red-300 border border-red-500/30 text-[9px] leading-none uppercase tracking-wide">
                                                                <ServerCrash size={10} /> Client only
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full border border-emerald-500/50 text-emerald-300 bg-transparent text-[9px] leading-none uppercase tracking-wide">
                                                                <CheckCircle2 size={10} /> Server Exist
                                                            </span>
                                                        )
                                                    ) : null}
                                                </h3>
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
                                                                        ? 'bg-blue-500/15 border-blue-400/30 text-blue-200'
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
                                    placeholder="Search modpacks..." 
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
                                        { key: 'relevance', label: 'Relevance' },
                                        { key: 'updated', label: 'Recently Updated' },
                                        { key: 'follows', label: 'Most Followed' },
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

                            <div className="space-y-3">
                                <div className="text-xs uppercase tracking-wide text-text-dim">Sources</div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {SOURCE_FILTERS.map((opt) => {
                                        const isActive = selectedSources.includes(opt.key);
                                        return (
                                            <button
                                                key={opt.key}
                                                onClick={() => toggleSource(opt.key)}
                                                aria-pressed={isActive}
                                                className={`w-full text-left px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                                                    isActive
                                                        ? 'border-primary/60 bg-primary/15 text-primary shadow-[0_0_0_1px_rgba(129,140,248,0.25)]'
                                                        : 'border-border-main bg-bg-surface/60 text-text-muted hover:border-primary/30 hover:text-white'
                                                }`}
                                            >
                                                <span className="inline-flex items-center gap-2">
                                                    <span className={`h-2 w-2 rounded-full ${opt.dotClass}`} />
                                                    {opt.label}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="text-xs uppercase tracking-wide text-text-dim">Filters</div>
                                <div className="flex flex-wrap gap-2">
                                    <select
                                        value={serverFilter}
                                        onChange={(e) => {
                                            setServerFilter(e.target.value as any);
                                            setPage(1);
                                        }}
                                        className="bg-bg-surface/60 border border-border-main rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                    >
                                        <option value="all">All</option>
                                        <option value="server">Server</option>
                                        <option value="client">Client only</option>
                                    </select>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-text-dim">View:</span>
                                        <select
                                            value={pageSize}
                                            onChange={(e) => {
                                                setPageSize(parseInt(e.target.value, 10) || 10);
                                                setPage(1);
                                            }}
                                            className="bg-bg-surface/60 border border-border-main rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                        >
                                            {[10, 20, 50, 100].map((size) => (
                                                <option key={size} value={size}>{size}</option>
                                            ))}
                                        </select>
                                        <div className="flex items-center gap-2 ml-auto">
                                            <button
                                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                                disabled={page <= 1}
                                                className="p-2 rounded-lg border border-border-main bg-bg-surface/60 text-text-muted hover:text-white hover:border-primary/40 transition disabled:opacity-50"
                                            >
                                                <ChevronLeft size={16} />
                                            </button>
                                            <div className="text-sm text-white px-3 py-1 rounded-lg bg-white/5 border border-border-main">
                                                {page} / {totalPages}
                                            </div>
                                            <button
                                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                                disabled={page >= totalPages}
                                                className="p-2 rounded-lg border border-border-main bg-bg-surface/60 text-text-muted hover:text-white hover:border-primary/40 transition disabled:opacity-50"
                                            >
                                                <ChevronRight size={16} />
                                            </button>
                                        </div>
                                    </div>
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
