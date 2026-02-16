import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import FormField from './FormField';

const INPUT_CLASSES =
    'flex-1 min-w-0 bg-transparent px-3 py-2 text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0';

const BUTTON_CLASSES =
    'flex flex-1 min-h-0 items-center justify-center w-10 text-text-muted hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-l border-border-main';

export interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
    label?: string;
}

const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
    ({ label, value, onChange, min, max, step = 1, className = '', disabled, ...rest }, ref) => {
        const numValue = typeof value === 'string' ? parseFloat(value) : Number(value);
        const isValidNum = !Number.isNaN(numValue);

        const clamp = (v: number): number => {
            let result = v;
            if (typeof min === 'number' && !Number.isNaN(min)) result = Math.max(min, result);
            if (typeof max === 'number' && !Number.isNaN(max)) result = Math.min(max, result);
            return result;
        };

        const handleIncrement = () => {
            const base = isValidNum ? numValue : (typeof min === 'number' ? min : 0);
            const next = clamp(base + (typeof step === 'number' ? step : 1));
            onChange?.({ target: { value: String(next) } } as React.ChangeEvent<HTMLInputElement>);
        };

        const handleDecrement = () => {
            const base = isValidNum ? numValue : (typeof max === 'number' ? max : 0);
            const next = clamp(base - (typeof step === 'number' ? step : 1));
            onChange?.({ target: { value: String(next) } } as React.ChangeEvent<HTMLInputElement>);
        };

        const wrapper = (
            <div
                className={`flex rounded-lg border border-border-main bg-bg-surface/80 overflow-hidden focus-within:border-primary focus-within:ring-1 focus-within:ring-primary ${className}`}
            >
                <input
                    ref={ref}
                    type="number"
                    value={value}
                    onChange={onChange}
                    min={min}
                    max={max}
                    step={step}
                    disabled={disabled}
                    className={INPUT_CLASSES}
                    {...rest}
                />
                <div className="flex flex-col shrink-0">
                    <button
                        type="button"
                        onClick={handleIncrement}
                        disabled={disabled}
                        className={`${BUTTON_CLASSES} rounded-tr-lg`}
                        tabIndex={-1}
                        aria-label="Increment"
                    >
                        <ChevronUp size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={handleDecrement}
                        disabled={disabled}
                        className={`${BUTTON_CLASSES} rounded-br-lg border-t border-border-main`}
                        tabIndex={-1}
                        aria-label="Decrement"
                    >
                        <ChevronDown size={16} />
                    </button>
                </div>
            </div>
        );
        return label ? <FormField label={label}>{wrapper}</FormField> : wrapper;
    }
);

NumberInput.displayName = 'NumberInput';

export default NumberInput;
