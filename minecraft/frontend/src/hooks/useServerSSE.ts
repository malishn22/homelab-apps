import { useEffect, useRef, useCallback } from 'react';

export interface SSEStatusEvent {
    status: string;
    stats?: {
        ramUsage?: number;
        ramTotal?: number;
        cpuLoad?: number;
        latency?: number | null;
        players?: number;
        maxPlayers?: number;
    };
}

export interface SSELogsEvent {
    lines: string[];
}

interface UseServerSSEOptions {
    serverId: string | null;
    enabled?: boolean;
    onStatus?: (data: SSEStatusEvent) => void;
    onLogs?: (data: SSELogsEvent) => void;
    onError?: (error: string) => void;
}

/**
 * Connect to the SSE endpoint for a server instance.
 * Pushes status/stats and log updates in real-time.
 *
 * Falls back gracefully: if SSE fails, the existing polling
 * in useServerLogsAndStats continues to work as before.
 */
export function useServerSSE({
    serverId,
    enabled = true,
    onStatus,
    onLogs,
    onError,
}: UseServerSSEOptions) {
    const eventSourceRef = useRef<EventSource | null>(null);
    const onStatusRef = useRef(onStatus);
    const onLogsRef = useRef(onLogs);
    const onErrorRef = useRef(onError);

    onStatusRef.current = onStatus;
    onLogsRef.current = onLogs;
    onErrorRef.current = onError;

    const disconnect = useCallback(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!serverId || !enabled) {
            disconnect();
            return;
        }

        const es = new EventSource(`/api/servers/${serverId}/events`);
        eventSourceRef.current = es;

        es.addEventListener('status', (e) => {
            try {
                const data: SSEStatusEvent = JSON.parse(e.data);
                onStatusRef.current?.(data);
            } catch { /* ignore parse errors */ }
        });

        es.addEventListener('logs', (e) => {
            try {
                const data: SSELogsEvent = JSON.parse(e.data);
                onLogsRef.current?.(data);
            } catch { /* ignore parse errors */ }
        });

        es.addEventListener('error', (e) => {
            if (e instanceof MessageEvent) {
                try {
                    const data = JSON.parse(e.data);
                    onErrorRef.current?.(data.message);
                } catch { /* ignore */ }
            }
        });

        es.onerror = () => {
            onErrorRef.current?.('SSE connection lost, falling back to polling');
            disconnect();
        };

        return () => {
            disconnect();
        };
    }, [serverId, enabled, disconnect]);

    return { disconnect };
}
