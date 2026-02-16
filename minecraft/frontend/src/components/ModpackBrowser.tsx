import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modpack, ModpackSource } from '../types';
import { ModrinthModpack, searchModpacks, fetchServerStatus } from '../api/modpacks';
import { Search, Download, Sparkles, Users, Clock, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import ServerStatusBadge from './ServerStatusBadge';
import ModpackProviderBadge from './ModpackProviderBadge';
import { Input, Select, TabGroup, Button, TagBadge } from './ui';
import { formatDownloads, formatFollowers, formatUpdated, isGameVersion, compareVersionsDesc } from '../utils';

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
    serverSide: (hit.server_side || 'pending').toLowerCase() || 'pending',
    imageUrl: hit.icon_url || `https://api.dicebear.com/7.x/shapes/svg?seed=${hit.slug || idx}`,
    source: (hit.source as ModpackSource) || 'modrinth',
});

const mapModrinthToModpacks = (items: ModrinthModpack[]): Modpack[] =>
    items.map((item, idx) => mapApiHitToModpack(item, idx));

interface ModpackBrowserProps {
    serverStatusCache: Record<string, 'required' | 'unsupported'>;
    onServerStatusUpdate: (updates: Record<string, 'required' | 'unsupported'>) => void;
    onSelect?: (modpack: Modpack) => void;
    onAddNotifications?: (messages: string[]) => void;
}

type SortMode = 'relevance' | 'popularity' | 'updated' | 'dateCreated' | 'downloads';

const PROVIDER_OPTIONS: { key: ModpackSource; label: string }[] = [
    { key: 'curseforge', label: 'CurseForge' },
    { key: 'modrinth', label: 'Modrinth' },
];

