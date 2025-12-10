import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Modpack, ServerVersionOption, Server, InstallRequestOptions } from '../types';
import { ArrowLeft, Download, Package, Tag, Server as ServerIcon, Users, Sparkles, Clock, CheckCircle2, X } from 'lucide-react';
import { fetchServerFiles, ServerVersion } from '../src/api/modpacks';

interface ModpackDetailProps {
    modpack: Modpack;
    onBack: () => void;
    onInstall?: (modpack: Modpack, options?: InstallRequestOptions) => void;
    servers?: Server[];
    loading?: boolean;
    error?: string | null;
}

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

const ModpackDetail: React.FC<ModpackDetailProps> = ({ modpack, onBack, onInstall, loading, error, servers = [] }) => {
    const [isCheckingServers, setIsCheckingServers] = useState(false);
    const [serverVersions, setServerVersions] = useState<ServerVersionOption[]>([]);
    const [serverError, setServerError] = useState<string | null>(null);
    const [serverAvailable, setServerAvailable] = useState(false);
    const [serverCheckComplete, setServerCheckComplete] = useState(false);
    const [showServerPanel, setShowServerPanel] = useState(false);
    const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>(undefined);
    const [selectedServerId, setSelectedServerId] = useState<string | undefined>(servers[0]?.id);
    const [panelStep, setPanelStep] = useState<'version' | 'server'>('version');
    const [newServerName, setNewServerName] = useState<string>(`${modpack.title} Server`);
    const [newServerPort, setNewServerPort] = useState<number>(25565);

    const sanitizeSchema = {
        ...defaultSchema,
        tagNames: [...(defaultSchema.tagNames || []), 'center', 'iframe'],
        attributes: {
            ...(defaultSchema.attributes || {}),
            a: [...(defaultSchema.attributes?.a || []), 'target', 'rel'],
            iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen', 'frameborder', 'loading', 'referrerpolicy'],
            img: [...(defaultSchema.attributes?.img || []), 'loading'],
        },
    };

    const loaderCandidates = [
        ...(modpack.loaders || []),
        ...(modpack.categories || []).filter((c) => ['fabric', 'forge', 'quilt', 'neoforge'].includes(c.toLowerCase())),
    ];
    const seenLoader = new Set<string>();
    const loaders = loaderCandidates
        .filter((l) => {
            const key = l.toLowerCase();
            if (seenLoader.has(key)) return false;
            seenLoader.add(key);
            return true;
        })
        .sort((a, b) => a.localeCompare(b));
    const fabricLoader = loaders.find((l) => l.toLowerCase() === 'fabric');
    const primaryLoaderBase = fabricLoader || loaders[0];
    const isMultiLoader = loaders.length > 1 && !!primaryLoaderBase;
    const otherLoaders = loaders.filter((l) => l !== primaryLoaderBase);

    const versionCandidates = [
        ...(modpack.gameVersions || []),
        ...(modpack.categories || []).filter((c) => isGameVersion(c)),
    ].filter(isGameVersion);
    const versions = Array.from(new Set(versionCandidates)).sort(compareVersionsDesc);
    const latestVersion = versions[0];

    const categoryBadges = (modpack.categories || [])
        .filter(
            (cat) =>
                !['fabric', 'forge', 'quilt', 'neoforge'].includes(cat.toLowerCase()) &&
                !isGameVersion(cat)
        )
        .sort((a, b) => a.localeCompare(b));

    const handleInstallClick = async () => {
        setServerError(null);
        setIsCheckingServers(true);
        setServerAvailable(false);
        setServerCheckComplete(false);
        setServerVersions([]);

        if ((modpack.serverSide || '').toLowerCase() === 'unsupported') {
            setServerError('This modpack is client-only. No server packs available.');
            setIsCheckingServers(false);
            setServerCheckComplete(true);
            setShowServerPanel(true);
            setServerVersions([]);
            return;
        }
        try {
            const resp = await fetchServerFiles(modpack.id);
            const mapped: ServerVersionOption[] = (resp.versions || []).map((v: ServerVersion) => {
                const id = v.id || v.version_number || v.date_published;
                return {
                    id,
                    versionNumber: v.version_number,
                    gameVersions: v.game_versions,
                    loaders: v.loaders,
                    datePublished: v.date_published,
                    serverSupported: v.server_supported !== false && (v.files || []).length > 0,
                };
            });

            setServerVersions(mapped);
            setShowServerPanel(true);
            setPanelStep('version');
            const firstSupported = mapped.find((m) => m.serverSupported);
            setSelectedVersionId(firstSupported?.id);
            setNewServerName(`${modpack.title} Server`);
            setNewServerPort(25565);

            const hasServers = Boolean(resp.available && mapped.some((m) => m.serverSupported));
            setServerAvailable(hasServers);
            if (!hasServers) {
                setServerError('No server-ready files found for this modpack yet.');
                setSelectedVersionId(undefined);
            }
        } catch (err: any) {
            setServerError(err?.message || 'Failed to check server files.');
        } finally {
            setIsCheckingServers(false);
            setServerCheckComplete(true);
        }
    };

    const selectedVersion = useMemo(
        () => serverVersions.find((v) => v.id === selectedVersionId),
        [serverVersions, selectedVersionId]
    );

    useEffect(() => {
        setServerVersions([]);
        setServerError(null);
        setServerAvailable(false);
        setServerCheckComplete(false);
        setShowServerPanel(false);
    }, [modpack.id]);

    useEffect(() => {
        if (!selectedServerId && servers.length > 0) {
            setSelectedServerId(servers[0].id);
        }
    }, [servers, selectedServerId]);

    useEffect(() => {
        setNewServerPort(25565 + servers.length);
    }, [servers.length]);

    return (
        <div className="h-full min-h-0 flex flex-col gap-6 animate-[fadeIn_0.3s_ease-out] overflow-y-auto pb-10">
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-text-muted hover:text-white border border-white/10 transition-colors"
                >
                    <ArrowLeft size={18} />
                </button>
                <div className="text-sm text-text-dim">Back to Modpacks</div>
            </div>

            <div className="glass-panel rounded-2xl overflow-hidden border border-border-main/60 shadow-2xl">
                <div className="h-64 bg-bg-surface relative">
                    <img src={modpack.imageUrl} alt={modpack.title} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                    <div className="absolute bottom-4 left-6 right-6 flex items-center justify-between">
                        <div>
                            <div className="text-xs uppercase tracking-wider text-text-muted mb-1">Modrinth Pack</div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                {modpack.title}
                                {modpack.serverSide ? (
                                    (modpack.serverSide || '').toLowerCase() === 'unsupported' ? (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-500/10 text-red-300 border border-red-500/30 text-[11px] uppercase tracking-wide">
                                            <X size={12} /> Client only
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 text-[11px] uppercase tracking-wide">
                                            <CheckCircle2 size={12} /> Server Exist
                                        </span>
                                    )
                                ) : null}
                            </h1>
                            <div className="text-sm text-text-muted">by {modpack.author}</div>
                        </div>
                        <div className="flex items-center gap-3">
                            {loading && <span className="text-text-dim text-xs">Loading…</span>}
                            {serverCheckComplete && (
                                <span
                                    className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                                        serverAvailable
                                            ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                                            : 'text-red-300 border-red-500/40 bg-red-500/10'
                                    }`}
                                >
                                    {serverAvailable ? 'Server Exist' : 'No server pack'}
                                </span>
                            )}
                            <button
                                onClick={handleInstallClick}
                                disabled={isCheckingServers}
                                className="px-4 py-2 rounded-xl bg-primary text-white font-semibold flex items-center gap-2 shadow-glow shadow-primary/30 hover:bg-primary/90 transition-colors disabled:opacity-60"
                            >
                                <Download size={18} /> {isCheckingServers ? 'Checking...' : 'Install'}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div className="flex flex-wrap gap-2">
                        {isMultiLoader
                            ? loaders.map((loader) => (
                                  <span
                                      key={`loader-${loader}`}
                                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary uppercase tracking-wider"
                                  >
                                      <Sparkles size={12} /> {loader}
                                  </span>
                              ))
                            : primaryLoaderBase && (
                                  <span
                                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary uppercase tracking-wider"
                                  >
                                      <Sparkles size={12} /> {primaryLoaderBase}
                                  </span>
                              )}
                        {latestVersion && (
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs text-primary uppercase tracking-wider">
                                <Tag size={12} /> {latestVersion}
                            </span>
                        )}
                        {categoryBadges.slice(0, 20).map((cat) => (
                            <span
                                key={cat}
                                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-text-muted uppercase tracking-wider"
                            >
                                <Tag size={12} /> {cat}
                            </span>
                        ))}
                    </div>

                    {error && (
                        <div className="text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                            {error}
                        </div>
                    )}

                    {serverError && (
                        <div className="text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
                            <X size={16} />
                            <span>{serverError}</span>
                        </div>
                    )}

                    <div className="border border-white/5 rounded-xl p-4 bg-bg-surface/60">
                        <div className="text-xs uppercase tracking-wider text-text-dim mb-3">Description</div>
                        <div className="prose prose-invert max-w-none text-text-muted text-[15px] leading-relaxed markdown-body">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
                            >
                                {modpack.longDescription || modpack.description}
                            </ReactMarkdown>
                        </div>
                    </div>

                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10">
                        <Download size={16} className="text-accent" />
                        <div>
                            <div className="text-xs uppercase tracking-wider text-text-dim">Downloads</div>
                            <div className="text-sm text-white">{modpack.downloads}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10">
                        <Users size={16} className="text-accent" />
                        <div>
                            <div className="text-xs uppercase tracking-wider text-text-dim">Followers</div>
                            <div className="text-sm text-white">{modpack.followers || 'N/A'}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/10">
                        <Clock size={16} className="text-accent" />
                        <div>
                            <div className="text-xs uppercase tracking-wider text-text-dim">Last Updated</div>
                            <div className="text-sm text-white">{formatUpdated(modpack.updatedAt)}</div>
                        </div>
                    </div>
                </div>
            </div>

            {showServerPanel && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 px-4">
                    <div className="bg-bg-surface border border-border-main rounded-2xl shadow-2xl w-full max-w-xl p-6 relative">
                        <button
                            className="absolute top-3 right-3 text-text-muted hover:text-white transition-colors"
                            onClick={() => setShowServerPanel(false)}
                        >
                            <X size={18} />
                        </button>
                        <div className="text-lg font-semibold text-white flex items-center gap-2 mb-2">
                            <ServerIcon size={18} /> Install Server
                        </div>
                        <p className="text-text-muted text-sm mb-4">
                            Choose a server build version to prepare installation. (Install flow coming next.)
                        </p>
                        {serverCheckComplete && (
                            <div
                                className={`flex items-center gap-2 mb-3 text-sm ${
                                    serverAvailable ? 'text-emerald-400' : 'text-red-400'
                                }`}
                            >
                                {serverAvailable ? <CheckCircle2 size={16} /> : <X size={16} />}
                                <span>
                                    {serverAvailable
                                        ? 'Server pack detected. You can continue.'
                                        : 'No server pack available for this modpack/version.'}
                                </span>
                            </div>
                        )}

                        {isCheckingServers && (
                            <div className="text-text-dim text-sm">Checking available server files...</div>
                        )}

                        {!isCheckingServers && serverVersions.length === 0 && (
                            <div className="text-red-300 text-sm flex items-center gap-2">
                                <X size={14} />
                                No server-ready files found for this modpack.
                            </div>
                        )}

                        {!isCheckingServers && serverVersions.length > 0 && panelStep === 'version' && (
                            <div className="space-y-3">
                                <label className="text-xs uppercase tracking-wide text-text-dim">Select version</label>
                                <div className="max-h-52 overflow-auto space-y-2 pr-1">
                                    {serverVersions.map((ver) => {
                                        const isActive = ver.id === selectedVersionId;
                                        const supported = ver.serverSupported !== false;
                                        return (
                                            <button
                                                key={ver.id || ver.versionNumber}
                                                onClick={() => supported && setSelectedVersionId(ver.id)}
                                                className={`w-full text-left rounded-xl border px-3 py-2 transition-all ${
                                                    isActive
                                                        ? 'border-primary/60 bg-primary/10 shadow-[0_6px_20px_rgba(127,90,240,0.25)]'
                                                        : supported
                                                        ? 'border-border-main bg-bg-surface/70 hover:border-primary/40 hover:bg-primary/5'
                                                        : 'border-border-main bg-bg-surface/50 cursor-not-allowed opacity-60'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="text-white font-semibold">
                                                        {ver.versionNumber || 'Unknown version'}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                    {supported ? (
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                                            Server Exist
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">
                                                            Client only
                                                        </span>
                                                    )}
                                                    {isActive && supported && (
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
                                                            Selected
                                                        </span>
                                                    )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between text-[11px] text-text-dim mt-1 gap-2 flex-wrap">
                                                    <span className="text-text-muted">
                                                        {(ver.loaders || []).join(', ') || 'No loaders'}
                                                    </span>
                                                    <div className="flex items-center gap-2">
                                                        <span>
                                                            {(ver.gameVersions || []).join(', ') || 'No game versions'}
                                                        </span>
                                                        <span className="flex items-center gap-1 text-emerald-400">
                                                            <CheckCircle2 size={12} />
                                                            Server pack
                                                        </span>
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {!isCheckingServers && panelStep === 'server' && (
                            <div className="space-y-3">
                                <label className="text-xs uppercase tracking-wide text-text-dim">Choose server</label>
                                {servers.length === 0 ? (
                                    <div className="rounded-xl border border-border-main bg-bg-surface/70 p-4 space-y-3">
                                        <div className="text-text-muted text-sm">
                                            No servers yet. Provide a name and port to create one for this modpack.
                                        </div>
                                        <div className="space-y-2">
                                            <label className="block text-xs text-text-dim">Server name</label>
                                            <input
                                                type="text"
                                                value={newServerName}
                                                onChange={(e) => setNewServerName(e.target.value)}
                                                className="w-full rounded-lg bg-bg-surface/80 border border-border-main px-3 py-2 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="block text-xs text-text-dim">Port</label>
                                            <input
                                                type="number"
                                                value={newServerPort}
                                                onChange={(e) => setNewServerPort(parseInt(e.target.value, 10) || 25565)}
                                                className="w-full rounded-lg bg-bg-surface/80 border border-border-main px-3 py-2 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-2 max-h-52 overflow-auto pr-1">
                                        {servers.map((srv) => (
                                            <button
                                                key={srv.id}
                                                onClick={() => setSelectedServerId(srv.id)}
                                                className={`w-full text-left rounded-xl border px-3 py-2 transition-all ${
                                                    selectedServerId === srv.id
                                                        ? 'border-primary/60 bg-primary/10'
                                                        : 'border-border-main bg-bg-surface/70 hover:border-primary/30'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <div className="text-white font-semibold">{srv.name}</div>
                                                        <div className="text-[11px] text-text-dim">
                                                            {srv.type} • {srv.version} • port {srv.port}
                                                        </div>
                                                    </div>
                                                    {selectedServerId === srv.id && (
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
                                                            Selected
                                                        </span>
                                                    )}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="mt-5 flex justify-end gap-2">
                            {panelStep === 'server' && (
                                <button
                                    className="px-4 py-2 rounded-lg border border-border-main text-text-muted hover:text-white hover:border-white/40 transition-colors"
                                    onClick={() => setPanelStep('version')}
                                >
                                    Back
                                </button>
                            )}
                            {panelStep === 'version' && (
                                <button
                                    disabled={
                                        !selectedVersionId ||
                                        isCheckingServers ||
                                        !serverAvailable ||
                                        !serverVersions.find((v) => v.id === selectedVersionId && v.serverSupported !== false)
                                    }
                                    className="px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
                                    onClick={() => {
                                        setPanelStep('server');
                                        if (servers.length > 0 && !selectedServerId) {
                                            setSelectedServerId(servers[0].id);
                                        }
                                    }}
                                >
                                    Continue
                                </button>
                            )}
                            <button
                                className="px-4 py-2 rounded-lg border border-border-main text-text-muted hover:text-white hover:border-white/40 transition-colors"
                                onClick={() => setShowServerPanel(false)}
                            >
                                Cancel
                            </button>
                            {panelStep === 'server' && (
                                <>
                                    {servers.length === 0 ? (
                                        <button
                                            className="px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
                                            disabled={
                                                !selectedVersionId ||
                                                !newServerName ||
                                                !serverAvailable ||
                                                !serverVersions.find((v) => v.id === selectedVersionId && v.serverSupported !== false)
                                            }
                                            onClick={() => {
                                                setShowServerPanel(false);
                                                onInstall?.(modpack, {
                                                    versionId: selectedVersionId,
                                                    versionNumber: selectedVersion?.versionNumber,
                                                    loaders: selectedVersion?.loaders,
                                                    createNew: true,
                                                    serverName: newServerName,
                                                    serverPort: newServerPort,
                                                });
                                            }}
                                        >
                                            Create server and continue
                                        </button>
                                    ) : (
                                        <button
                                            disabled={
                                                !selectedServerId ||
                                                !selectedVersionId ||
                                                !serverAvailable ||
                                                !serverVersions.find((v) => v.id === selectedVersionId && v.serverSupported !== false)
                                            }
                                            className="px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
                                            onClick={() => {
                                                setShowServerPanel(false);
                                                onInstall?.(modpack, {
                                                    versionId: selectedVersionId,
                                                    serverId: selectedServerId,
                                                    versionNumber: selectedVersion?.versionNumber,
                                                    loaders: selectedVersion?.loaders,
                                                });
                                            }}
                                        >
                                            Use selected server
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ModpackDetail;
