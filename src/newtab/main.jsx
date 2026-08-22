import React from 'react';
import { createRoot } from 'react-dom/client';
import NewTabApp from './NewTabApp';
import { bootstrapVirtualInput } from '../input/bootstrapVirtualInput.js';

bootstrapVirtualInput();
createRoot(document.getElementById('newtab-root')).render(<NewTabApp />);
