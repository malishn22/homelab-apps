import React from 'react';
import { Flame, Gem, Zap } from 'lucide-react';
import type { ModpackSource } from '../types';

interface ModpackProviderBadgeProps {
    provider: ModpackSource;
    size?: number;
    className?: string;
}

const PROVIDER_CONFIG: Record<
    ModpackSource,
    { icon: React.ElementType; className: string }
> = {
    curseforge: {
        icon: Flame,
        className: 'bg-orange-500/15 border-orange-400/40 text-orange-200',
    },
    modrinth: {
        icon: Gem,
        className: 'bg-violet-500/15 border-violet-400/40 text-violet-200',
    },
    ftb: {
        icon: Zap,
        className: 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200',
    },
};

const ModpackProviderBadge: React.FC<ModpackProviderBadgeProps> = ({
    provider,
    size = 14,
    className = '',
}) => {
    const config = PROVIDER_CONFIG[provider] ?? PROVIDER_CONFIG.modrinth;
    const Icon = config.icon;

    return (
        <span
            className={`inline-flex items-center justify-center rounded-full border shrink-0 w-6 h-6 ${config.className} ${className}`}
            title={provider}
        >
            <Icon size={size} />
        </span>
    );
};

export default ModpackProviderBadge;
