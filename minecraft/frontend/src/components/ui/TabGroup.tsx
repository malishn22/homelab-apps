import React from 'react';

export interface TabOption {
    key: string;
    label: string;
    icon?: React.ReactNode;
}

export interface TabGroupProps {
    options: TabOption[];
    value: string;
    onChange: (key: string) => void;
    variant?: 'segmented' | 'pills';
}

const TabGroup: React.FC<TabGroupProps> = ({
    options,
    value,
    onChange,
    variant = 'segmented',
}) => {
    if (variant === 'segmented') {
        return (
            <div className="flex rounded-lg border border-white/5 overflow-hidden bg-white/5">
                {options.map((opt) => {
                    const isActive = value === opt.key;
                    return (
                        <button
                            key={opt.key}
                            onClick={() => onChange(opt.key)}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                                isActive ? 'bg-white/10 text-white' : 'text-text-muted hover:text-white'
                            }`}
                        >
                            {opt.icon}
                            {opt.label}
                        </button>
                    );
                })}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {options.map((opt) => {
                const isActive = value === opt.key;
                return (
                    <button
                        key={opt.key}
                        onClick={() => onChange(opt.key)}
                        className={`w-full text-left px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                            isActive
                                ? 'border-primary/60 bg-primary/15 text-primary shadow-[0_0_0_1px_rgba(129,140,248,0.25)]'
                                : 'border-border-main bg-bg-surface/60 text-text-muted hover:border-primary/30 hover:text-white'
                        }`}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
};

export default TabGroup;