const ModpackBrowser: React.FC<ModpackBrowserProps> = ({
    serverStatusCache,
    onServerStatusUpdate,
    onSelect,
    onAddNotifications: _onAddNotifications,
}) => {
    const [modpacks, setModpacks] = useState<Modpack[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [submittedQuery, setSubmittedQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sortMode, setSortMode] = useState<SortMode>('popularity');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [serverFilter, setServerFilter] = useState<'all' | 'server' | 'client'>('all');
    const [selectedProvider, setSelectedProvider] = useState<ModpackSource>('curseforge');
    const [totalHits, setTotalHits] = useState(0);

    const handleSearchSubmit = () => {
        setSubmittedQuery(searchQuery.trim());
        setPage(1);
    };

    useEffect(() => {
        let isMounted = true;
        setIsLoading(true);
        setError(null);

        const fetchSearchResults = async () => {
            try {
                const resp = await searchModpacks({
                    query: submittedQuery,
                    page: Math.max(0, page - 1),
                    limit: pageSize,
                    sort: sortMode,
                    sources: [selectedProvider],
                });
                if (!isMounted) return;
                const hits = Array.isArray(resp.hits) ? resp.hits : [];
                setModpacks(mapModrinthToModpacks(hits));
                const total = typeof resp.total_hits === 'number' ? resp.total_hits : hits.length;
                setTotalHits(total);
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
    }, [submittedQuery, page, pageSize, sortMode, selectedProvider]);

    useEffect(() => {
        const pending = modpacks.filter(
            (p) =>
                (p.serverSide || 'pending').toLowerCase() === 'pending' &&
                !(p.id in serverStatusCache)
        );
        if (pending.length === 0) return;
        const bySource = new Map<string, string[]>();
        for (const p of pending) {
            const src = (p.source || selectedProvider) as string;
            if (!bySource.has(src)) bySource.set(src, []);
            bySource.get(src)!.push(p.id);
        }
        bySource.forEach((ids, source) => {
            fetchServerStatus(ids, source)
                .then(({ results }) => {
                    onServerStatusUpdate(results);
                })
                .catch(() => {});
        });
    }, [modpacks, serverStatusCache, selectedProvider, onServerStatusUpdate]);

    useEffect(() => {
        setPage(1);
    }, [submittedQuery, sortMode, pageSize, serverFilter, selectedProvider]);

    const effectiveServerSide = useCallback(
        (pack: Modpack) => serverStatusCache[pack.id] ?? (pack.serverSide || 'pending').toLowerCase(),
        [serverStatusCache]
    );

    const filteredPacks = useMemo(() => {
        return modpacks.filter((pack) => {
            const serverSide = effectiveServerSide(pack);
            if (serverFilter === 'server') {
                return serverSide === 'required' || serverSide === 'optional';
            }
            if (serverFilter === 'client') {
                return serverSide === 'unsupported';
            }
            return true;
        });
    }, [modpacks, serverFilter, effectiveServerSide]);

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
            <div className="mb-8">
                <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-text-muted mb-2 flex items-center gap-2">
                    <Sparkles className="text-accent" size={24} />
                    Modpack Library
                </h2>
                <p className="text-text-muted">
                    Live modpack search proxied by your backend (5 min in-memory cache).
                </p>
            </div>

            <div className="flex-1 overflow-auto pb-10">
                <div className="flex flex-col lg:flex-row gap-6">
                    <div className="flex-1 min-w-0 space-y-4">
                        {isLoading && modpacks.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-20 px-6 rounded-2xl glass-panel border border-border-main/50">
                                <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" strokeWidth={2} />
                                <p className="text-lg font-medium text-white mb-1">Loading modpacks</p>
                                <p className="text-sm text-text-muted text-center max-w-sm">Fetching from {PROVIDER_OPTIONS.find((o) => o.key === selectedProvider)?.label || selectedProvider}. First load may take a few seconds.</p>
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
                                            <div className="flex flex-col gap-2">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-bold text-lg text-white truncate flex items-center gap-2 shrink-0">
                                                        {pack.title}
                                                        <ModpackProviderBadge provider={(pack.source || 'modrinth') as ModpackSource} />
                                                        {(() => {
                                                            const ss = effectiveServerSide(pack);
                                                            if (ss === 'pending') {
                                                                return <ServerStatusBadge status="pending" />;
                                                            }
                                                            if (ss === 'unsupported') {
                                                                return <ServerStatusBadge status="client" />;
                                                            }
                                                            return <ServerStatusBadge status="server" />;
                                                        })()}
                                                    </h3>
                                                </div>
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
                                                            <TagBadge
                                                                key={`loader-${pack.id}-${primaryLoader}`}
                                                                variant={isMultiLoader ? 'multi' : 'primary'}
                                                                size="sm"
                                                            >
                                                                {primaryLoader}
                                                            </TagBadge>
                                                        ),
                                                        latestVersion && (
                                                            <TagBadge
                                                                key={`ver-${pack.id}-${latestVersion}`}
                                                                variant="primary"
                                                                size="sm"
                                                            >
                                                                {latestVersion}
                                                            </TagBadge>
                                                        ),
                                                    ].filter(Boolean);

                                                    const secondaryBadges = [
                                                        ...otherLoaders.map((loader) => (
                                                            <TagBadge
                                                                key={`loader-${pack.id}-${loader}`}
                                                                variant="muted"
                                                                size="sm"
                                                            >
                                                                {loader}
                                                            </TagBadge>
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
                                                                <TagBadge
                                                                    key={cat}
                                                                    variant="muted"
                                                                    size="sm"
                                                                >
                                                                    {cat}
                                                                </TagBadge>
                                                            )),
                                                    ];

                                                    return (
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            {primaryBadges}
                                                            {secondaryBadges}
                                                        </div>
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
                            <div className="space-y-3">
                                <Select
                                    label="Provider"
                                    options={PROVIDER_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
                                    value={selectedProvider}
                                    onChange={(v) => {
                                        setSelectedProvider(v as ModpackSource);
                                        setPage(1);
                                    }}
                                />
                            </div>
                            <div className="space-y-3">
                                <div className="text-xs uppercase tracking-wide text-text-dim">Search</div>
                                <div className="relative">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-primary" size={20} />
                                    <Input
                                        type="text"
                                        placeholder="Search modpacks (press Enter)"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
                                        className="rounded-xl py-3 pl-12 pr-4 bg-bg-surface/50"
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="text-xs uppercase tracking-wide text-text-dim">Sort by</div>
                                <TabGroup
                                    variant="pills"
                                    options={[
                                        { key: 'relevance', label: 'Relevancy' },
                                        { key: 'popularity', label: 'Popularity' },
                                        { key: 'updated', label: 'Latest update' },
                                        { key: 'dateCreated', label: 'Creation Date' },
                                        { key: 'downloads', label: 'Total Downloads' },
                                    ]}
                                    value={sortMode}
                                    onChange={(k) => setSortMode(k as SortMode)}
                                />
                            </div>

                            <div className="space-y-3">
                                <div className="text-xs uppercase tracking-wide text-text-dim">Filters</div>
                                <div className="flex flex-wrap gap-2">
                                    <Select
                                        options={[
                                            { value: 'all', label: 'All' },
                                            { value: 'server', label: 'Server Exist' },
                                            { value: 'client', label: 'Client only' },
                                        ]}
                                        value={serverFilter}
                                        onChange={(v) => {
                                            setServerFilter(v as 'all' | 'server' | 'client');
                                            setPage(1);
                                        }}
                                    />
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-text-dim">View:</span>
                                        <Select
                                            options={[10, 20, 50].map((s) => ({ value: String(s), label: String(s) }))}
                                            value={String(pageSize)}
                                            onChange={(v) => {
                                                setPageSize(parseInt(v, 10) || 20);
                                                setPage(1);
                                            }}
                                        />
                                        <div className="flex items-center gap-2 ml-auto">
                                            <Button
                                                variant="secondary"
                                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                                disabled={page <= 1}
                                                className="p-2"
                                            >
                                                <ChevronLeft size={16} />
                                            </Button>
                                            <div className="text-sm text-white px-3 py-1 rounded-lg bg-white/5 border border-border-main">
                                                {page} / {totalPages}
                                            </div>
                                            <Button
                                                variant="secondary"
                                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                                disabled={page >= totalPages}
                                                className="p-2"
                                            >
                                                <ChevronRight size={16} />
                                            </Button>
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
