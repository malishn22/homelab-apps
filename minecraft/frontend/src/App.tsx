import React, { useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import ModpackBrowser from './components/ModpackBrowser';
import ModpackDetail from './components/ModpackDetail';
import ServerConsole from './components/ServerConsole';
import ServerList from './components/ServerList';
import { LogLevel, View } from './types';
import type { InstallRequestOptions, Modpack, Server, ServerStats } from './types';
import { Bell, HelpCircle, Construction, Loader2 } from 'lucide-react';
import { getModpackDetail } from './api/modpacks';
import { useServers, useServerLogsAndStats } from './hooks/useServers';

type NotificationItem = {
    id: string;
    message: string;
    time: string;
};

const App: React.FC = () => {
    const [currentView, setCurrentView] = useState<View>(View.MODPACKS);
    const [selectedModpack, setSelectedModpack] = useState<Modpack | null>(null);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [notifications, setNotifications] = useState<NotificationItem[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showNotifications, setShowNotifications] = useState(false);
    const notificationsRef = useRef<HTMLDivElement | null>(null);

    const {
        servers,
        setServers,
        activeServerId,
        setActiveServerId,
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
        sendCommand,
        setServerStats,
        clearServerData,
    } = useServerLogsAndStats(activeServerId, servers, setServers);

    const handleServerSelect = (serverId: string) => {
        setActiveServerId(serverId);
        setCurrentView(View.DASHBOARD);
        const selected = servers.find((s) => s.id === serverId);
        if (selected) ensureServerStats(selected);
    };

    useEffect(() => {
        servers.forEach(ensureServerStats);
    }, [servers, ensureServerStats]);

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
                ram_mb: 4096,
            });

            const mapped = mapInstanceToServer(created);
            const serverWithPreparing: Server = { ...mapped, status: 'PREPARING' };
            setServers((prev) => [...prev, serverWithPreparing]);
            ensureServerStats(serverWithPreparing);
            addNotifications([`Created server "${serverWithPreparing.name}" for ${modpack.title}.`]);
            setActiveServerId(serverWithPreparing.id);
            setCurrentView(View.DASHBOARD);
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
        if (activeServerId === serverId) setActiveServerId(null);
        addNotifications([`Deleted server "${server?.name ?? serverId}".`]);
        apiDeleteServer(serverId).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            addNotifications([`Backend delete failed for "${server?.name ?? serverId}": ${msg}`]);
        });
    };

    const renderView = () => {
        const activeServer = servers.find((s) => s.id === activeServerId) ?? servers[0] ?? null;

        switch (currentView) {
            case View.DASHBOARD:
                return (
                    <ServerConsole
                        server={activeServer}
                        logs={activeServer ? serverLogs[activeServer.id] ?? [] : []}
                        stats={activeServer ? serverStats[activeServer.id] : undefined}
                        onStart={activeServer ? () => startServer(activeServer.id) : undefined}
                        onStop={activeServer ? () => stopServer(activeServer.id) : undefined}
                        onSendCommand={activeServer ? (cmd) => sendCommand(activeServer.id, cmd) : undefined}
                    />
                );
            case View.MODPACKS:
                return selectedModpack ? (
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
                ) : (
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
                );
            case View.SERVERS:
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
            case View.SETTINGS:
                return (
                    <div className="flex flex-col items-center justify-center h-full text-text-muted animate-[fadeIn_0.5s_ease-out]">
                        <div className="w-24 h-24 rounded-full bg-bg-surface/50 flex items-center justify-center border border-white/5 mb-6 shadow-glow shadow-accent/10">
                            <Construction size={40} className="text-accent opacity-80" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">Settings</h3>
                        <p>Configuration panel under construction.</p>
                    </div>
                );
            default:
                return <ModpackBrowser />;
        }
    };

    return (
        <div className="flex min-h-screen w-full font-sans overflow-auto">
            <div className="absolute inset-y-0 left-0 w-64 bg-bg-glass backdrop-blur-xl border-r border-white/5 z-10" />
            <Sidebar currentView={currentView} onChangeView={setCurrentView} />
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-0">
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
                        <div className="flex-1 min-h-0 overflow-auto p-6 md:p-8">{renderView()}</div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default App;
