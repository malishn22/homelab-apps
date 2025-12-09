import React, { useState, useEffect, useRef } from 'react';
import { LogLevel } from '../types';
import type { LogEntry, ServerStats, Server } from '../types';
import { Square, RefreshCw, Cpu, HardDrive, Terminal, ChevronRight } from 'lucide-react';

const INITIAL_LOGS: LogEntry[] = [];

interface ServerConsoleProps {
    server: Server | null;
}

const ServerConsole: React.FC<ServerConsoleProps> = ({ server }) => {
    const [logs, setLogs] = useState<LogEntry[]>(INITIAL_LOGS);
    const [stats, setStats] = useState<ServerStats>({
        ramUsage: 4.2,
        ramTotal: 8,
        cpuLoad: 12,
        tps: 20,
        status: 'ONLINE'
    });
    const consoleEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    useEffect(() => {
        if (!server) {
            setLogs([]);
            return;
        }
        setLogs([]);
        setStats((prev) => ({
            ...prev,
            ramUsage: Math.min(prev.ramTotal, Math.max(2, prev.ramUsage)),
            status: server.status === 'MAINTENANCE' ? 'STARTING' : (server.status as any),
        }));
    }, [server]);

    const getLevelColor = (level: LogLevel) => {
        switch(level) {
            case LogLevel.INFO: return 'text-primary';
            case LogLevel.WARN: return 'text-yellow-400';
            case LogLevel.ERROR: return 'text-red-500';
            case LogLevel.SUCCESS: return 'text-accent';
            default: return 'text-text-muted';
        }
    };

    if (!server) {
        return (
            <div className="flex flex-col h-full p-6 items-center justify-center text-text-muted">
                <Terminal className="text-accent mb-3" size={32} />
                <div className="text-lg text-white">No server selected</div>
                <div className="text-sm">Pick a server from the Servers tab to view its console.</div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full p-2">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                         <Terminal className="text-accent" size={24} /> 
                         {server ? `${server.name} Console` : 'Live Console'}
                    </h2>
                    <p className="text-text-muted text-sm">
                        {server ? `Instance ID: ${server.id} • Port ${server.port}` : 'Select a server to view console'}
                    </p>
                </div>
                <div className="flex gap-2">
                    <button className="flex items-center gap-2 px-4 py-2 bg-bg-surface hover:bg-bg-hover text-white rounded-lg border border-border-main transition-colors shadow-sm">
                        <RefreshCw size={16} /> <span className="hidden sm:inline">Restart</span>
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded-lg border border-red-500/20 transition-colors shadow-sm shadow-red-900/10">
                        <Square size={16} fill="currentColor" /> <span className="hidden sm:inline">Stop</span>
                    </button>
                </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {/* RAM Card */}
                <div className="glass-panel p-5 rounded-2xl relative overflow-hidden group">
                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-primary/20 rounded-full blur-2xl group-hover:bg-primary/30 transition-all"></div>
                    <div className="relative z-10">
                        <div className="text-text-muted text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                            <HardDrive size={14} /> RAM Usage
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-white">{stats.ramUsage.toFixed(1)}</span>
                            <span className="text-sm text-text-muted">/ {stats.ramTotal} GB</span>
                        </div>
                        <div className="w-full bg-bg-body/50 h-1.5 mt-4 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-gradient-to-r from-primary to-purple-400 transition-all duration-500 shadow-[0_0_10px_rgba(139,92,246,0.5)]" 
                                style={{ width: `${(stats.ramUsage / stats.ramTotal) * 100}%` }}
                            ></div>
                        </div>
                    </div>
                </div>

                {/* CPU Card */}
                <div className="glass-panel p-5 rounded-2xl relative overflow-hidden group">
                     <div className="absolute -right-4 -top-4 w-24 h-24 bg-accent/20 rounded-full blur-2xl group-hover:bg-accent/30 transition-all"></div>
                    <div className="relative z-10">
                        <div className="text-text-muted text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                            <Cpu size={14} /> CPU Load
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-white">{stats.cpuLoad.toFixed(0)}</span>
                            <span className="text-sm text-text-muted">%</span>
                        </div>
                        <div className="w-full bg-bg-body/50 h-1.5 mt-4 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-gradient-to-r from-accent to-blue-400 transition-all duration-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]" 
                                style={{ width: `${stats.cpuLoad}%` }}
                            ></div>
                        </div>
                    </div>
                </div>

                {/* Status Card */}
                <div className="glass-panel p-5 rounded-2xl relative overflow-hidden flex flex-col justify-center">
                    <div className="flex justify-between items-center">
                        <div>
                             <div className="text-text-muted text-xs font-bold uppercase tracking-wider mb-1">Status</div>
                             <div className="text-xl font-bold text-emerald-400 flex items-center gap-2">
                                <span className="relative flex h-2.5 w-2.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                </span>
                                {stats.status}
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-text-muted text-xs font-bold uppercase tracking-wider mb-1">TPS</div>
                            <div className="text-xl font-bold text-white">{stats.tps.toFixed(1)}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Console Window */}
            <div className="flex-1 min-h-0 bg-bg-console border border-border-main rounded-xl flex flex-col relative group shadow-2xl overflow-hidden">
                {/* Console Header */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/5 backdrop-blur">
                    <div className="flex gap-2">
                         <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
                         <div className="w-3 h-3 rounded-full bg-yellow-500/50"></div>
                         <div className="w-3 h-3 rounded-full bg-emerald-500/50"></div>
                    </div>
                </div>

                {/* Log Output */}
                <div className="flex-1 overflow-y-auto p-4 font-mono text-sm console-scrollbar space-y-1">
                    {logs.map((log) => (
                        <div key={log.id} className="break-all font-medium">
                            <span className="text-text-dim select-none mr-2">{log.timestamp}</span>
                            <span className={`${getLevelColor(log.level)} mr-2`}>[{log.level}]</span>
                            <span className="text-gray-300">{log.message}</span>
                        </div>
                    ))}
                    
                    <div className="flex items-center text-gray-300 mt-2">
                        <ChevronRight size={16} className="text-accent animate-pulse" />
                        <span className="ml-1 w-2 h-4 bg-accent/50 animate-blink"></span>
                    </div>
                    <div ref={consoleEndRef} />
                </div>
                
            </div>

            {/* Input Line */}
            <div className="mt-4 relative">
                <ChevronRight className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
                <input 
                    type="text" 
                    placeholder="Enter command..." 
                    className="w-full bg-glass border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white font-mono text-sm focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all placeholder:text-text-dim"
                />
            </div>
        </div>
    );
};

export default ServerConsole;
