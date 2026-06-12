import React from 'react';
import './omnibox.css';
import { useOmniboxController } from './useOmniboxController.js';
import OmniboxBar from './OmniboxBar.jsx';

export default function OmniboxInput({ currentTabId, tabsData, searchEngine = 'google' }) {
  const controller = useOmniboxController({ currentTabId, tabsData, searchEngine });
  return <OmniboxBar {...controller} />;
}
