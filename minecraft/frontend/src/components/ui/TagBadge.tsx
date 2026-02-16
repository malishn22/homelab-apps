import React from 'react';

export type TagBadgeVariant = 'primary' | 'muted' | 'multi';

const VARIANT_CLASSES: Record<TagBadgeVariant, string> = {
    primary: 'bg-primary/10 border border-primary/20 text-primary',
    muted: 'bg-white/5 text-text-muted',
    multi: 'bg-blue-500/15 border border-blue-400/30 text-blue-200',
};

const SIZE_CLASSES = {
    sm: 'px-2 py-0.5 text-[10px] rounded',
    md: 'px-3 py-1 text-xs rounded-full',
};

export interface TagBadgeProps {
    children: React.ReactNode;
    icon?: React.ReactNode;
    variant?: TagBadgeVariant;
    size?: 'sm' | 'md';
}

const TagBadge: React.FC<TagBadgeProps> = ({
    children,
    icon,
    variant = 'primary',
    size = 'md',
}) => {
    const baseClasses = 'inline-flex items-center gap-1 uppercase tracking-wider';
    const variantClasses = VARIANT_CLASSES[variant];
    const sizeClasses = SIZE_CLASSES[size];
    const mutedBorder =
        variant === 'muted' ? (size === 'sm' ? 'border border-white/5' : 'border border-white/10') : '';

    return (
        <span
            className={`${baseClasses} ${variantClasses} ${sizeClasses} ${mutedBorder}`}
        >
            {icon}
            {children}
        </span>
    );
};

export default TagBadge;
