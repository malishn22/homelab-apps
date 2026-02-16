import React from 'react';
import { getWhitelistDefaults, saveWhitelistDefaults } from '../api/settings';
import SettingsEditor from './SettingsEditor';

const SettingsWhitelistDefaults: React.FC = () => (
  <SettingsEditor
    title="Whitelist defaults"
    description={
      <p>
        Players added here are merged into every server&apos;s whitelist.json on install and start.
        Requires white-list=true in server defaults. Format: JSON array of {`{"uuid":"...","name":"..."}`}.
        Find your UUID at{' '}
        <a
          href="https://mcuuid.net"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          mcuuid.net
        </a>
      </p>
    }
    placeholder='[{"uuid":"your-uuid-here","name":"YourUsername"}]'
    emptyDefault="[]"
    loadFn={getWhitelistDefaults}
    saveFn={saveWhitelistDefaults}
  />
);

export default SettingsWhitelistDefaults;
