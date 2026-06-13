import React from 'react';
import './omnibox.css';
import { useOmniboxController } from './useOmniboxController.js';
import OmniboxBar from './OmniboxBar.jsx';
import { useSelector } from 'react-redux';

export default function OmniboxInput({ currentTabId, tabsData }) {
  const searchEngine = useSelector((state) => state?.browser?.searchEngine || 'google');
  const controller = useOmniboxController({ currentTabId, tabsData, searchEngine });
  return <OmniboxBar {...controller} />;
}
