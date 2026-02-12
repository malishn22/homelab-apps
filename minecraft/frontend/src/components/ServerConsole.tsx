import React, { useState, useEffect, useRef } from 'react';
import { LogLevel } from '../types';
import type { LogEntry, ServerStats, Server } from '../types';
import { Square, RefreshCw, Cpu, HardDrive, Terminal, ChevronRight, Play } from 'lucide-react';

interface ServerConsoleProps {
    server: Server | null;
    logs?: LogEntry[];
    stats?: ServerStats;
    onStart?: () => void;
    onStop?: () => void;
    onRestart?: () => void;
    onSendCommand?: (command: string) => void;
}

const ServerConsole: React.FC<ServerConsoleProps> = ({ server, logs = [], stats, onStart, onStop, onRestart, onSendCommand }) => {
    const consoleEndRef = useRef<HTMLDivElement>(null);
    const [command, setCommand] = useState('');
    const effectiveStats: ServerStats = stats || {
        ramUsage: server?.ramUsage ?? 0,
        ramTotal: server?.ramLimit ?? 0,
        cpuLoad: 0,
        tps: null,
        status: (server?.status as ServerStats['status']) || 'OFFLINE',
    };

    useEffect(() => {
        consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs.length, server?.id]);

    const isOnline = server?.status === 'ONLINE';
    const isStarting = server?.status === 'STARTING';
    const isPreparing = server?.status === 'PREPARING';
    const ramPercent =
        effectiveStats.ramTotal > 0
            ? Math.min(100, (effectiveStats.ramUsage / effectiveStats.ramTotal) * 100)
            : 0;
    const tickTimeValue =
        typeof effectiveStats.tickTimeMs === 'number' ? effectiveStats.tickTimeMs : null;
    const tickDisplay = Number.isFinite(tickTimeValue) ? `${tickTimeValue!.toFixed(1)} ms` : '--';
    const tickPercent = tickTimeValue ? Math.min(100, (tickTimeValue / 50) * 100) : 0;
    const tickBarClass =
        tickTimeValue === null
            ? 'bg-zinc-600'
            : tickTimeValue < 25
            ? 'bg-emerald-400'
            : tickTimeValue < 40
            ? 'bg-yellow-400'
            : 'bg-red-400';
    const statusColor =
        effectiveStats.status === 'ONLINE'
            ? 'text-emerald-400'
            : effectiveStats.status === 'STARTING'
            ? 'text-yellow-300'
            : effectiveStats.status === 'PREPARING'
            ? 'text-sky-300'
            : effectiveStats.status === 'ERROR'
            ? 'text-red-400'
            : effectiveStats.status === 'MAINTENANCE'
            ? 'text-red-400'
            : 'text-text-muted';
    const statusDotClass =
        effectiveStats.status === 'ONLINE'
            ? 'bg-emerald-500'
            : effectiveStats.status === 'STARTING'
            ? 'bg-yellow-400'
            : effectiveStats.status === 'PREPARING'
            ? 'bg-sky-400'
            : effectiveStats.status === 'ERROR'
            ? 'bg-red-500'
            : effectiveStats.status === 'MAINTENANCE'
            ? 'bg-red-500'
            : 'bg-zinc-500';

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const value = command.trim();
        if (!value) return;
        onSendCommand?.(value);
        setCommand('');
    };

    const renderBadge = (message: string, level: LogLevel) => {
        const lower = message.toLowerCase();

        // Detect the Minecraft "server ready" line, e.g.
        // "Done (5.23s)! For help, type "help""
        const isMcReady =
            lower.includes('done (') || lower.includes('for help, type "help"');

        // PREP
        if (lower.includes('[prep]')) {
            return (
                <span className="mr-2 text-[10px] font-semibold text-primary">
                    [PREP]
                </span>
            );
        }

        // SUCCESS:
        //  - explicit [SUCCESS] prefix
        //  - our "Completed. Ready to start." message
        //  - Minecraft "Done (...)! For help, type "help"" line when server is ready
        if (
            lower.includes('[success]') ||
            lower.includes('completed. ready to start') ||
            isMcReady
        ) {
            return (
                <span className="mr-2 text-[10px] font-semibold text-emerald-300">
                    [SUCCESS]
                </span>
            );
        }

        // FAIL
        if (lower.includes('fail') || lower.includes('error')) {
            return (
                <span className="mr-2 text-[10px] font-semibold text-red-300">
                    [FAIL]
                </span>
            );
        }

        // COMMAND
        if (message.trim().startsWith('>')) {
            return (
                <span className="mr-2 text-[10px] font-semibold text-blue-200">
                    [CMD]
                </span>
            );
        }

        // Default → INFO
        return (
            <span className="mr-2 text-[10px] font-semibold text-text-muted">
                [INFO]
            </span>
        );
    };

    const stripPrefixes = (message: string) => {
        return message
            .replace(/^\[info\]\s*/i, '')
            .replace(/^\[prep\]\s*/i, '')
            .replace(/^\[success\]\s*/i, '')
            .replace(/^\[fail\]\s*/i, '')
            .replace(/^\[cmd\]\s*/i, '')
            .trim();
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
            <div className="flex justify-between items-center mb-3">
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
                    <button
                        onClick={() => (isOnline ? onRestart?.() : onStart?.())}
                        disabled={!server || isStarting || isPreparing}
                        className="flex items-center gap-2 px-4 py-2 bg-bg-surface hover:bg-bg-hover text-white rounded-lg border border-border-main transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {isOnline ? <RefreshCw size={16} /> : <Play size={16} />} <span className="hidden sm:inline">{isOnline ? 'Restart' : 'Start'}</span>
                    </button>
                    <button
                        onClick={() => onStop?.()}
                        disabled={!server || (!isOnline && !isStarting)}
                        className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded-lg border border-red-500/20 transition-colors shadow-sm shadow-red-900/10 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        <Square size={16} fill="currentColor" /> <span className="hidden sm:inline">Stop</span>
                    </button>
                </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                {/* RAM Card */}
                <div className="glass-panel p-5 rounded-2xl relative overflow-hidden group">
                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-primary/20 rounded-full blur-2xl group-hover:bg-primary/30 transition-all"></div>
                    <div className="relative z-10">
                        <div className="text-text-muted text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                            <HardDrive size={14} /> RAM Usage
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-white">
                                {Number.isFinite(effectiveStats.ramUsage)
                                    ? effectiveStats.ramUsage.toFixed(1)
                                    : '0.0'}
                            </span>
                            <span className="text-sm text-text-muted">/ {effectiveStats.ramTotal} GB</span>
                        </div>
                        <div className="w-full bg-bg-body/50 h-1.5 mt-4 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-gradient-to-r from-primary to-purple-400 transition-all duration-500 shadow-[0_0_10px_rgba(139,92,246,0.5)]" 
                                style={{ width: `${ramPercent}%` }}
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
                            <span className="text-3xl font-bold text-white">
                                {Number.isFinite(effectiveStats.cpuLoad)
                                    ? effectiveStats.cpuLoad.toFixed(0)
                                    : '0'}
                            </span>
                            <span className="text-sm text-text-muted">%</span>
                        </div>
                        <div className="w-full bg-bg-body/50 h-1.5 mt-4 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-gradient-to-r from-accent to-blue-400 transition-all duration-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]" 
                                style={{ width: `${effectiveStats.cpuLoad}%` }}
                            ></div>
                        </div>
                    </div>
                </div>

                {/* Status Card */}
                <div className="glass-panel p-5 rounded-2xl relative overflow-hidden flex flex-col justify-center">
                    <div className="flex justify-between items-center">
                        <div>
                             <div className="text-text-muted text-xs font-bold uppercase tracking-wider mb-1">Status</div>
                             <div className={`text-xl font-bold flex items-center gap-2 ${statusColor}`}>
                                <span className="relative flex h-2.5 w-2.5">
                                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusDotClass}`}></span>
                                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${statusDotClass}`}></span>
                                </span>
                                {effectiveStats.status}
                            </div>
                        </div>
                    </div>
                    <div className="mt-4">
                        <div className="flex items-center justify-between text-[11px] text-text-muted">
                            <span>Tick Time</span>
                            <span className="text-white">{tickDisplay}</span>
                        </div>
                        <div className="w-full bg-bg-body/50 h-1.5 mt-2 rounded-full overflow-hidden">
                            <div
                                className={`h-full transition-all duration-500 ${tickBarClass}`}
                                style={{ width: `${tickPercent}%` }}
                            ></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Console Window */}
            <div className="h-[45vh] min-h-[260px] bg-bg-console border border-border-main rounded-xl flex flex-col relative group shadow-2xl overflow-hidden">
                {/* Console Header */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/5 backdrop-blur">
                    <div className="flex gap-2">
                         <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
                         <div className="w-3 h-3 rounded-full bg-yellow-500/50"></div>
                         <div className="w-3 h-3 rounded-full bg-emerald-500/50"></div>
                    </div>
                </div>

                {/* Log Output */}
                <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-5 console-scrollbar space-y-1">
                    {logs.map((log) => (
                        <div key={log.id} className="break-all font-medium">
                            <span className="text-text-dim select-none mr-2">{log.timestamp}</span>
                            {renderBadge(log.message, log.level)}
                            <span className="text-gray-300 whitespace-pre-wrap">{stripPrefixes(log.message)}</span>
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
            <form className="mt-3 relative" onSubmit={handleSubmit}>
                <ChevronRight className="absolute left-4 top-1/2 -translate-y-1/2 text-accent" size={18} />
                <input 
                    type="text" 
                    placeholder={server ? 'Enter command...' : 'Start a server to send commands'}
                    value={command}
                    disabled={!server}
                    onChange={(e) => setCommand(e.target.value)}
                    className="w-full bg-bg-console/80 border border-white/15 rounded-xl py-3 pl-10 pr-4 text-accent font-mono text-sm focus:outline-none focus:border-accent/70 focus:ring-1 focus:ring-accent/50 transition-all placeholder:text-text-dim disabled:opacity-60 disabled:cursor-not-allowed caret-accent"
                />
            </form>
        </div>
    );
};

export default ServerConsole;
