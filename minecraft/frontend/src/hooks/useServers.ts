import { useCallback, useEffect, useRef, useState } from 'react';
import { LogLevel } from '../types';
import type { LogEntry, Server, ServerStats } from '../types';
import {
    listServers as apiListServers,
    createServer as apiCreateServer,
    startServer as apiStartServer,
    stopServer as apiStopServer,
    fetchLogs as apiFetchLogs,
    fetchStatus as apiFetchStatus,
    sendCommand as apiSendCommand,
    deleteServer as apiDeleteServer,
} from '../api/servers';

function mapInstanceToServer(instance: Record<string, unknown>): Server {
    return {
        id: (instance.id as string) ?? '',
        name: (instance.name as string) ?? '',
        type: (instance.loader as string) || 'Modpack',
        version: (instance.version_number as string) || 'latest',
        port: (instance.port as number) ?? 25565,
        status: (instance.status as Server['status']) || 'OFFLINE',
        players: 0,
        maxPlayers: 20,
        ramUsage: 0,
        ramLimit: (instance.ram_gb as number) || 4,
    };
}

export function useServers() {
    const [servers, setServers] = useState<Server[]>([]);
    const [activeServerId, setActiveServerId] = useState<string | null>(null);
    const [isInitialLoading, setIsInitialLoading] = useState(true);

    const bootstrap = useCallback(async () => {
        try {
            const items = await apiListServers();
            const mapped = items.map((i) => mapInstanceToServer(i));
            setServers(mapped);
            return mapped;
        } catch (err) {
            console.error('Failed to fetch servers', err);
            return [];
        } finally {
            setIsInitialLoading(false);
        }
    }, []);

    useEffect(() => {
        bootstrap();
    }, [bootstrap]);

    const handleServerSelect = useCallback(
        (serverId: string) => {
            setActiveServerId(serverId);
        },
        []
    );

    const uniqueServerName = useCallback(
        (baseName: string): string => {
            const existing = new Set(servers.map((s) => s.name.toLowerCase()));
            if (!existing.has(baseName.toLowerCase())) return baseName;
            let i = 2;
            while (existing.has(`${baseName} (${i})`.toLowerCase())) {
                i += 1;
            }
            return `${baseName} (${i})`;
        },
        [servers]
    );

    const updateServer = useCallback((serverId: string, updates: Partial<Server>) => {
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
    }, []);

    return {
        servers,
        setServers,
        activeServerId,
        setActiveServerId,
        isInitialLoading,
        bootstrap,
        handleServerSelect,
        mapInstanceToServer,
        uniqueServerName,
        updateServer,
        apiCreateServer,
        apiStartServer,
        apiStopServer,
        apiDeleteServer,
    };
}

