import React from 'react';
import FormField from './FormField';

const BASE_CLASSES =
    'bg-bg-surface/60 border border-border-main rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary';

export interface SelectOption {
    value: string;
    label: string;
}

export interface SelectProps {
    options: SelectOption[];
    value: string;
    onChange: (value: string) => void;
    label?: string;
    className?: string;
}

const Select: React.FC<SelectProps> = ({
    options,
    value,
    onChange,
    label,
    className = '',
}) => {
    const select = (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`${BASE_CLASSES} ${className}`}
        >
            {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                    {opt.label}
                </option>
            ))}
        </select>
    );
    return label ? <FormField label={label}>{select}</FormField> : select;
};

export default Select;
