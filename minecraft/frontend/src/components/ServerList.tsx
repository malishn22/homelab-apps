import React, { useState } from 'react';
import { Server, ServerStats } from '../types';
import { Play, Square, Settings, Users, Activity, Plus, Trash } from 'lucide-react';

interface ServerListProps {
    servers?: Server[];
    compact?: boolean;
    activeServerId?: string | null;
    onSelectServer: (serverId: string) => void;
    onCreateServer?: () => void;
    onUpdateServer?: (serverId: string, updates: Partial<Server>) => void;
    onStartServer?: (serverId: string) => void;
    onStopServer?: (serverId: string) => void;
    onDeleteServer?: (serverId: string) => void;
    statsById?: Record<string, ServerStats>;
}

const ServerList: React.FC<ServerListProps> = ({
    servers = [],
    compact = false,
    activeServerId = null,
    onSelectServer,
    onCreateServer,
    onUpdateServer,
    onStartServer,
    onStopServer,
    onDeleteServer,
    statsById = {},
}) => {
    const [editing, setEditing] = useState<Server | null>(null);
    const [editForm, setEditForm] = useState<Partial<Server>>({});
    const getStatusColor = (status: string) => {
        switch (status) {
            case 'ONLINE': return 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]';
            case 'OFFLINE': return 'bg-zinc-500';
            case 'STARTING': return 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.4)]';
            case 'PREPARING': return 'bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.4)]';
            case 'ERROR': return 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]';
            case 'MAINTENANCE': return 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]';
            default: return 'bg-zinc-500';
        }
    };
    const getStatsForServer = (server: Server): ServerStats | undefined => statsById[server.id];
    const getRamUsage = (server: Server) => {
        const stats = getStatsForServer(server);
        return typeof stats?.ramUsage === 'number' ? stats.ramUsage : server.ramUsage;
    };
    const getRamLimit = (server: Server) => {
        const stats = getStatsForServer(server);
        return typeof stats?.ramTotal === 'number' ? stats.ramTotal : server.ramLimit;
    };

    return (
        <>
        <div className={`h-full flex flex-col p-2 ${compact ? 'p-2' : ''}`}>
            <div className={`flex justify-between items-end ${compact ? 'mb-4' : 'mb-8'}`}>
                <div>
                    <h2 className={`font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-text-muted ${compact ? 'text-xl mb-0' : 'text-3xl mb-2'}`}>My Servers</h2>
                    {!compact && <p className="text-text-muted">Manage your instances and monitor performance.</p>}
                </div>
                <button
                    className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl shadow-glow shadow-primary/20 transition-all font-medium text-sm"
                    onClick={onCreateServer}
                >
                    <Plus size={16} /> New Server
                </button>
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
                        const ramPercent = ramLimit > 0 ? Math.min(100, (ramUsage / ramLimit) * 100) : 0;
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
                                    <div className={`rounded-full shrink-0 ${getStatusColor(server.status)}`} style={{ width: compact ? 8 : 12, height: compact ? 8 : 12, marginTop: compact ? 4 : 8 }}></div>
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
                                        {server.players} <span className="text-sm text-text-dim">/ {server.maxPlayers}</span>
                                    </div>
                                </div>
                                <div className="bg-bg-body/30 p-3 rounded-xl border border-white/5">
                                    <div className="flex items-center gap-2 text-xs text-text-muted mb-1">
                                        <Activity size={14} /> RAM
                                    </div>
                                    <div className="text-lg font-semibold text-white">
                                        {Number.isFinite(ramUsage) ? ramUsage.toFixed(1) : ramUsage} <span className="text-sm text-text-dim">GB</span>
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
                                {isOnline ? (
                                    <button
                                        disabled={isStarting || isPreparing}
                                        onClick={() => onStopServer?.(server.id)}
                                        className="p-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        <Square size={18} fill="currentColor" />
                                    </button>
                                ) : (
                                    <button
                                        disabled={isStarting || isPreparing}
                                        onClick={() => onStartServer?.(server.id)}
                                        className="p-2.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        <Play size={18} fill="currentColor" />
                                    </button>
                                )}
                                <button
                                    className="p-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-text-muted hover:text-white transition-colors border border-white/5"
                                    onClick={() => {
                                        setEditing(server);
                                        setEditForm(server);
                                    }}
                                >
                                    <Settings size={18} />
                                </button>
                                <button
                                    className="p-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors"
                                    onClick={() => {
                                        if (window.confirm(`Delete server "${server.name}"? This cannot be undone.`)) {
                                            onDeleteServer?.(server.id);
                                        }
                                    }}
                                >
                                    <Trash size={18} />
                                </button>
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
                        <div className="flex items-start justify-between mb-6 gap-4">
                            <div>
                                <div className="text-sm uppercase tracking-wide text-text-dim">Server Details</div>
                                <div className="text-2xl font-bold text-white mt-1">{editing.name}</div>
                                <div className="text-xs text-text-muted mt-2 space-x-2">
                                    <span>ID: {editing.id}</span>
                                    <span>• Players {editing.players}/{editing.maxPlayers}</span>
                                    <span>
                                        • RAM {Number.isFinite(getRamUsage(editing)) ? getRamUsage(editing).toFixed(1) : getRamUsage(editing)}
                                        /{getRamLimit(editing)} GB
                                    </span>
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                <div className="px-3 py-1.5 rounded-full border border-border-main bg-white/5 text-xs text-text-muted">
                                    Status: <span className="text-white font-semibold">{editing.status}</span>
                                </div>
                                <div className="flex flex-wrap justify-end gap-2 text-xs">
                                    <span className="px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary font-semibold capitalize shadow-glow shadow-primary/10">
                                        {editing.type}
                                    </span>
                                    <span className="px-3 py-1 rounded-full border border-border-main bg-white/5 text-white font-semibold shadow-[0_4px_12px_rgba(0,0,0,0.25)]">
                                        v{editing.version}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-xs text-text-dim block">Name</label>
                                <input
                                    className="w-full rounded-xl bg-bg-surface/80 border border-border-main px-4 py-3 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                    value={editForm.name || ''}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs text-text-dim block">Port</label>
                                <input
                                    className="w-full rounded-xl bg-bg-surface/80 border border-border-main px-4 py-3 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary appearance-none"
                                    value={editForm.port || ''}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, port: parseInt(e.target.value, 10) || editing.port }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs text-text-dim block">Max Players</label>
                                <input
                                    className="w-full rounded-xl bg-bg-surface/80 border border-border-main px-4 py-3 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary appearance-none"
                                    value={editForm.maxPlayers ?? editing.maxPlayers}
                                    onChange={(e) => setEditForm((prev) => ({ ...prev, maxPlayers: parseInt(e.target.value, 10) || editing.maxPlayers }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs text-text-dim block">RAM Limit (GB)</label>
                                <input
                                    type="number"
                                    min={1}
                                    className="w-full rounded-xl bg-bg-surface/80 border border-border-main px-4 py-3 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary appearance-none"
                                    value={editForm.ramLimit ?? editing.ramLimit}
                                    onChange={(e) =>
                                        setEditForm((prev) => ({
                                            ...prev,
                                            ramLimit: Math.max(1, parseFloat(e.target.value) || editing.ramLimit),
                                        }))
                                    }
                                />
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                className="px-5 py-2.5 rounded-lg border border-border-main text-text-muted hover:text-white hover:border-white/40 transition-colors"
                                onClick={() => {
                                    setEditing(null);
                                    setEditForm({});
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                className="px-5 py-2.5 rounded-lg bg-red-500/10 text-red-300 font-semibold hover:bg-red-500/20 border border-red-500/30 transition-colors"
                                onClick={() => {
                                    if (editing && window.confirm(`Delete server "${editing.name}"? This cannot be undone.`)) {
                                        onDeleteServer?.(editing.id);
                                        setEditing(null);
                                        setEditForm({});
                                    }
                                }}
                            >
                                Delete
                            </button>
                            <button
                                className="px-5 py-2.5 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 transition-colors"
                                onClick={() => {
                                    if (editing && onUpdateServer) {
                                        onUpdateServer(editing.id, editForm);
                                    }
                                    setEditing(null);
                                    setEditForm({});
                                }}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}
        </>
    );
};

export default ServerList;
