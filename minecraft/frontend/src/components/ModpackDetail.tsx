import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Modpack, ModpackSource, ServerVersionOption, Server, InstallRequestOptions } from '../types';
import { ArrowLeft, Download, Package, Tag, Server as ServerIcon, Users, Sparkles, Clock, MemoryStick, Plus, X } from 'lucide-react';
import RamSlider from './RamSlider';
import ServerStatusBadge from './ServerStatusBadge';
import ModpackProviderBadge from './ModpackProviderBadge';
import { fetchServerFiles, ServerVersion } from '../api/modpacks';
import { Button, Input, NumberInput, TagBadge, StatBadge } from './ui';
import { isGameVersion, compareVersionsDesc, formatUpdated } from '../utils';

interface ModpackDetailProps {
    modpack: Modpack;
    serverStatusCache: Record<string, 'required' | 'unsupported'>;
    onServerStatusUpdate: (updates: Record<string, 'required' | 'unsupported'>) => void;
    onBack: () => void;
    onInstall?: (modpack: Modpack, options?: InstallRequestOptions) => void;
    servers?: Server[];
    loading?: boolean;
    error?: string | null;
}

const getVersionStage = (value?: string): string | null => {
    if (!value) return null;
    const text = value.toLowerCase();
    if (text.includes('alpha')) return 'alpha';
    if (text.includes('beta')) return 'beta';
    if (text.includes('rc') || text.includes('release candidate')) return 'rc';
    if (text.includes('pre') || text.includes('preview') || text.includes('snapshot')) return 'preview';
    if (text.includes('release')) return 'release';
    return null;
};

const VERSION_STAGE_BADGES: Record<string, { label: string; className: string }> = {
    release: {
        label: 'Release',
        className: 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200',
    },
    beta: {
        label: 'Beta',
        className: 'bg-amber-500/15 border-amber-400/40 text-amber-200',
    },
    alpha: {
        label: 'Alpha',
        className: 'bg-rose-500/15 border-rose-400/40 text-rose-200',
    },
    rc: {
        label: 'RC',
        className: 'bg-sky-500/15 border-sky-400/40 text-sky-200',
    },
    preview: {
        label: 'Preview',
        className: 'bg-indigo-500/15 border-indigo-400/40 text-indigo-200',
    },
};

