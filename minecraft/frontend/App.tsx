import React, { useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import ModpackBrowser from './components/ModpackBrowser';
import ModpackDetail from './components/ModpackDetail';
import ServerConsole from './components/ServerConsole';
import ServerList from './components/ServerList';
import { View } from './types';
import type { Modpack, Server, InstallRequestOptions } from './types';
import { Bell, HelpCircle, Construction } from 'lucide-react';

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
    const notificationsRef = useRef<HTMLDivElement | null>(null);

    const handleServerSelect = (serverId: string) => {
        setActiveServerId(serverId);
        setCurrentView(View.DASHBOARD);
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

    const createServer = (name: string, port: number): Server => {
        const newServer: Server = {
            id: `srv-${Date.now()}`,
            name,
            type: 'Unknown',
            version: 'latest',
            port,
            status: 'MAINTENANCE',
            players: 0,
            maxPlayers: 20,
            ramUsage: 0,
            ramLimit: 8,
        };
        setServers((prev) => [...prev, newServer]);
        addNotifications([`Created server "${newServer.name}".`]);
        setActiveServerId(newServer.id);
        return newServer;
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

    const uniqueNameForServer = (baseName: string, currentId?: string | null): string => {
        const existing = new Set(
            servers.filter((s) => s.id !== currentId).map((s) => s.name.toLowerCase())
        );
        if (!existing.has(baseName.toLowerCase())) return baseName;
        let i = 2;
        while (existing.has(`${baseName} (${i})`.toLowerCase())) {
            i += 1;
        }
        return `${baseName} (${i})`;
    };

    const handleInstallRequest = (modpack: Modpack, options?: InstallRequestOptions) => {
        // This is a placeholder install handler. In a real app this would trigger
        // backend provisioning. Here we optionally create a new server entry and
        // emit a notification.
        let targetServerId = options?.serverId;
        const versionLabel = options?.versionNumber || modpack.updatedAt || 'latest';
        const loaderLabel = options?.loaders?.[0] || modpack.loaders?.[0] || 'Unknown';
        const baseName = options?.serverName || `${modpack.title} Server`;

        if (!targetServerId || options?.createNew) {
            const nextPort = options?.serverPort ?? 25565 + servers.length;
            const name = uniqueServerName(baseName);
            const newServer = createServer(name, nextPort);
            // Apply modpack-derived metadata
            setServers((prev) =>
                prev.map((srv) =>
                    srv.id === newServer.id
                        ? { ...srv, type: loaderLabel, version: versionLabel }
                        : srv
                )
            );
            targetServerId = newServer.id;
        } else {
            // Update existing server metadata
            setServers((prev) =>
                prev.map((srv) =>
                    srv.id === targetServerId
                        ? {
                              ...srv,
                              name: uniqueNameForServer(baseName, srv.id),
                              type: loaderLabel,
                              version: versionLabel,
                          }
                        : srv
                )
            );
        }

        const targetServer = servers.find((s) => s.id === targetServerId);
        const notifName =
            targetServer?.name ||
            (options?.createNew ? baseName : uniqueNameForServer(baseName, targetServerId));
        addNotifications([
            options?.createNew
                ? `Created server "${notifName}" for ${modpack.title}.`
                : `Queued install of ${modpack.title} on server "${notifName}".`,
        ]);

        if (targetServerId) {
            setActiveServerId(targetServerId);
            setCurrentView(View.DASHBOARD);
        }
    };

    const updateServer = (serverId: string, updates: Partial<Server>) => {
        setServers((prev) =>
            prev.map((srv) => (srv.id === serverId ? { ...srv, ...updates } : srv))
        );
    };

    const renderView = () => {
        switch (currentView) {
            case View.DASHBOARD:
                return <ServerConsole server={servers.find((s) => s.id === activeServerId) || servers[0] || null} />;
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
                        onSelectServer={handleServerSelect}
                        onCreateServer={() => {
                            const port = 25565 + servers.length;
                            createServer(`New Server ${servers.length + 1}`, port);
                        }}
                        onUpdateServer={updateServer}
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
