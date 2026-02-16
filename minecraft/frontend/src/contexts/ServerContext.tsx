import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { LogLevel, View } from '../types';
import type { Server, ServerStats, LogEntry, InstallRequestOptions, Modpack } from '../types';
import { useServers, useServerLogsAndStats } from '../hooks/useServers';
import { updateServer as apiUpdateServer } from '../api/servers';
import { getErrorMessage } from '../utils';
import { useNotifications } from './NotificationContext';
import { DEFAULT_RAM_MB, DEFAULT_PORT } from '../constants';

interface ServerContextValue {
    servers: Server[];
    setServers: React.Dispatch<React.SetStateAction<Server[]>>;
    serverLogs: Record<string, LogEntry[]>;
    serverStats: Record<string, ServerStats>;
    detailServerId: string | null;
    setDetailServerId: (id: string | null) => void;
    isInitialLoading: boolean;
    startServer: (id: string) => Promise<void>;
    stopServer: (id: string) => Promise<void>;
    restartServer: (id: string) => Promise<void>;
    sendCommand: (id: string, cmd: string) => void;
    updateServer: (serverId: string, updates: Partial<Server>) => Promise<void>;
    deleteServerInstance: (serverId: string) => void;
    handleInstallRequest: (modpack: Modpack, options?: InstallRequestOptions) => Promise<void>;
    handleServerSelect: (serverId: string, tab?: 'console' | 'files') => void;
    ensureServerStats: (server: Server) => void;
    clearServerData: (serverId: string) => void;
    setCurrentView: (view: View) => void;
    setServersViewMode: (mode: 'list' | 'detail') => void;
    setDetailTab: (tab: 'console' | 'files') => void;
}

const ServerContext = createContext<ServerContextValue | null>(null);

export const useServerContext = (): ServerContextValue => {
    const ctx = useContext(ServerContext);
    if (!ctx) throw new Error('useServerContext must be used within ServerProvider');
    return ctx;
};

interface ServerProviderProps {
    children: React.ReactNode;
    currentView: View;
    setCurrentView: (view: View) => void;
    serversViewMode: 'list' | 'detail';
    setServersViewMode: (mode: 'list' | 'detail') => void;
    detailTab: 'console' | 'files';
    setDetailTab: (tab: 'console' | 'files') => void;
}

export const ServerProvider: React.FC<ServerProviderProps> = ({
    children,
    setCurrentView,
    setServersViewMode,
    setDetailTab,
}) => {
    const { addNotifications } = useNotifications();

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

    useEffect(() => {
        servers.forEach(ensureServerStats);
    }, [servers, ensureServerStats]);

    const handleServerSelect = useCallback(
        (serverId: string, tab?: 'console' | 'files') => {
            setDetailServerId(serverId);
            setCurrentView(View.SERVERS);
            setServersViewMode('detail');
            setDetailTab(tab ?? 'console');
            const selected = servers.find((s) => s.id === serverId);
            if (selected) ensureServerStats(selected);
        },
        [servers, ensureServerStats, setDetailServerId, setCurrentView, setServersViewMode, setDetailTab]
    );

    const handleInstallRequest = useCallback(
        async (modpack: Modpack, options?: InstallRequestOptions) => {
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
                const nextPort = options?.serverPort ?? DEFAULT_PORT + servers.length;
                const name = uniqueServerName(baseName);
                const created = await apiCreateServer({
                    name,
                    project_id: modpack.id,
                    version_id: versionId,
                    version_number: versionLabel,
                    loader: loaderLabel,
                    source: sourceLabel,
                    port: nextPort,
                    ram_mb: options?.ramMB ?? DEFAULT_RAM_MB,
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
                addNotifications([`Failed to create server: ${getErrorMessage(err)}`]);
            }
        },
        [
            servers, addNotifications, uniqueServerName, apiCreateServer,
            mapInstanceToServer, setServers, ensureServerStats,
            setDetailServerId, setCurrentView, setServersViewMode, setDetailTab, appendLog,
        ]
    );

    const updateServer = useCallback(
        async (serverId: string, updates: Partial<Server>) => {
            const server = servers.find((s) => s.id === serverId);
            if (!server) return;

            const ramLimit = updates.ramLimit ?? server.ramLimit;
            const ramChanged = updates.ramLimit !== undefined && updates.ramLimit !== server.ramLimit;
            const wasRunning =
                server.status === 'ONLINE' ||
                server.status === 'STARTING' ||
                server.status === 'RESTARTING';

            const payload: { name?: string; port?: number; max_players?: number; ram_mb?: number } = {};
            if (updates.name !== undefined) payload.name = updates.name;
            if (updates.port !== undefined) payload.port = updates.port;
            if (updates.maxPlayers !== undefined) payload.max_players = updates.maxPlayers;
            if (updates.ramLimit !== undefined) payload.ram_mb = Math.round(ramLimit * 1024);

            try {
                await apiUpdateServer(serverId, payload);
            } catch (err: unknown) {
                addNotifications([`Failed to update server: ${getErrorMessage(err)}`]);
                throw err;
            }

            const mergedUpdates: Partial<Server> = { ...updates };
            if (wasRunning && ramChanged) mergedUpdates.status = 'OFFLINE';

            updateServerList(serverId, mergedUpdates);
            setServerStats((prev) => {
                const current = prev[serverId];
                if (!current) return prev;
                return {
                    ...prev,
                    [serverId]: {
                        ...current,
                        ramTotal: ramLimit,
                        ramUsage: ramChanged ? Math.min(current.ramUsage, ramLimit) : current.ramUsage,
                        status: (mergedUpdates.status as ServerStats['status']) ?? current.status,
                    },
                };
            });
        },
        [servers, addNotifications, updateServerList, setServerStats]
    );

    const deleteServerInstance = useCallback(
        (serverId: string) => {
            const server = servers.find((s) => s.id === serverId);
            clearServerData(serverId);
            setServers((prev) => prev.filter((s) => s.id !== serverId));
            if (detailServerId === serverId) {
                setDetailServerId(null);
                setServersViewMode('list');
            }
            addNotifications([`Deleted server "${server?.name ?? serverId}".`]);
            apiDeleteServer(serverId).catch((err: unknown) => {
                addNotifications([`Backend delete failed for "${server?.name ?? serverId}": ${getErrorMessage(err)}`]);
            });
        },
        [servers, detailServerId, clearServerData, setServers, setDetailServerId, setServersViewMode, addNotifications, apiDeleteServer]
    );

    return (
        <ServerContext.Provider
            value={{
                servers,
                setServers,
                serverLogs,
                serverStats,
                detailServerId,
                setDetailServerId,
                isInitialLoading,
                startServer,
                stopServer,
                restartServer,
                sendCommand,
                updateServer,
                deleteServerInstance,
                handleInstallRequest,
                handleServerSelect,
                ensureServerStats,
                clearServerData,
                setCurrentView,
                setServersViewMode,
                setDetailTab,
            }}
        >
            {children}
        </ServerContext.Provider>
    );
};