const ModpackDetail: React.FC<ModpackDetailProps> = ({
    modpack,
    serverStatusCache,
    onServerStatusUpdate,
    onBack,
    onInstall,
    loading,
    error,
    servers = [],
}) => {
    const sourceKey = (modpack.source || 'modrinth') as ModpackSource;
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
    const [ramMB, setRamMB] = useState<number>(4096);
    const [isCreatingNew, setIsCreatingNew] = useState(false);

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

        const sourceKey = (modpack.source || 'modrinth') as ModpackSource;
        const isCurseforge = sourceKey === 'curseforge';
        if (!isCurseforge && (modpack.serverSide || '').toLowerCase() === 'unsupported') {
            onServerStatusUpdate({ [modpack.id]: 'unsupported' });
            setServerError('This modpack is client-only. No server packs available.');
            setIsCheckingServers(false);
            setServerCheckComplete(true);
            setShowServerPanel(true);
            setServerVersions([]);
            return;
        }
        try {
            const forceRefresh = sourceKey === 'curseforge';
            const resp = await fetchServerFiles(modpack.id, sourceKey, forceRefresh);
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
            onServerStatusUpdate({ [modpack.id]: hasServers ? 'required' : 'unsupported' });
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
        <div className="min-h-full flex flex-col gap-6 animate-[fadeIn_0.3s_ease-out] pb-10">
            <div className="flex items-center gap-3">
                <Button
                    variant="ghost"
                    icon={<ArrowLeft size={18} />}
                    onClick={onBack}
                    className="rounded-full p-2 border border-white/10"
                />
                <div className="text-sm text-text-dim">Back to Modpacks</div>
            </div>

            <div className="glass-panel rounded-2xl overflow-hidden border border-border-main/60 shadow-2xl">
                <div className="h-64 bg-bg-surface relative">
                    <img src={modpack.imageUrl} alt={modpack.title} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                    <div className="absolute bottom-4 left-6 right-6 flex items-center justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <ModpackProviderBadge provider={sourceKey} size={16} className="w-8 h-8" />
                            </div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                {modpack.title}
                                {(() => {
                                    const cached = serverStatusCache[modpack.id];
                                    const effective =
                                        cached ??
                                        (serverCheckComplete
                                            ? serverAvailable
                                                ? 'required'
                                                : 'unsupported'
                                            : (modpack.serverSide || 'pending').toLowerCase());
                                    if (effective === 'pending') {
                                        return <ServerStatusBadge status="pending" size={12} />;
                                    }
                                    if (effective === 'unsupported') {
                                        return <ServerStatusBadge status="client" size={12} />;
                                    }
                                    return <ServerStatusBadge status="server" size={12} />;
                                })()}
                            </h1>
                            <div className="text-sm text-text-muted">by {modpack.author}</div>
                        </div>
                        <div className="flex items-center gap-3">
                            {loading && <span className="text-text-dim text-xs">Loading…</span>}
                            {serverAvailable && <ServerStatusBadge status="server" size={12} />}
                            {!serverAvailable && serverCheckComplete && (
                                <ServerStatusBadge status="client" size={12} />
                            )}
                            <Button
                                variant="primary"
                                icon={<Download size={18} />}
                                loading={isCheckingServers}
                                onClick={handleInstallClick}
                                disabled={isCheckingServers}
                                className="rounded-xl shadow-glow shadow-primary/30"
                            >
                                {isCheckingServers ? 'Checking...' : 'Install'}
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div className="flex flex-wrap gap-2">
                        {isMultiLoader
                            ? loaders.map((loader) => (
                                <TagBadge key={`loader-${loader}`} variant="primary" icon={<Sparkles size={12} />}>
                                    {loader}
                                </TagBadge>
                            ))
                            : primaryLoaderBase && (
                                <TagBadge variant="primary" icon={<Sparkles size={12} />}>
                                    {primaryLoaderBase}
                                </TagBadge>
                            )}
                        {latestVersion && (
                            <TagBadge variant="primary" icon={<Tag size={12} />}>
                                {latestVersion}
                            </TagBadge>
                        )}
                        {categoryBadges.slice(0, 20).map((cat) => (
                            <TagBadge key={cat} variant="muted" icon={<Tag size={12} />}>
                                {cat}
                            </TagBadge>
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

                    <div className="flex flex-wrap gap-3">
                        <StatBadge label="Downloads" value={modpack.downloads} icon={<Download size={14} />} />
                        <StatBadge label="Followers" value={modpack.followers || 'N/A'} icon={<Users size={14} />} />
                        <StatBadge label="Last Updated" value={formatUpdated(modpack.updatedAt)} icon={<Clock size={14} />} />
                    </div>

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
            </div>

            {showServerPanel && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 px-4">
                    <div className="bg-bg-surface border border-border-main rounded-2xl shadow-2xl w-[92vw] max-w-3xl max-h-[85vh] p-6 relative flex flex-col overflow-hidden">
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
                        <div className="flex-1 min-h-0 flex flex-col gap-3">
                            {serverCheckComplete && !serverAvailable && (
                                <div className="flex items-center gap-2 text-sm text-red-400">
                                    <X size={16} />
                                    <span>No server pack available for this modpack/version.</span>
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
                                <div className="flex flex-col gap-3 flex-1 min-h-0">
                                    <label className="text-xs uppercase tracking-wide text-text-dim">Select version</label>
                                    <div className="flex-1 min-h-0 overflow-auto space-y-2 pr-1">
                                        {serverVersions.map((ver) => {
                                            const isActive = ver.id === selectedVersionId;
                                            const supported = ver.serverSupported !== false;
                                            const stageKey = getVersionStage(ver.versionNumber);
                                            const stageBadge = stageKey ? VERSION_STAGE_BADGES[stageKey] : null;
                                            return (
                                                <button
                                                    key={ver.id || ver.versionNumber}
                                                    onClick={() => supported && setSelectedVersionId(ver.id)}
                                                    className={`w-full text-left rounded-xl border px-3 py-2 transition-all ${isActive
                                                        ? 'border-primary/60 bg-primary/10 shadow-[0_6px_20px_rgba(127,90,240,0.25)]'
                                                        : supported
                                                            ? 'border-border-main bg-bg-surface/70 hover:border-primary/40 hover:bg-primary/5'
                                                            : 'border-border-main bg-bg-surface/50 cursor-not-allowed opacity-60'
                                                        }`}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <div className="text-white font-semibold">
                                                                {ver.versionNumber || 'Unknown version'}
                                                            </div>
                                                            {stageBadge && (
                                                                <span
                                                                    className={`text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wide ${stageBadge.className}`}
                                                                >
                                                                    {stageBadge.label}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {isActive && supported && (
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
                                                                    Selected
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center justify-between text-[11px] text-text-dim mt-1 gap-2 flex-wrap">
                                                        <span className="text-text-muted">
                                                            {(ver.loaders || []).join(', ') || 'No loaders'}
                                                        </span>
                                                        <div className="flex items-center gap-2">
                                                            <span>
                                                                {(ver.gameVersions || []).join(', ') || 'No game versions'}
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
                                <div className="flex flex-col gap-3 flex-1 min-h-0">
                                    <label className="text-xs uppercase tracking-wide text-text-dim">Choose server</label>
                                    {servers.length === 0 || isCreatingNew ? (
                                        <div className="rounded-xl border border-border-main bg-bg-surface/70 p-4 space-y-3">
                                            <div className="flex items-start justify-between">
                                                <div className="text-text-muted text-sm">
                                                    No servers yet. Provide a name and port to create one for this modpack.
                                                </div>
                                            </div>
                                            <Input
                                                label="Server name"
                                                type="text"
                                                value={newServerName}
                                                onChange={(e) => setNewServerName(e.target.value)}
                                            />
                                            <NumberInput
                                                label="Port"
                                                value={newServerPort}
                                                onChange={(e) => setNewServerPort(parseInt(e.target.value, 10) || 25565)}
                                                min={1}
                                                max={65535}
                                            />
                                            <div className="pt-4 border-t border-white/5 mt-4">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <MemoryStick size={14} className="text-primary" />
                                                    <span className="text-xs uppercase tracking-wide text-text-muted font-semibold">RAM Allocation</span>
                                                </div>
                                                <RamSlider
                                                    value={ramMB / 1024}
                                                    onChange={(gb) => setRamMB(Math.round(gb * 1024))}
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex-1 min-h-0 overflow-auto space-y-2 pr-1 flex flex-col">
                                            {servers.map((srv) => (
                                                <button
                                                    key={srv.id}
                                                    onClick={() => setSelectedServerId(srv.id)}
                                                    className={`w-full text-left rounded-xl border px-3 py-2 transition-all ${selectedServerId === srv.id
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
                                            <button
                                                onClick={() => {
                                                    setIsCreatingNew(true);
                                                    setSelectedServerId(undefined);
                                                    setNewServerName(`${modpack.title} Server ${servers.length + 1}`);
                                                    setNewServerPort(25565 + servers.length);
                                                }}
                                                className="w-full text-left rounded-xl border border-dashed border-border-main bg-white/5 hover:bg-white/10 px-3 py-3 text-text-muted hover:text-white transition-all flex items-center justify-center gap-2 group"
                                            >
                                                <div className="p-1 rounded-full bg-white/10 group-hover:bg-primary/20 transition-colors">
                                                    <Plus size={14} className="group-hover:text-primary" />
                                                </div>
                                                <span className="text-xs font-semibold uppercase tracking-wide">Create New Server Instance</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="mt-5 flex justify-end gap-2 pt-4 border-t border-white/5">
                            {panelStep === 'server' && (
                                <Button
                                    variant="secondary"
                                    onClick={() => {
                                        if (isCreatingNew && servers.length > 0) {
                                            setIsCreatingNew(false);
                                        } else {
                                            setPanelStep('version');
                                        }
                                    }}
                                >
                                    Back
                                </Button>
                            )}
                            {panelStep === 'version' && (
                                <Button
                                    variant="primary"
                                    disabled={
                                        !selectedVersionId ||
                                        isCheckingServers ||
                                        !serverAvailable ||
                                        !serverVersions.find((v) => v.id === selectedVersionId && v.serverSupported !== false)
                                    }
                                    onClick={() => {
                                        setPanelStep('server');
                                        if (servers.length > 0 && !selectedServerId) {
                                            setSelectedServerId(servers[0].id);
                                        }
                                    }}
                                >
                                    Continue
                                </Button>
                            )}
                            <Button
                                variant="secondary"
                                onClick={() => setShowServerPanel(false)}
                            >
                                Cancel
                            </Button>
                            {panelStep === 'server' && (
                                <>
                                    {servers.length === 0 || isCreatingNew ? (
                                        <Button
                                            variant="primary"
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
                                                    ramMB: ramMB,
                                                });
                                            }}
                                        >
                                            Create server and continue
                                        </Button>
                                    ) : (
                                        <Button
                                            variant="primary"
                                            disabled={
                                                !selectedServerId ||
                                                !selectedVersionId ||
                                                !serverAvailable ||
                                                !serverVersions.find((v) => v.id === selectedVersionId && v.serverSupported !== false)
                                            }
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
                                        </Button>
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
