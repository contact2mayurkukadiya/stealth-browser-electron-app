import React from 'react';
import { createRoot } from 'react-dom/client';
import SettingsApp from './SettingsApp';

const container = document.getElementById('settings-root');
createRoot(container).render(<SettingsApp />);
