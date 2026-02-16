import React from 'react';
import SettingsServerDefaults from '../components/SettingsServerDefaults';
import SettingsWhitelistDefaults from '../components/SettingsWhitelistDefaults';
import SettingsOpsDefaults from '../components/SettingsOpsDefaults';

const SettingsView: React.FC = () => (
    <div className="flex flex-col items-center gap-12 h-full text-text-muted animate-[fadeIn_0.5s_ease-out] pt-4 pb-12">
        <SettingsServerDefaults />
        <SettingsWhitelistDefaults />
        <SettingsOpsDefaults />
    </div>
);

export default SettingsView;
