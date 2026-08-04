import React from 'react';
import { createRoot } from 'react-dom/client';
import BookmarkApp from './BookmarkApp';

const container = document.getElementById('bookmark-root');
createRoot(container).render(<BookmarkApp />);