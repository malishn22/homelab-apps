import React from 'react';

export interface StatBadgeProps {
    label: string;
    value: React.ReactNode;
    icon: React.ReactNode;
}

const StatBadge: React.FC<StatBadgeProps> = ({ label, value, icon }) => (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10">
        <span className="text-accent shrink-0">{icon}</span>
        <div>
            <div className="text-[10px] uppercase tracking-wider text-text-dim">{label}</div>
            <div className="text-xs text-white">{value}</div>
        </div>
    </div>
);

export default StatBadge;
