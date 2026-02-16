/** Return Tailwind classes for the status indicator dot (ServerList cards). */
export const getStatusDotColor = (status: string): string => {
    switch (status) {
        case 'ONLINE': return 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]';
        case 'OFFLINE': return 'bg-zinc-500';
        case 'STARTING': return 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.4)]';
        case 'STOPPING': return 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.4)]';
        case 'RESTARTING': return 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.4)]';
        case 'PREPARING': return 'bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.4)]';
        case 'ERROR': return 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]';
        case 'MAINTENANCE': return 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]';
        default: return 'bg-zinc-500';
    }
};

/** Return the text color class for a status label (ServerConsole). */
export const getStatusTextColor = (status: string): string => {
    switch (status) {
        case 'ONLINE': return 'text-emerald-400';
        case 'STARTING': return 'text-yellow-300';
        case 'RESTARTING': return 'text-amber-400';
        case 'STOPPING': return 'text-amber-400';
        case 'PREPARING': return 'text-sky-300';
        case 'ERROR': return 'text-red-400';
        case 'MAINTENANCE': return 'text-red-400';
        default: return 'text-text-muted';
    }
};

/** Return the background color class for the animated status dot (ServerConsole). */
export const getStatusDotBgClass = (status: string): string => {
    switch (status) {
        case 'ONLINE': return 'bg-emerald-500';
        case 'STARTING': return 'bg-yellow-400';
        case 'RESTARTING': return 'bg-amber-500';
        case 'STOPPING': return 'bg-amber-500';
        case 'PREPARING': return 'bg-sky-400';
        case 'ERROR': return 'bg-red-500';
        case 'MAINTENANCE': return 'bg-red-500';
        default: return 'bg-zinc-500';
    }
};
