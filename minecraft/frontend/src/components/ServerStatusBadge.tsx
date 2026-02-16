import React from 'react';
import { Check, X, Loader2 } from 'lucide-react';

export type ServerStatus = 'server' | 'client' | 'pending';

interface ServerStatusBadgeProps {
    status: ServerStatus;
    size?: number;
    className?: string;
}

const ServerStatusBadge: React.FC<ServerStatusBadgeProps> = ({
    status,
    size = 10,
    className = '',
}) => {
    const baseClasses = 'rounded-full flex items-center justify-center shrink-0';

    if (status === 'pending') {
        return (
            <span
                className={`${baseClasses} w-5 h-5 bg-white/10 border border-white/20 text-text-muted ${className}`}
                title="Checking…"
            >
                <Loader2 size={size} className="animate-spin" />
            </span>
        );
    }

    if (status === 'client') {
        return (
            <span
                className={`${baseClasses} w-5 h-5 bg-red-500/10 text-red-300 border border-red-500/30 ${className}`}
                title="Client only"
            >
                <X size={size} />
            </span>
        );
    }

    return (
        <span
            className={`${baseClasses} w-5 h-5 border border-emerald-500/50 text-emerald-300 bg-transparent ${className}`}
            title="Server pack available"
        >
            <Check size={size} strokeWidth={3} />
        </span>
    );
};

export default ServerStatusBadge;
