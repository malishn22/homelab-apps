import React, { useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import ModpackBrowser from './components/ModpackBrowser';
import ModpackDetail from './components/ModpackDetail';
import ServerConsole from './components/ServerConsole';
import ServerList from './components/ServerList';
import ServerFileBrowser from './components/ServerFileBrowser';
import ServerFileEditor from './components/ServerFileEditor';
import SettingsServerDefaults from './components/SettingsServerDefaults';
import SettingsWhitelistDefaults from './components/SettingsWhitelistDefaults';
import SettingsOpsDefaults from './components/SettingsOpsDefaults';
import { LogLevel, View } from './types';
import type { InstallRequestOptions, Modpack, Server, ServerStats } from './types';
import type { DashboardTab } from './types';
import { Bell, ChevronLeft, HelpCircle, Loader2 } from 'lucide-react';
import { getModpackDetail } from './api/modpacks';
import { useServers, useServerLogsAndStats } from './hooks/useServers';

type NotificationItem = {
    id: string;
    message: string;
    time: string;
};

const App: React.FC = () => {
    const [currentView, setCurrentView] = useState<View>(View.SERVERS);
    const [serversViewMode, setServersViewMode] = useState<'list' | 'detail'>('list');
    const [detailTab, setDetailTab] = useState<DashboardTab>('console');
    const [filesBrowserPath, setFilesBrowserPath] = useState('');
    const [filesSelectedPath, setFilesSelectedPath] = useState<string | null>(null);
    const [selectedModpack, setSelectedModpack] = useState<Modpack | null>(null);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [notifications, setNotifications] = useState<NotificationItem[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showNotifications, setShowNotifications] = useState(false);
    const [sidebarExpanded, setSidebarExpanded] = useState(true);
    const notificationsRef = useRef<HTMLDivElement | null>(null);

    const {
        servers,
        setServers,
        detailServerId,
        setDetailServerId,
        isInitialLoading,
        mapInstanceToServer,
        uniqueServerName,
        updateServer: updateServerList,
        apiCreateServer,
        apiDeleteServer,
    } = useServers();

    const {
        serverLogs,
        serverStats,
        appendLog,
        ensureServerStats,
        startServer,
        stopServer,
        restartServer,
        sendCommand,
        setServerStats,
        clearServerData,
    } = useServerLogsAndStats(detailServerId, servers, setServers);

    const handleServerSelect = (serverId: string, tab?: 'console' | 'files') => {
        setDetailServerId(serverId);
        setCurrentView(View.SERVERS);
        setServersViewMode('detail');
        setDetailTab(tab ?? 'console');
        const selected = servers.find((s) => s.id === serverId);
        if (selected) ensureServerStats(selected);
    };

    const handleFilesServerChange = (serverId: string) => {
        setDetailServerId(serverId || null);
        setFilesBrowserPath('');
        setFilesSelectedPath(null);
    };

    useEffect(() => {
        servers.forEach(ensureServerStats);
    }, [servers, ensureServerStats]);

    useEffect(() => {
        if (serversViewMode === 'detail' && detailServerId && !servers.some((s) => s.id === detailServerId)) {
            setServersViewMode('list');
            setDetailServerId(null);
        }
    }, [serversViewMode, detailServerId, servers]);


    useEffect(() => {
        if (!showNotifications) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
                setShowNotifications(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showNotifications]);

    const addNotifications = (messages: string[]) => {
        if (!messages.length) return;
        const now = new Date().toLocaleTimeString();
        setNotifications((prev) => [
            ...messages.map((msg, idx) => ({ id: `${Date.now()}-${idx}`, message: msg, time: now })),
            ...prev,
        ]);
        setUnreadCount((count) => count + messages.length);
    };

    const handleInstallRequest = async (modpack: Modpack, options?: InstallRequestOptions) => {
        const versionLabel = options?.versionNumber || modpack.updatedAt || 'latest';
        const loaderLabel = options?.loaders?.[0] || modpack.loaders?.[0] || 'Unknown';
        const sourceLabel = modpack.source || 'modrinth';
        const baseName = options?.serverName || `${modpack.title} Server`;
        const versionId = options?.versionId;

        if (!versionId) {
            addNotifications([`Cannot install ${modpack.title}: missing version selection.`]);
            return;
        }

        try {
            const nextPort = options?.serverPort ?? 25565 + servers.length;
            const name = uniqueServerName(baseName);
            const created = await apiCreateServer({
                name,
                project_id: modpack.id,
                version_id: versionId,
                version_number: versionLabel,
                loader: loaderLabel,
                source: sourceLabel,
                port: nextPort,
                ram_mb: options?.ramMB ?? 4096,
            });

            const mapped = mapInstanceToServer(created);
            const serverWithPreparing: Server = { ...mapped, status: 'PREPARING' };
            setServers((prev) => [...prev, serverWithPreparing]);
            ensureServerStats(serverWithPreparing);
            addNotifications([`Created server "${serverWithPreparing.name}" for ${modpack.title}.`]);
            setDetailServerId(serverWithPreparing.id);
            setCurrentView(View.SERVERS);
            setServersViewMode('detail');
            setDetailTab('console');
            appendLog(serverWithPreparing.id, 'Server created. Preparing (downloading mods)...', LogLevel.INFO);
        } catch (err: unknown) {
            addNotifications([`Failed to create server: ${err instanceof Error ? err.message : err}`]);
        }
    };

    const updateServer = (serverId: string, updates: Partial<Server>) => {
        updateServerList(serverId, updates);
        if (updates.ramLimit !== undefined || updates.status !== undefined) {
            setServerStats((prev) => {
                const current = prev[serverId];
                if (!current) return prev;
                return {
                    ...prev,
                    [serverId]: {
                        ...current,
                        ramTotal: updates.ramLimit ?? current.ramTotal,
                        ramUsage:
                            updates.ramLimit !== undefined
                                ? Math.min(current.ramUsage, updates.ramLimit)
                                : current.ramUsage,
                        status: (updates.status as ServerStats['status']) ?? current.status,
                    },
                };
            });
        }
    };

    const deleteServerInstance = (serverId: string) => {
        const server = servers.find((s) => s.id === serverId);
        clearServerData(serverId);
        setServers((prev) => prev.filter((s) => s.id !== serverId));
        if (detailServerId === serverId) {
            setDetailServerId(null);
            setServersViewMode('list');
        }
        addNotifications([`Deleted server "${server?.name ?? serverId}".`]);
        apiDeleteServer(serverId).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            addNotifications([`Backend delete failed for "${server?.name ?? serverId}": ${msg}`]);
        });
    };

    const renderView = () => {
        switch (currentView) {
            case View.SERVERS:
                if (serversViewMode === 'list') {
                    return (
                        <ServerList
                            servers={servers}
                            statsById={serverStats}
                            onSelectServer={handleServerSelect}
                            onCreateServer={() => {
                                setCurrentView(View.MODPACKS);
                                addNotifications(['Select a modpack to create a new server instance.']);
                            }}
                            onUpdateServer={updateServer}
                            onStartServer={startServer}
                            onStopServer={stopServer}
                            onDeleteServer={deleteServerInstance}
                        />
                    );
                }
                const detailServer = servers.find((s) => s.id === detailServerId) ?? null;
                if (!detailServer) {
                    return (
                        <div className="flex flex-col items-center justify-center h-full text-text-muted gap-4">
                            <p className="text-sm">Server not found.</p>
                            <button
                                onClick={() => {
                                    setDetailServerId(null);
                                    setServersViewMode('list');
                                }}
                                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white transition-colors"
                            >
                                Back to servers
                            </button>
                        </div>
                    );
                }
                return (
                    <div className="flex flex-col h-full">
                        <div className="flex items-center gap-4 mb-2">
                            <button
                                onClick={() => {
                                    setDetailServerId(null);
                                    setServersViewMode('list');
                                }}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg text-text-muted hover:text-white hover:bg-white/5 transition-colors text-sm"
                            >
                                <ChevronLeft size={18} />
                                Back to servers
                            </button>
                        </div>
                        <div className="flex gap-2 mb-2">
                            <div className="flex rounded-lg border border-white/5 overflow-hidden bg-white/5">
                                <button
                                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                                        detailTab === 'console'
                                            ? 'bg-white/10 text-white'
                                            : 'text-text-muted hover:text-white'
                                    }`}
                                    onClick={() => setDetailTab('console')}
                                >
                                    Console
                                </button>
                                <button
                                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                                        detailTab === 'files'
                                            ? 'bg-white/10 text-white'
                                            : 'text-text-muted hover:text-white'
                                    }`}
                                    onClick={() => setDetailTab('files')}
                                >
                                    Files
                                </button>
                            </div>
                            {detailTab === 'files' && servers.length > 1 && (
                                <select
                                    className="px-3 py-2 rounded-lg bg-bg-surface border border-white/5 text-white text-sm focus:outline-none focus:border-primary"
                                    value={detailServerId ?? ''}
                                    onChange={(e) => handleFilesServerChange(e.target.value)}
                                >
                                    {servers.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {s.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>
                        {detailTab === 'console' ? (
                            <ServerConsole
                                server={detailServer}
                                logs={serverLogs[detailServer.id] ?? []}
                                stats={serverStats[detailServer.id]}
                                onStart={() => startServer(detailServer.id)}
                                onStop={() => stopServer(detailServer.id)}
                                onRestart={() => restartServer(detailServer.id)}
                                onSendCommand={(cmd) => sendCommand(detailServer.id, cmd)}
                            />
                        ) : (
                            <div className="flex flex-1 min-h-0 gap-4">
                                <div className="w-64 shrink-0 rounded-xl border border-white/5 bg-bg-surface/50 overflow-hidden">
                                    <ServerFileBrowser
                                        instanceId={detailServerId}
                                        currentPath={filesBrowserPath}
                                        onPathChange={setFilesBrowserPath}
                                        onSelectFile={setFilesSelectedPath}
                                        onFileDeleted={(path) => {
                                            if (
                                                filesSelectedPath === path ||
                                                (filesSelectedPath && filesSelectedPath.startsWith(path + '/'))
                                            ) {
                                                setFilesSelectedPath(null);
                                            }
                                        }}
                                    />
                                </div>
                                <div className="flex-1 min-w-0 rounded-xl border border-white/5 bg-bg-surface/50 overflow-hidden">
                                    <ServerFileEditor
                                        instanceId={detailServerId}
                                        filePath={filesSelectedPath}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                );
            case View.MODPACKS:
                return (
                    <div className="relative h-full min-h-0">
                        <div className={`h-full ${selectedModpack ? 'hidden' : ''}`}>
                            <ModpackBrowser
                                onAddNotifications={addNotifications}
                                onSelect={async (modpack) => {
                            setSelectedModpack(modpack);
                            setDetailError(null);
                            setIsLoadingDetail(true);
                            if (modpack.source && modpack.source !== 'modrinth') {
                                setIsLoadingDetail(false);
                                return;
                            }
                            try {
                                const data = await getModpackDetail(modpack.id);
                                const uniqLower = (arr: (string | undefined)[] | undefined) => {
                                    const seen = new Set<string>();
                                    return (arr ?? []).filter((item) => {
                                        if (!item) return false;
                                        const key = item.toLowerCase();
                                        if (seen.has(key)) return false;
                                        seen.add(key);
                                        return true;
                                    });
                                };
                                const mergedCategories = uniqLower([
                                    ...(Array.isArray(data.categories) ? data.categories : []),
                                    ...(modpack.categories ?? []),
                                ]).sort((a, b) => a.localeCompare(b));
                                const mergedLoaders = uniqLower([
                                    ...(Array.isArray(data.loaders) ? data.loaders : []),
                                    ...(modpack.loaders ?? []),
                                ]).sort((a, b) => a.localeCompare(b));
                                const mergedGameVersions = uniqLower([
                                    ...(Array.isArray(data.game_versions) ? data.game_versions : []),
                                    ...(modpack.gameVersions ?? []),
                                ]);
                                setSelectedModpack({
                                    ...modpack,
                                    slug: (data.slug as string) ?? modpack.slug,
                                    longDescription:
                                        (data.body as string) ?? (data.description as string) ?? modpack.description,
                                    categories: mergedCategories,
                                    loaders: mergedLoaders,
                                    gameVersions: mergedGameVersions,
                                    imageUrl: (data.icon_url as string) ?? modpack.imageUrl,
                                    followers:
                                        typeof data.followers === 'number'
                                            ? data.followers.toLocaleString()
                                            : modpack.followers,
                                    updatedAt:
                                        (data.updated as string) ??
                                        (data.date_modified as string) ??
                                        modpack.updatedAt,
                                    serverSide: (data.server_side as string) ?? modpack.serverSide,
                                });
                            } catch (err: unknown) {
                                setDetailError(err instanceof Error ? err.message : 'Failed to load details.');
                            } finally {
                                setIsLoadingDetail(false);
                            }
                        }}
                            />
                        </div>
                        {selectedModpack && (
                            <div className="absolute inset-0 z-10 overflow-auto">
                                <ModpackDetail
                                    modpack={selectedModpack}
                                loading={isLoadingDetail}
                                error={detailError}
                                servers={servers}
                                onBack={() => {
                                    setSelectedModpack(null);
                                    setDetailError(null);
                                }}
                                onInstall={handleInstallRequest}
                                />
                            </div>
                        )}
                    </div>
                );
            case View.SETTINGS:
                return (
                    <div className="flex flex-col items-center gap-12 h-full text-text-muted animate-[fadeIn_0.5s_ease-out] pt-4 pb-12">
                        <SettingsServerDefaults />
                        <SettingsWhitelistDefaults />
                        <SettingsOpsDefaults />
                    </div>
                );
            default:
                return <ModpackBrowser />;
        }
    };

    return (
        <div className="flex h-screen w-full font-sans overflow-hidden">
            <Sidebar
                currentView={currentView}
                onChangeView={setCurrentView}
                expanded={sidebarExpanded}
                onToggle={() => setSidebarExpanded(!sidebarExpanded)}
            />
            <main
                className={`flex-1 flex flex-col min-w-0 overflow-hidden relative z-0 transition-[margin] duration-300 ${
                    sidebarExpanded ? 'ml-64' : 'ml-16'
                }`}
            >
                <header className="h-20 flex items-center justify-between px-8 shrink-0 z-10">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                        <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                        <span className="text-xs font-semibold text-emerald-400 tracking-wide uppercase">
                            System Operational
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="relative" ref={notificationsRef}>
                            <button
                                className="p-2 text-text-muted hover:text-white hover:bg-white/5 rounded-full transition-all relative"
                                onClick={() => {
                                    setShowNotifications((n) => !n);
                                    if (!showNotifications) setUnreadCount(0);
                                }}
                                onMouseEnter={() => showNotifications && setUnreadCount(0)}
                            >
                                <Bell size={20} />
                                {unreadCount > 0 && (
                                    <span className="absolute -top-1 -right-1 bg-accent text-[10px] text-white rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 border border-bg-body">
                                        {unreadCount}
                                    </span>
                                )}
                            </button>
                            {showNotifications && (
                                <div
                                    className="absolute right-0 mt-2 w-72 bg-bg-surface border border-border-main rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.35)] overflow-hidden z-20"
                                    onMouseEnter={() => setUnreadCount(0)}
                                >
                                    <div className="px-4 py-2 border-b border-border-main/80 text-xs text-text-dim uppercase tracking-wide">
                                        Notifications
                                    </div>
                                    <div className="max-h-64 overflow-auto">
                                        {notifications.length === 0 ? (
                                            <div className="px-4 py-4 text-text-muted text-sm">No updates yet.</div>
                                        ) : (
                                            notifications.map((n) => (
                                                <div
                                                    key={n.id}
                                                    className="px-4 py-3 border-b border-border-main/60 last:border-b-0 hover:bg-white/5 transition-colors"
                                                >
                                                    <div className="text-sm text-white">{n.message}</div>
                                                    <div className="text-[11px] text-text-dim">{n.time}</div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        <button className="p-2 text-text-muted hover:text-white hover:bg-white/5 rounded-full transition-all">
                            <HelpCircle size={20} />
                        </button>
                    </div>
                </header>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
                    {isInitialLoading ? (
                        <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 md:p-8 bg-bg-body/50">
                            <Loader2 className="w-14 h-14 text-primary animate-spin mb-5" strokeWidth={2} />
                            <p className="text-lg font-medium text-white mb-1">Loading dashboard</p>
                            <p className="text-sm text-text-muted">Fetching your servers and data…</p>
                        </div>
                    ) : (
                        <div className="flex-1 min-h-0 overflow-auto pt-4 px-6 pb-6 md:pt-4 md:px-8 md:pb-8">{renderView()}</div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default App;
