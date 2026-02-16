import React from 'react';
import FormField from './FormField';

const BASE_CLASSES =
    'w-full rounded-lg bg-bg-surface/80 border border-border-main px-3 py-2 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary';

const NUMBER_CLASSES =
    'appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
    label?: string;
    type?: 'text' | 'number';
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ label, type = 'text', className = '', ...rest }, ref) => {
        const input = (
            <input
                ref={ref}
                type={type}
                className={`${BASE_CLASSES} ${type === 'number' ? NUMBER_CLASSES : ''} ${className}`}
                {...rest}
            />
        );
        return label ? <FormField label={label}>{input}</FormField> : input;
    }
);

Input.displayName = 'Input';

export default Input;
