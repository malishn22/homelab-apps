import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
    primary:
        'rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed',
    secondary:
        'rounded-lg border border-border-main text-text-muted hover:text-white hover:border-white/40 transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none',
    ghost:
        'rounded-lg text-text-muted hover:text-white hover:bg-white/5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none',
    danger:
        'rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
    success:
        'rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    loading?: boolean;
    icon?: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
    variant = 'primary',
    loading = false,
    icon,
    disabled,
    className = '',
    children,
    ...rest
}) => {
    const baseClasses = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[2.25rem] transition-colors';
    const variantClasses = VARIANT_CLASSES[variant];
    const isDisabled = disabled || loading;

    return (
        <button
            className={`${baseClasses} ${variantClasses} ${className}`}
            disabled={isDisabled}
            {...rest}
        >
            {loading ? (
                <>
                    <Loader2 size={18} className="animate-spin shrink-0" />
                    {children ?? 'Loading...'}
                </>
            ) : (
                <>
                    {icon}
                    {children}
                </>
            )}
        </button>
    );
};

export default Button;
