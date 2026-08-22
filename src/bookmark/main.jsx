import React from 'react';
import { createRoot } from 'react-dom/client';
import BookmarkApp from './BookmarkApp';
import { bootstrapVirtualInput } from '../input/bootstrapVirtualInput.js';

bootstrapVirtualInput();
const container = document.getElementById('bookmark-root');
createRoot(container).render(<BookmarkApp />);