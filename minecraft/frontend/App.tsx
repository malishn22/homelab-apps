import React, { useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import ModpackBrowser from './components/ModpackBrowser';
import ModpackDetail from './components/ModpackDetail';
import ServerConsole from './components/ServerConsole';
import ServerList from './components/ServerList';
import { LogLevel, View } from './types';
import type { InstallRequestOptions, LogEntry, Modpack, Server, ServerStats } from './types';
import { Bell, HelpCircle, Construction } from 'lucide-react';
import {
    listServers as apiListServers,
    createServer as apiCreateServer,
    startServer as apiStartServer,
    stopServer as apiStopServer,
    fetchLogs as apiFetchLogs,
    fetchStatus as apiFetchStatus,
    sendCommand as apiSendCommand,
    deleteServer as apiDeleteServer,
} from './src/api/servers';

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
    const [servers, setServers] = useState<Server[]>([]);
    const [activeServerId, setActiveServerId] = useState<string | null>(null);
    const [serverLogs, setServerLogs] = useState<Record<string, LogEntry[]>>({});
    const [serverStats, setServerStats] = useState<Record<string, ServerStats>>({});
    const logIntervalsRef = useRef<Record<string, number>>({});
    const statIntervalsRef = useRef<Record<string, number>>({});
    const startupTimersRef = useRef<Record<string, number>>({});
    const lastLogTailRef = useRef<Record<string, string | undefined>>({});
    const lastStatusRef = useRef<Record<string, Server['status'] | undefined>>({});
    const notificationsRef = useRef<HTMLDivElement | null>(null);

    const mapInstanceToServer = (instance: any): Server => ({
        id: instance.id,
        name: instance.name,
        type: instance.loader || 'Modpack',
        version: instance.version_number || 'latest',
        port: instance.port,
        status: (instance.status as Server['status']) || 'OFFLINE',
        players: 0,
        maxPlayers: 20,
        ramUsage: 0,
        ramLimit: instance.ram_gb || 4,
    });

    
    useEffect(() => {
        const bootstrap = async () => {
            try {
                const items = await apiListServers();
                const mapped = items.map(mapInstanceToServer);
                setServers(mapped);
                mapped.forEach(ensureServerStats);
            } catch (err) {
                console.error('Failed to fetch servers', err);
            }
        };
        bootstrap();
    }, []);

    const handleServerSelect = (serverId: string) => {
        setActiveServerId(serverId);
        setCurrentView(View.DASHBOARD);
        const selected = servers.find((s) => s.id === serverId);
        if (selected) ensureServerStats(selected);
    };

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

    const appendLog = (serverId: string, message: string, level: LogLevel = LogLevel.INFO) => {
        setServerLogs((prev) => {
            const now = new Date();
            const nextEntry: LogEntry = {
                id: `${serverId}-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
                timestamp: now.toLocaleTimeString(),
                level,
                message,
            };
            const existing = prev[serverId] || [];
            const merged = [...existing, nextEntry].slice(-400);
            return { ...prev, [serverId]: merged };
        });
    };

    const clearServerTimers = (serverId: string) => {
        if (logIntervalsRef.current[serverId]) {
            clearInterval(logIntervalsRef.current[serverId]);
            delete logIntervalsRef.current[serverId];
        }
        if (statIntervalsRef.current[serverId]) {
            clearInterval(statIntervalsRef.current[serverId]);
            delete statIntervalsRef.current[serverId];
        }
        if (startupTimersRef.current[serverId]) {
            clearTimeout(startupTimersRef.current[serverId]);
            delete startupTimersRef.current[serverId];
        }
    };

    const ensureServerStats = (server: Server) => {
        setServerStats((prev) => {
            if (prev[server.id]) return prev;
            return {
                ...prev,
                [server.id]: {
                    ramUsage: 0,
                    ramTotal: server.ramLimit,
                    cpuLoad: 0,
                    tps: null,
                    tickTimeMs: null,
                    status: server.status as ServerStats['status'],
                },
            };
        });
    };

    const fetchAndUpdateStatus = async (serverId: string) => {
        try {
            const data = await apiFetchStatus(serverId);
            const status = (data.status as Server['status']) || 'OFFLINE';
            const stats = data.stats ?? {};

            const prevStatus = lastStatusRef.current[serverId];
            lastStatusRef.current[serverId] = status;

            // Update server list
            setServers((prev) =>
                prev.map((srv) =>
                    srv.id === serverId
                        ? {
                              ...srv,
                              status,
                              ramUsage:
                                  typeof stats.ramUsage === 'number'
                                      ? stats.ramUsage
                                      : srv.ramUsage,
                              ramLimit: srv.ramLimit,
                          }
                        : srv
                )
            );

            // Update stats
            setServerStats((prev) => ({
                ...prev,
                [serverId]: {
                    ramUsage: stats.ramUsage ?? prev[serverId]?.ramUsage ?? 0,
                    ramTotal: stats.ramTotal ?? prev[serverId]?.ramTotal ?? 0,
                    cpuLoad: stats.cpuLoad ?? prev[serverId]?.cpuLoad ?? 0,
                    tps:
                        typeof stats.tps === 'number'
                            ? stats.tps
                            : prev[serverId]?.tps ?? null,
                    tickTimeMs:
                        typeof stats.tickTimeMs === 'number'
                            ? stats.tickTimeMs
                            : prev[serverId]?.tickTimeMs ?? null,
                    status: status as ServerStats['status'],
                },
            }));

            // If we just transitioned PREPARING -> OFFLINE, ensure there is exactly
            // one SUCCESS line in the console for this server.
            if (prevStatus === 'PREPARING' && status === 'OFFLINE') {
                setServerLogs((prev) => {
                    const existing = prev[serverId] || [];
                    const hasSuccess = existing.some((e) =>
                        e.message.toLowerCase().includes('completed. ready to start')
                    );
                    if (hasSuccess) {
                        // backend already logged success; do nothing
                        return prev;
                    }

                    const now = new Date();
                    const successEntry: LogEntry = {
                        id: `${serverId}-${now.getTime()}-${Math.random()
                            .toString(36)
                            .slice(2, 6)}`,
                        timestamp: now.toLocaleTimeString(),
                        level: LogLevel.SUCCESS,
                        message: '[SUCCESS] Completed. Ready to start.',
                    };

                    const merged = [...existing, successEntry].slice(-400);
                    return { ...prev, [serverId]: merged };
                });
            }

            // Stop polling when backend says OFFLINE
            if (status === 'OFFLINE') {
                clearServerTimers(serverId);
            }
        } catch (err) {
            console.error('Failed to fetch status', err);
            clearServerTimers(serverId);

            setServers((prev) =>
                prev.map((srv) =>
                    srv.id === serverId ? { ...srv, status: 'OFFLINE' } : srv
                )
            );

            setServerStats((prev) => ({
                ...prev,
                [serverId]: {
                    ramUsage: prev[serverId]?.ramUsage ?? 0,
                    ramTotal: prev[serverId]?.ramTotal ?? 0,
                    cpuLoad: prev[serverId]?.cpuLoad ?? 0,
                    tps: prev[serverId]?.tps ?? null,
                    tickTimeMs: prev[serverId]?.tickTimeMs ?? null,
                    status: 'OFFLINE',
                },
            }));

            lastStatusRef.current[serverId] = 'OFFLINE';
        }
    };

    const fetchAndUpdateLogs = async (serverId: string) => {
        try {
            const lines = await apiFetchLogs(serverId, 200);

            setServerLogs((prev) => {
                const existing = prev[serverId] || [];
                const lastSeen = lastLogTailRef.current[serverId];

                const existingMessages = new Set(
                    existing.map((e) => e.message.toLowerCase())
                );

                // Find last seen line to avoid re-adding old tail lines
                const lastIndex = lastSeen ? lines.lastIndexOf(lastSeen) : -1;
                const startIdx = lastIndex >= 0 ? lastIndex + 1 : 0;
                const newLines = lines.slice(startIdx);

                const now = new Date();
                const baseTime = now.getTime();

                const newEntries: LogEntry[] = [];
                newLines.forEach((line, idx) => {
                    const lower = line.toLowerCase();

                    // If backend sends the same SUCCESS message we already
                    // injected, skip it to avoid duplicates.
                    if (
                        lower.includes('completed. ready to start') &&
                        existingMessages.has('[success] completed. ready to start.')
                    ) {
                        return;
                    }

                    newEntries.push({
                        id: `${serverId}-${baseTime + idx}-${Math.random()
                            .toString(36)
                            .slice(2, 6)}`,
                        timestamp: now.toLocaleTimeString(),
                        level: LogLevel.INFO,
                        message: line,
                    });
                });

                if (lines.length > 0) {
                    lastLogTailRef.current[serverId] = lines[lines.length - 1];
                }

                const merged = [...existing, ...newEntries].slice(-400);
                return { ...prev, [serverId]: merged };
            });
        } catch (err) {
            console.error('Failed to fetch logs', err);
            clearServerTimers(serverId);
        }
    };

    const startServer = async (serverId: string) => {
        const server = servers.find((s) => s.id === serverId);
        if (!server) return;
        ensureServerStats(server);
        clearServerTimers(serverId);
        setServers((prev) =>
            prev.map((srv) => (srv.id === serverId ? { ...srv, status: 'STARTING' } : srv))
        );
        appendLog(serverId, 'Starting server container via backend…', LogLevel.INFO);
        try {
            await apiStartServer(serverId);
            appendLog(serverId, 'Start request sent. Polling status…', LogLevel.INFO);
            fetchAndUpdateStatus(serverId);
            fetchAndUpdateLogs(serverId);
            statIntervalsRef.current[serverId] = window.setInterval(
                () => fetchAndUpdateStatus(serverId),
                5000
            );
            logIntervalsRef.current[serverId] = window.setInterval(
                () => fetchAndUpdateLogs(serverId),
                4000
            );
        } catch (err: any) {
            appendLog(serverId, `Failed to start: ${err?.message || err}`, LogLevel.ERROR);
            setServers((prev) =>
                prev.map((srv) => (srv.id === serverId ? { ...srv, status: 'OFFLINE' } : srv))
            );
        }
    };

    const stopServer = async (serverId: string) => {
        const server = servers.find((s) => s.id === serverId);
        if (!server) return;
        clearServerTimers(serverId);
        appendLog(serverId, 'Stop requested. Flushing world save…', LogLevel.WARN);
        try {
            await apiStopServer(serverId);
            setServers((prev) =>
                prev.map((srv) =>
                    srv.id === serverId ? { ...srv, status: 'OFFLINE', players: 0, ramUsage: 0 } : srv
                )
            );
            setServerStats((prev) => {
                const current = prev[serverId];
                return {
                    ...prev,
                    [serverId]: {
                        ...(current || {}),
                        ramUsage: 0,
                        ramTotal: server.ramLimit,
                        cpuLoad: 0,
                        tps: null,
                        tickTimeMs: null,
                        status: 'OFFLINE',
                    },
                };
            });
            appendLog(serverId, 'Server stopped.', LogLevel.INFO);
        } catch (err: any) {
            appendLog(serverId, `Failed to stop: ${err?.message || err}`, LogLevel.ERROR);
        }
    };

    const deleteServerInstance = (serverId: string) => {
        const server = servers.find((s) => s.id === serverId);
        clearServerTimers(serverId);

        // Optimistic UI update: remove from UI immediately
        setServers((prev) => prev.filter((s) => s.id !== serverId));
        setServerStats((prev) => {
            const next = { ...prev };
            delete next[serverId];
            return next;
        });
        setServerLogs((prev) => {
            const next = { ...prev };
            delete next[serverId];
            return next;
        });
        if (activeServerId === serverId) {
            setActiveServerId(null);
        }

        addNotifications([`Deleted server "${server?.name || serverId}".`]);

        // Fire-and-forget API call
        apiDeleteServer(serverId).catch((err: any) => {
            addNotifications([
                `Backend delete failed for "${server?.name || serverId}": ${
                    err?.message || err
                }`,
            ]);
        });
    };


    const handleSendCommand = (serverId: string, command: string) => {
        const trimmed = command.trim();
        if (!trimmed) return;
        appendLog(serverId, `> ${trimmed}`, LogLevel.INFO);
        apiSendCommand(serverId, trimmed).catch((err) =>
            appendLog(serverId, `Failed to send: ${err?.message || err}`, LogLevel.ERROR)
        );
    };

    useEffect(() => {
        return () => {
            Object.values(logIntervalsRef.current).forEach((id) => clearInterval(id));
            Object.values(statIntervalsRef.current).forEach((id) => clearInterval(id));
            Object.values(startupTimersRef.current).forEach((id) => clearTimeout(id));
        };
    }, []);

    useEffect(() => {
        // Reset all intervals when selection changes
        Object.values(logIntervalsRef.current).forEach((id) => clearInterval(id));
        Object.values(statIntervalsRef.current).forEach((id) => clearInterval(id));
        logIntervalsRef.current = {};
        statIntervalsRef.current = {};

        if (!activeServerId) {
            return;
        }

        const active = servers.find((s) => s.id === activeServerId);
        if (!active) {
            return;
        }

        // Fetch/poll when the server is running, starting, or preparing (to show prep logs)
        if (active.status === 'ONLINE' || active.status === 'STARTING' || active.status === 'PREPARING') {
            fetchAndUpdateStatus(active.id);
            fetchAndUpdateLogs(active.id);
            statIntervalsRef.current[active.id] = window.setInterval(
                () => fetchAndUpdateStatus(active.id),
                6000
            );
            logIntervalsRef.current[active.id] = window.setInterval(
                () => fetchAndUpdateLogs(active.id),
                5000
            );
        }
    }, [activeServerId, servers]);

    const addNotifications = (messages: string[]) => {
        if (!messages.length) return;
        const now = new Date().toLocaleTimeString();
        setNotifications((prev) => [
            ...messages.map((msg, idx) => ({
                id: `${Date.now()}-${idx}`,
                message: msg,
                time: now,
            })),
            ...prev,
        ]);
        setUnreadCount((count) => count + messages.length);
    };

    const uniqueServerName = (baseName: string): string => {
        const existing = new Set(servers.map((s) => s.name.toLowerCase()));
        if (!existing.has(baseName.toLowerCase())) return baseName;
        let i = 2;
        while (existing.has(`${baseName} (${i})`.toLowerCase())) {
            i += 1;
        }
        return `${baseName} (${i})`;
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
                ram_gb: 4,
            });

            const mapped = mapInstanceToServer(created);
            lastStatusRef.current[mapped.id] = mapped.status;
            const serverWithPreparing: Server = {
                ...mapped,
                status: 'PREPARING',
            };

            setServers((prev) => [...prev, serverWithPreparing]);
            ensureServerStats(serverWithPreparing);
            addNotifications([`Created server "${serverWithPreparing.name}" for ${modpack.title}.`]);

            setActiveServerId(serverWithPreparing.id);
            setCurrentView(View.DASHBOARD);

            appendLog(
                serverWithPreparing.id,
                'Server created. Preparing (downloading mods)...',
                LogLevel.INFO
            );
            // polling for status & logs will be handled by the [activeServerId, servers] effect
        } catch (err: any) {
            addNotifications([`Failed to create server: ${err?.message || err}`]);
        }
    };

    const updateServer = (serverId: string, updates: Partial<Server>) => {
        setServers((prev) =>
            prev.map((srv) => {
                if (srv.id !== serverId) return srv;
                const nextRamLimit = updates.ramLimit ?? srv.ramLimit;
                return {
                    ...srv,
                    ...updates,
                    ramLimit: nextRamLimit,
                    ramUsage: Math.min(srv.ramUsage, nextRamLimit),
                };
            })
        );
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

    useEffect(() => {
        servers.forEach(ensureServerStats);
    }, [servers]);

    const renderView = () => {
        const activeServer = servers.find((s) => s.id === activeServerId) || servers[0] || null;

        switch (currentView) {
            case View.DASHBOARD:
                return (
                    <ServerConsole
                        server={activeServer}
                        logs={activeServer ? serverLogs[activeServer.id] || [] : []}
                        stats={activeServer ? serverStats[activeServer.id] : undefined}
                        onStart={activeServer ? () => startServer(activeServer.id) : undefined}
                        onStop={activeServer ? () => stopServer(activeServer.id) : undefined}
                        onSendCommand={
                            activeServer ? (command) => handleSendCommand(activeServer.id, command) : undefined
                        }
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
                                const resp = await fetch(`/api/modpacks/${modpack.id}`);
                                if (!resp.ok) {
                                    throw new Error(`API request failed (${resp.status})`);
                                }
                                const data = await resp.json();
                                const uniqLower = (arr: (string | undefined)[] | undefined) => {
                                    const seen = new Set<string>();
                                    return (arr || []).filter((item) => {
                                        if (!item) return false;
                                        const key = item.toLowerCase();
                                        if (seen.has(key)) return false;
                                        seen.add(key);
                                        return true;
                                    });
                                };

                                const mergedCategories = uniqLower([
                                    ...(data.categories || []),
                                    ...(modpack.categories || []),
                                ]).sort((a, b) => a.localeCompare(b));
                                const mergedLoaders = uniqLower([
                                    ...(data.loaders || []),
                                    ...(modpack.loaders || []),
                                ]).sort((a, b) => a.localeCompare(b));
                                const mergedGameVersions = uniqLower([
                                    ...(data.game_versions || []),
                                    ...(modpack.gameVersions || []),
                                ]);

                                setSelectedModpack({
                                    ...modpack,
                                    slug: data.slug,
                                    longDescription: data.body || data.description || modpack.description,
                                    categories: mergedCategories,
                                    loaders: mergedLoaders,
                                    gameVersions: mergedGameVersions,
                                    imageUrl: data.icon_url || modpack.imageUrl,
                                    followers: data.followers ? data.followers.toLocaleString() : modpack.followers,
                                    updatedAt: data.updated || data.date_modified || modpack.updatedAt,
                                    serverSide: data.server_side || modpack.serverSide,
                                });
                            } catch (err: any) {
                                setDetailError(err?.message || 'Failed to load details.');
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
                            addNotifications(['Create a server via the Modpack install flow to provision files.']);
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
            {/* Sidebar Background Blur Layer */}
            <div className="absolute inset-y-0 left-0 w-64 bg-bg-glass backdrop-blur-xl border-r border-white/5 z-10"></div>
            
            <Sidebar currentView={currentView} onChangeView={setCurrentView} />
            
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-0">
                {/* Header */}
                <header className="h-20 flex items-center justify-between px-8 shrink-0 z-10">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                        <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                        <span className="text-xs font-semibold text-emerald-400 tracking-wide uppercase">System Operational</span>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <div className="relative" ref={notificationsRef}>
                            <button
                                className="p-2 text-text-muted hover:text-white hover:bg-white/5 rounded-full transition-all relative"
                                onClick={() => {
                                    const next = !showNotifications;
                                    setShowNotifications(next);
                                    if (next) setUnreadCount(0);
                                }}
                                onMouseEnter={() => {
                                    if (showNotifications) setUnreadCount(0);
                                }}
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

                {/* Content Area */}
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
                    <div className="flex-1 min-h-0 overflow-auto p-6 md:p-8">
                        {renderView()}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default App;
