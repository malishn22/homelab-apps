import React from 'react';
import { getServerDefaults, saveServerDefaults } from '../api/settings';
import SettingsEditor from './SettingsEditor';

const SettingsServerDefaults: React.FC = () => (
  <SettingsEditor
    title="Server defaults"
    description={
      <p>
        Applied to all servers on install and start. Use key=value format. Recommended: server-ip= and white-list=true
      </p>
    }
    placeholder={'server-ip=\nwhite-list=true'}
    textareaHeight="h-64"
    emptyDefault=""
    loadFn={getServerDefaults}
    saveFn={saveServerDefaults}
  />
);

export default SettingsServerDefaults;