export function useServerLogsAndStats(
    activeServerId: string | null,
    servers: Server[],
    setServers: React.Dispatch<React.SetStateAction<Server[]>>
) {
    const [serverLogs, setServerLogs] = useState<Record<string, LogEntry[]>>({});
    const [serverStats, setServerStats] = useState<Record<string, ServerStats>>({});
    const logIntervalsRef = useRef<Record<string, number>>({});
    const statIntervalsRef = useRef<Record<string, number>>({});
    const lastLogTailRef = useRef<Record<string, string | undefined>>({});
    const lastStatusRef = useRef<Record<string, Server['status'] | undefined>>({});

    const clearServerTimers = useCallback((serverId: string) => {
        if (logIntervalsRef.current[serverId]) {
            clearInterval(logIntervalsRef.current[serverId]);
            delete logIntervalsRef.current[serverId];
        }
        if (statIntervalsRef.current[serverId]) {
            clearInterval(statIntervalsRef.current[serverId]);
            delete statIntervalsRef.current[serverId];
        }
    }, []);

    const ensureServerStats = useCallback((server: Server) => {
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
    }, []);

    const appendLog = useCallback((serverId: string, message: string, level: LogLevel = LogLevel.INFO) => {
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
    }, []);

    const fetchAndUpdateStatus = useCallback(
        async (serverId: string) => {
            try {
                const data = await apiFetchStatus(serverId);
                const status = (data.status as Server['status']) || 'OFFLINE';
                const stats = data.stats ?? {};
                const prevStatus = lastStatusRef.current[serverId];
                lastStatusRef.current[serverId] = status;

                setServers((prev) =>
                    prev.map((srv) =>
                        srv.id === serverId
                            ? {
                                ...srv,
                                status,
                                ramUsage: typeof stats.ramUsage === 'number' ? stats.ramUsage : srv.ramUsage,
                                ramLimit: srv.ramLimit,
                            }
                            : srv
                    )
                );

                setServerStats((prev) => ({
                    ...prev,
                    [serverId]: {
                        ramUsage: stats.ramUsage ?? prev[serverId]?.ramUsage ?? 0,
                        ramTotal: stats.ramTotal ?? prev[serverId]?.ramTotal ?? 0,
                        cpuLoad: stats.cpuLoad ?? prev[serverId]?.cpuLoad ?? 0,
                        tps: typeof stats.tps === 'number' ? stats.tps : prev[serverId]?.tps ?? null,
                        tickTimeMs:
                            typeof stats.tickTimeMs === 'number'
                                ? stats.tickTimeMs
                                : prev[serverId]?.tickTimeMs ?? null,
                        status: status as ServerStats['status'],
                    },
                }));

                if (prevStatus === 'PREPARING' && status === 'OFFLINE') {
                    setServerLogs((prev) => {
                        const existing = prev[serverId] || [];
                        const hasSuccess = existing.some((e) =>
                            e.message.toLowerCase().includes('completed. ready to start')
                        );
                        if (hasSuccess) return prev;
                        const now = new Date();
                        const successEntry: LogEntry = {
                            id: `${serverId}-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
                            timestamp: now.toLocaleTimeString(),
                            level: LogLevel.SUCCESS,
                            message: '[SUCCESS] Completed. Ready to start.',
                        };
                        return { ...prev, [serverId]: [...existing, successEntry].slice(-400) };
                    });
                }

                if (status === 'OFFLINE') {
                    clearServerTimers(serverId);
                }
            } catch (err) {
                console.error('Failed to fetch status', err);
                clearServerTimers(serverId);
                setServers((prev) =>
                    prev.map((srv) => (srv.id === serverId ? { ...srv, status: 'OFFLINE' as const } : srv))
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
        },
        [clearServerTimers, setServers]
    );

    const fetchAndUpdateLogs = useCallback(async (serverId: string) => {
        try {
            const lines = await apiFetchLogs(serverId, 200);
            setServerLogs((prev) => {
                const existing = prev[serverId] || [];
                const lastSeen = lastLogTailRef.current[serverId];
                const existingMessages = new Set(existing.map((e) => e.message.toLowerCase()));
                const lastIndex = lastSeen ? lines.lastIndexOf(lastSeen) : -1;
                const startIdx = lastIndex >= 0 ? lastIndex + 1 : 0;
                const newLines = lines.slice(startIdx);
                const now = new Date();
                const baseTime = now.getTime();
                const newEntries: LogEntry[] = [];
                newLines.forEach((line, idx) => {
                    const lower = line.toLowerCase();
                    if (
                        lower.includes('completed. ready to start') &&
                        existingMessages.has('[success] completed. ready to start.')
                    ) {
                        return;
                    }
                    newEntries.push({
                        id: `${serverId}-${baseTime + idx}-${Math.random().toString(36).slice(2, 6)}`,
                        timestamp: now.toLocaleTimeString(),
                        level: LogLevel.INFO,
                        message: line,
                    });
                });
                if (lines.length > 0) {
                    lastLogTailRef.current[serverId] = lines[lines.length - 1];
                }
                return { ...prev, [serverId]: [...existing, ...newEntries].slice(-400) };
            });
        } catch (err) {
            console.error('Failed to fetch logs', err);
            clearServerTimers(serverId);
        }
    }, [clearServerTimers]);

    const startServer = useCallback(
        async (serverId: string) => {
            const server = servers.find((s) => s.id === serverId);
            if (!server) return;
            ensureServerStats(server);
            clearServerTimers(serverId);
            setServers((prev) =>
                prev.map((srv) => (srv.id === serverId ? { ...srv, status: 'STARTING' as const } : srv))
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
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                appendLog(serverId, `Failed to start: ${message}`, LogLevel.ERROR);
                setServers((prev) =>
                    prev.map((srv) => (srv.id === serverId ? { ...srv, status: 'OFFLINE' as const } : srv))
                );
            }
        },
        [
            servers,
            ensureServerStats,
            clearServerTimers,
            appendLog,
            fetchAndUpdateStatus,
            fetchAndUpdateLogs,
            setServers,
        ]
    );

    const stopServer = useCallback(
        async (serverId: string) => {
            const server = servers.find((s) => s.id === serverId);
            if (!server) return;
            clearServerTimers(serverId);
            appendLog(serverId, 'Stop requested. Flushing world save…', LogLevel.WARN);
            try {
                await apiStopServer(serverId);
                setServers((prev) =>
                    prev.map((srv) =>
                        srv.id === serverId
                            ? { ...srv, status: 'OFFLINE' as const, players: 0, ramUsage: 0 }
                            : srv
                    )
                );
                setServerStats((prev) => ({
                    ...prev,
                    [serverId]: {
                        ...prev[serverId],
                        ramUsage: 0,
                        ramTotal: server.ramLimit,
                        cpuLoad: 0,
                        tps: null,
                        tickTimeMs: null,
                        status: 'OFFLINE' as const,
                    },
                }));
                appendLog(serverId, 'Server stopped.', LogLevel.INFO);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                appendLog(serverId, `Failed to stop: ${message}`, LogLevel.ERROR);
            }
        },
        [servers, clearServerTimers, appendLog, setServers]
    );

    const sendCommand = useCallback((serverId: string, command: string) => {
        const trimmed = command.trim();
        if (!trimmed) return;
        appendLog(serverId, `> ${trimmed}`, LogLevel.INFO);
        apiSendCommand(serverId, trimmed).catch((err) =>
            appendLog(
                serverId,
                `Failed to send: ${err instanceof Error ? err.message : err}`,
                LogLevel.ERROR
            )
        );
    }, [appendLog]);

    useEffect(() => {
        return () => {
            Object.values(logIntervalsRef.current).forEach((id) => clearInterval(id));
            Object.values(statIntervalsRef.current).forEach((id) => clearInterval(id));
        };
    }, []);

    useEffect(() => {
        Object.values(logIntervalsRef.current).forEach((id) => clearInterval(id));
        Object.values(statIntervalsRef.current).forEach((id) => clearInterval(id));
        logIntervalsRef.current = {};
        statIntervalsRef.current = {};

        if (!activeServerId) return;
        const active = servers.find((s) => s.id === activeServerId);
        if (!active) return;
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
    }, [activeServerId, servers, fetchAndUpdateStatus, fetchAndUpdateLogs]);

    const clearServerData = useCallback((serverId: string) => {
        clearServerTimers(serverId);
        setServerLogs((prev) => {
            const next = { ...prev };
            delete next[serverId];
            return next;
        });
        setServerStats((prev) => {
            const next = { ...prev };
            delete next[serverId];
            return next;
        });
    }, [clearServerTimers]);

    return {
        serverLogs,
        serverStats,
        appendLog,
        clearServerTimers,
        clearServerData,
        ensureServerStats,
        startServer,
        stopServer,
        sendCommand,
        setServerStats,
    };
}
