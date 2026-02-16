import React, { useState } from 'react';
import { Server, ServerStats } from '../types';
import { Settings, Users, Activity, Plus, Trash } from 'lucide-react';
import RamSlider from './RamSlider';
import { Button, Input, NumberInput } from './ui';
import ServerActionButtonController from './ServerActionButtonController';
import { getStatusDotColor } from '../utils';

interface ServerListProps {
    servers?: Server[];
    compact?: boolean;
    onSelectServer: (serverId: string) => void;
    onCreateServer?: () => void;
    onUpdateServer?: (serverId: string, updates: Partial<Server>) => void | Promise<void>;
    onStartServer?: (serverId: string) => void;
    onStopServer?: (serverId: string) => void;
    onRestartServer?: (serverId: string) => void;
    onDeleteServer?: (serverId: string) => void;
    statsById?: Record<string, ServerStats>;
}

const ServerList: React.FC<ServerListProps> = ({
    servers = [],
    compact = false,
    onSelectServer,
    onCreateServer,
    onUpdateServer,
    onStartServer,
    onStopServer,
    onRestartServer,
    onDeleteServer,
    statsById = {},
}) => {
    const [editing, setEditing] = useState<Server | null>(null);
    const [editForm, setEditForm] = useState<Partial<Server>>({});
    const [isSaving, setIsSaving] = useState(false);
    const getStatsForServer = (server: Server): ServerStats | undefined => statsById[server.id];
    const getRamUsage = (server: Server): number | undefined => {
        const stats = getStatsForServer(server);
        if (!stats?.hasReceivedStatus) return undefined;
        return typeof stats.ramUsage === 'number' ? stats.ramUsage : 0;
    };
    const getRamLimit = (server: Server) => {
        const stats = getStatsForServer(server);
        return typeof stats?.ramTotal === 'number' ? stats.ramTotal : server.ramLimit;
    };
    const getPlayers = (server: Server): number | undefined => {
        const stats = getStatsForServer(server);
        if (!stats?.hasReceivedStatus) return undefined;
        return typeof stats.players === 'number' ? stats.players : 0;
    };
    const getMaxPlayers = (server: Server): number | undefined => {
        const stats = getStatsForServer(server);
        if (!stats?.hasReceivedStatus) return undefined;
        return typeof stats.maxPlayers === 'number' ? stats.maxPlayers : 5;
    };

    return (
        <>
        <div className={`h-full flex flex-col p-2 ${compact ? 'p-2' : ''}`}>
            <div className={`flex justify-between items-end ${compact ? 'mb-4' : 'mb-8'}`}>
                <div>
                    <h2 className={`font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-text-muted ${compact ? 'text-xl mb-0' : 'text-3xl mb-2'}`}>My Servers</h2>
                    {!compact && <p className="text-text-muted">Manage your instances and monitor performance.</p>}
                </div>
                <Button
                    variant="primary"
                    icon={<Plus size={16} />}
                    onClick={onCreateServer}
                    className="rounded-xl shadow-glow shadow-primary/20 font-medium text-sm"
                >
                    New Server
                </Button>
            </div>

            {servers.length === 0 ? (
                <div className={`rounded-2xl border border-dashed border-border-main text-center text-text-muted ${compact ? 'p-6' : 'p-10'}`}>
                    No servers yet. Use the "New Server" button to add one.
                </div>
            ) : (
                <div className={compact ? 'flex flex-col gap-2 overflow-y-auto' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'}>
                    {servers.map((server) => {
                        const ramUsage = getRamUsage(server);
                        const ramLimit = getRamLimit(server);
                        const ramPercent = ramLimit > 0 && typeof ramUsage === 'number' ? Math.min(100, (ramUsage / ramLimit) * 100) : 0;
                        const isOnline = server.status === 'ONLINE';
                        const isStarting = server.status === 'STARTING';
                        const isPreparing = server.status === 'PREPARING';

                        return (
                        <div
                            key={server.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => onSelectServer(server.id)}
                            onKeyDown={(e) => e.key === 'Enter' && onSelectServer(server.id)}
                            className={`glass-panel rounded-2xl relative group glass-panel-hover transition-all duration-300 cursor-pointer ${compact ? 'p-3' : 'p-6'}`}
                        >
                            <div className={`flex justify-between items-start ${compact ? 'mb-2' : 'mb-6'}`}>
                                <div className="flex gap-3 flex-1 min-w-0">
                                    <div className={`rounded-full shrink-0 ${getStatusDotColor(server.status)}`} style={{ width: compact ? 8 : 12, height: compact ? 8 : 12, marginTop: compact ? 4 : 8 }}></div>
                                    <div className="min-w-0">
                                        <h3 className={`font-bold text-white group-hover:text-primary transition-colors truncate ${compact ? 'text-sm' : 'text-xl'}`}>{server.name}</h3>
                                        <div className="flex items-center gap-2 text-xs text-text-muted mt-0.5">
                                            <span className="px-2 py-0.5 rounded bg-white/5 border border-white/5 shrink-0 truncate">{server.type} {server.version}</span>
                                            <span>:{server.port}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {!compact && (
                            <div className="grid grid-cols-2 gap-4 mb-6">
                                <div className="bg-bg-body/30 p-3 rounded-xl border border-white/5">
                                    <div className="flex items-center gap-2 text-xs text-text-muted mb-1">
                                        <Users size={14} /> Players
                                    </div>
                                    <div className="text-lg font-semibold text-white">
                                        {isOnline || isStarting || isPreparing
                                            ? (getPlayers(server) !== undefined && getMaxPlayers(server) !== undefined
                                                ? `${getPlayers(server)} / ${getMaxPlayers(server)}`
                                                : '– / –')
                                            : '– / –'}
                                    </div>
                                </div>
                                <div className="bg-bg-body/30 p-3 rounded-xl border border-white/5">
                                    <div className="flex items-center gap-2 text-xs text-text-muted mb-1">
                                        <Activity size={14} /> RAM
                                    </div>
                                    <div className="text-lg font-semibold text-white">
                                        {typeof ramUsage === 'number' && Number.isFinite(ramUsage) ? `${ramUsage.toFixed(1)} GB` : '–'}
                                    </div>
                                    <div className="w-full h-1 bg-bg-surface rounded-full mt-2 overflow-hidden">
                                        <div 
                                            className="h-full bg-accent" 
                                            style={{ width: `${ramPercent}%` }}
                                        ></div>
                                    </div>
                                </div>
                            </div>
                            )}

                            <div className={`flex gap-2 ${compact ? 'flex-wrap' : ''}`} onClick={(e) => e.stopPropagation()}>
                                <ServerActionButtonController
                                    serverId={server.id}
                                    status={server.status}
                                    onStart={() => onStartServer?.(server.id)}
                                    onStop={() => onStopServer?.(server.id)}
                                    onRestart={() => onRestartServer?.(server.id)}
                                    layout="compact"
                                />
                                <Button
                                    variant="ghost"
                                    icon={<Settings size={18} />}
                                    onClick={() => {
                                        setEditing(server);
                                        setEditForm(server);
                                    }}
                                    className="p-2.5 border border-white/5"
                                />
                                <Button
                                    variant="danger"
                                    icon={<Trash size={18} />}
                                    onClick={() => {
                                        if (window.confirm(`Delete server "${server.name}"? This cannot be undone.`)) {
                                            onDeleteServer?.(server.id);
                                        }
                                    }}
                                    className="p-2.5"
                                />
                            </div>
                        </div>
                        );
                    })}
                </div>
            )}
        </div>
        {editing && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4">
                <div className="bg-gradient-to-b from-bg-surface to-bg-body border border-border-main rounded-3xl shadow-[0_24px_80px_rgba(0,0,0,0.45)] w-full max-w-3xl p-8 relative overflow-hidden">
                    <div className="absolute -left-16 -top-16 w-64 h-64 bg-primary/10 rounded-full blur-3xl"></div>
                    <div className="absolute -right-16 -bottom-16 w-64 h-64 bg-accent/10 rounded-full blur-3xl"></div>
                    <div className="relative z-10">
                        {(() => {
                            const displayServer = servers.find((s) => s.id === editing.id) ?? editing;
                            return (
                        <div className="flex items-start justify-between mb-6 gap-4">
                            <div>
                                <div className="text-sm uppercase tracking-wide text-text-dim">Server Details</div>
                                <div className="text-2xl font-bold text-white mt-1">{editing.name}</div>
                                <div className="text-xs text-text-muted mt-2 space-x-2">
                                    <span>ID: {editing.id}</span>
                                    <span>• Players {(displayServer.status === 'ONLINE' || displayServer.status === 'STARTING' || displayServer.status === 'PREPARING')
                                        && getPlayers(displayServer) !== undefined && getMaxPlayers(displayServer) !== undefined
                                        ? `${getPlayers(displayServer)}/${getMaxPlayers(displayServer)}`
                                        : '–/–'}</span>
                                    <span>• RAM {(() => {
                                        const ru = getRamUsage(displayServer);
                                        return typeof ru === 'number' && Number.isFinite(ru) ? `${ru.toFixed(1)}/${getRamLimit(displayServer)} GB` : '–';
                                    })()}</span>
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                <div className="px-3 py-1.5 rounded-full border border-border-main bg-white/5 text-xs text-text-muted">
                                    Status: <span className="text-white font-semibold">{displayServer.status}</span>
                                </div>
                                <div className="flex flex-wrap justify-end gap-2 text-xs">
                                    <span className="px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary font-semibold capitalize shadow-glow shadow-primary/10">
                                        {displayServer.type}
                                    </span>
                                    <span className="px-3 py-1 rounded-full border border-border-main bg-white/5 text-white font-semibold shadow-[0_4px_12px_rgba(0,0,0,0.25)]">
                                        v{displayServer.version}
                                    </span>
                                </div>
                            </div>
                        </div>
                            );
                        })()}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="md:col-span-2">
                                <Input
                                    label="Name"
                                    value={editForm.name || ''}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                                    className="rounded-xl px-4 py-3"
                                />
                            </div>
                            <NumberInput
                                label="Port"
                                value={editForm.port ?? ''}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, port: parseInt(e.target.value, 10) || editing.port }))}
                                min={1}
                                max={65535}
                                className="rounded-xl [&_input]:px-4 [&_input]:py-3"
                            />
                            <NumberInput
                                label="Max Players"
                                value={editForm.maxPlayers ?? editing.maxPlayers ?? ''}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, maxPlayers: parseInt(e.target.value, 10) || editing.maxPlayers }))}
                                min={1}
                                max={65535}
                                className="rounded-xl [&_input]:px-4 [&_input]:py-3"
                            />
                            <div className="space-y-2 md:col-span-2">
                                <RamSlider
                                    label="RAM Limit (GB)"
                                    value={editForm.ramLimit ?? editing.ramLimit ?? 4}
                                    onChange={(gb) => setEditForm((prev) => ({ ...prev, ramLimit: gb }))}
                                />
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setEditing(null);
                                    setEditForm({});
                                }}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                loading={isSaving}
                                disabled={isSaving}
                                onClick={async () => {
                                    if (!editing || !onUpdateServer) return;
                                    setIsSaving(true);
                                    try {
                                        await onUpdateServer(editing.id, editForm);
                                        setEditing(null);
                                        setEditForm({});
                                    } catch {
                                        // Error already shown via addNotifications in parent
                                    } finally {
                                        setIsSaving(false);
                                    }
                                }}
                            >
                                {isSaving ? 'Saving…' : 'Save'}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        )}
        </>
    );
};

export default ServerList;
