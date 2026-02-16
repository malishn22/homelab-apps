import React from 'react';
import FormField from './FormField';

const BASE_CLASSES =
    'w-full px-4 py-3 rounded-lg bg-bg-surface border border-white/10 text-white resize-y focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 placeholder:text-text-dim';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: string;
    mono?: boolean;
}

const Textarea: React.FC<TextareaProps> = ({
    label,
    mono = true,
    className = '',
    ...rest
}) => {
    const textarea = (
        <textarea
            className={`${BASE_CLASSES} ${mono ? 'text-sm font-mono' : ''} ${className}`}
            {...rest}
        />
    );
    return label ? <FormField label={label}>{textarea}</FormField> : textarea;
};

export default Textarea;
