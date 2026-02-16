import React from 'react';
import { getOpsDefaults, saveOpsDefaults } from '../api/settings';
import SettingsEditor from './SettingsEditor';

const SettingsOpsDefaults: React.FC = () => (
  <SettingsEditor
    title="Ops defaults"
    description={
      <p>
        Operators added here are merged into every server&apos;s ops.json on install and start.
        Format: JSON array of {`{"uuid":"...","name":"...","level":4,"bypassesPlayerLimit":false}`}.
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
    placeholder='[{"uuid":"your-uuid-here","name":"YourUsername","level":4}]'
    emptyDefault="[]"
    loadFn={getOpsDefaults}
    saveFn={saveOpsDefaults}
  />
);

export default SettingsOpsDefaults;
