import React from 'react';
import { Server } from '../types';
import { Play, Square, Settings, MoreVertical, Users, Activity, Plus, Terminal } from 'lucide-react';

const MOCK_SERVERS: Server[] = [
    {
        id: 'srv-01',
        name: 'Survival SMP',
        type: 'Fabric',
        version: '1.20.4',
        port: 25565,
        status: 'ONLINE',
        players: 12,
        maxPlayers: 20,
        ramUsage: 4.2,
        ramLimit: 8
    },
    {
        id: 'srv-02',
        name: 'Creative Build',
        type: 'Paper',
        version: '1.20.1',
        port: 25566,
        status: 'OFFLINE',
        players: 0,
        maxPlayers: 50,
        ramUsage: 0,
        ramLimit: 12
    },
    {
        id: 'srv-03',
        name: 'Hardcore Season 4',
        type: 'Vanilla',
        version: '1.20.4',
        port: 25567,
        status: 'MAINTENANCE',
        players: 0,
        maxPlayers: 10,
        ramUsage: 1.5,
        ramLimit: 4
    }
];

interface ServerListProps {
    onSelectServer: (serverId: string) => void;
}

const ServerList: React.FC<ServerListProps> = ({ onSelectServer }) => {
    
    const getStatusColor = (status: string) => {
        switch (status) {
            case 'ONLINE': return 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]';
            case 'OFFLINE': return 'bg-zinc-500';
            case 'STARTING': return 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.4)]';
            case 'MAINTENANCE': return 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]';
            default: return 'bg-zinc-500';
        }
    };

    return (
        <div className="h-full flex flex-col p-2">
            <div className="flex justify-between items-end mb-8">
                <div>
                    <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-text-muted mb-2">My Servers</h2>
                    <p className="text-text-muted">Manage your instances and monitor performance.</p>
                </div>
                <button className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl shadow-glow shadow-primary/20 transition-all font-medium">
                    <Plus size={18} /> New Server
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {MOCK_SERVERS.map((server) => (
                    <div key={server.id} className="glass-panel p-6 rounded-2xl relative group glass-panel-hover transition-all duration-300">
                        {/* Header */}
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex gap-4">
                                <div className={`w-3 h-3 rounded-full mt-2 ${getStatusColor(server.status)}`}></div>
                                <div>
                                    <h3 className="text-xl font-bold text-white group-hover:text-primary transition-colors">{server.name}</h3>
                                    <div className="flex items-center gap-2 text-xs text-text-muted mt-1">
                                        <span className="px-2 py-0.5 rounded bg-white/5 border border-white/5">{server.type} {server.version}</span>
                                        <span>:{server.port}</span>
                                    </div>
                                </div>
                            </div>
                            <button className="text-text-dim hover:text-white transition-colors">
                                <MoreVertical size={20} />
                            </button>
                        </div>

                        {/* Stats Grid */}
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
                                    {server.ramUsage} <span className="text-sm text-text-dim">GB</span>
                                </div>
                                <div className="w-full h-1 bg-bg-surface rounded-full mt-2 overflow-hidden">
                                    <div 
                                        className="h-full bg-accent" 
                                        style={{ width: `${(server.ramUsage / server.ramLimit) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3 mt-auto">
                            <button 
                                onClick={() => onSelectServer(server.id)}
                                className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white font-medium flex items-center justify-center gap-2 transition-colors border border-white/5"
                            >
                                <Terminal size={16} /> Console
                            </button>
                            
                            {server.status === 'ONLINE' ? (
                                <button className="p-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 transition-colors">
                                    <Square size={18} fill="currentColor" />
                                </button>
                            ) : (
                                <button className="p-2.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/20 transition-colors">
                                    <Play size={18} fill="currentColor" />
                                </button>
                            )}
                            
                            <button className="p-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-text-muted hover:text-white transition-colors border border-white/5">
                                <Settings size={18} />
                            </button>
                        </div>
                    </div>
                ))}

                {/* Add New Server Card (Placeholder style) */}
                <button className="border-2 border-dashed border-border-main rounded-2xl p-6 flex flex-col items-center justify-center text-text-muted hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all group h-full min-h-[240px]">
                    <div className="w-16 h-16 rounded-full bg-bg-surface flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <Plus size={32} />
                    </div>
                    <span className="font-semibold">Add New Instance</span>
                </button>
            </div>
        </div>
    );
};

export default ServerList;