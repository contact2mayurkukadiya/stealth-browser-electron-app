import React from 'react';
import { createRoot } from 'react-dom/client';
import HistoryApp from './HistoryApp';
import { bootstrapVirtualInput } from '../input/bootstrapVirtualInput.js';

bootstrapVirtualInput();
const container = document.getElementById('history-root');
createRoot(container).render(<HistoryApp />);
