import React, { useEffect, useState } from 'react';
import { View } from '../types';
import type { DashboardTab } from '../types';
import { ChevronLeft } from 'lucide-react';
import { TabGroup, Select } from '../components/ui';
import ServerConsole from '../components/ServerConsole';
import ServerList from '../components/ServerList';
import ServerFileBrowser from '../components/ServerFileBrowser';
import ServerFileEditor from '../components/ServerFileEditor';
import { useServerContext } from '../contexts/ServerContext';
import { useNotifications } from '../contexts/NotificationContext';

interface ServersViewProps {
    serversViewMode: 'list' | 'detail';
    setServersViewMode: (mode: 'list' | 'detail') => void;
    detailTab: DashboardTab;
    setDetailTab: (tab: DashboardTab) => void;
}

const ServersView: React.FC<ServersViewProps> = ({
    serversViewMode,
    setServersViewMode,
    detailTab,
    setDetailTab,
}) => {
    const {
        servers,
        serverLogs,
        serverStats,
        detailServerId,
        setDetailServerId,
        startServer,
        stopServer,
        restartServer,
        sendCommand,
        updateServer,
        deleteServerInstance,
        handleServerSelect,
        setCurrentView,
    } = useServerContext();
    const { addNotifications } = useNotifications();

    const [filesBrowserPath, setFilesBrowserPath] = useState('');
    const [filesSelectedPath, setFilesSelectedPath] = useState<string | null>(null);

    const handleFilesServerChange = (serverId: string) => {
        setDetailServerId(serverId || null);
        setFilesBrowserPath('');
        setFilesSelectedPath(null);
    };

    useEffect(() => {
        if (serversViewMode === 'detail' && detailServerId && !servers.some((s) => s.id === detailServerId)) {
            setServersViewMode('list');
            setDetailServerId(null);
        }
    }, [serversViewMode, detailServerId, servers, setServersViewMode, setDetailServerId]);

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
                onRestartServer={restartServer}
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
                <TabGroup
                    variant="segmented"
                    options={[
                        { key: 'console', label: 'Console' },
                        { key: 'files', label: 'Files' },
                    ]}
                    value={detailTab}
                    onChange={(k) => setDetailTab(k as DashboardTab)}
                />
                {detailTab === 'files' && servers.length > 1 && (
                    <Select
                        options={servers.map((s) => ({ value: s.id, label: s.name }))}
                        value={detailServerId ?? ''}
                        onChange={handleFilesServerChange}
                        className="bg-bg-surface border-white/5"
                    />
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
};

export default ServersView;
