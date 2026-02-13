import React from 'react';

interface RamSliderProps {
    /** Value in GB (1–12) */
    value: number;
    /** Called with value in GB */
    onChange: (valueGb: number) => void;
    min?: number;
    max?: number;
    step?: number;
    /** Optional label above the slider */
    label?: string;
    /** Optional className for the wrapper */
    className?: string;
}

const RamSlider: React.FC<RamSliderProps> = ({
    value,
    onChange,
    min = 1,
    max = 12,
    step = 0.5,
    label,
    className = '',
}) => {
    const clamped = Math.max(min, Math.min(max, value));

    return (
        <div className={`space-y-2 ${className}`}>
            {label && (
                <label className="text-xs text-text-dim block">{label}</label>
            )}
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={clamped}
                onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
                className="w-full h-2 bg-black/40 rounded-lg appearance-none cursor-pointer accent-primary hover:accent-primary/80 transition-all"
            />
            <div className="flex justify-between text-xs text-gray-200 font-mono px-2 font-bold bg-white/10 rounded-b-lg py-1.5 mt-1 border-t border-white/5">
                <span>{min} GB</span>
                <span className="text-white">{clamped.toFixed(1)} GB</span>
                <span>{max} GB</span>
            </div>
        </div>
    );
};

export default RamSlider;
