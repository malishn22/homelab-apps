import React from 'react';

export interface FormFieldProps {
    label: string;
    children: React.ReactNode;
}

const FormField: React.FC<FormFieldProps> = ({ label, children }) => (
    <div className="space-y-2">
        <label className="text-xs text-text-dim block">{label}</label>
        {children}
    </div>
);

export default FormField;
