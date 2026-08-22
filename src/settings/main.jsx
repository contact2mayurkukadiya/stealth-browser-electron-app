import React from 'react';
import { createRoot } from 'react-dom/client';
import SettingsApp from './SettingsApp';
import { bootstrapVirtualInput } from '../input/bootstrapVirtualInput.js';

bootstrapVirtualInput();
const container = document.getElementById('settings-root');
createRoot(container).render(<SettingsApp />);
