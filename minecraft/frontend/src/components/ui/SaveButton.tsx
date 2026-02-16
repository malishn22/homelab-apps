import React from 'react';
import { Check, Loader2, AlertCircle, Save } from 'lucide-react';
import Button from './Button';

export interface SaveButtonProps {
    onClick: () => void;
    disabled?: boolean;
    saving?: boolean;
    saved?: boolean;
    error?: string | null;
    children?: React.ReactNode;
}

const SaveButton: React.FC<SaveButtonProps> = ({
    onClick,
    disabled = false,
    saving = false,
    saved = false,
    error = null,
    children = 'Save',
}) => (
    <div className="flex items-center gap-3">
        <Button
            variant="primary"
            onClick={onClick}
            disabled={disabled || saving}
            loading={saving}
            icon={!saving ? <Save size={18} /> : undefined}
        >
            {saving ? 'Saving...' : children}
        </Button>
        {saved && (
            <span className="flex items-center gap-1 text-sm text-emerald-400">
                <Check size={16} />
                Saved
            </span>
        )}
        {error && (
            <span className="flex items-center gap-1 text-sm text-red-400" title={error}>
                <AlertCircle size={16} />
                {error}
            </span>
        )}
    </div>
);

export default SaveButton;
