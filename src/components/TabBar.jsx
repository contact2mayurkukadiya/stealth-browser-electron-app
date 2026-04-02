import React, { useRef, useCallback } from 'react';
import { useSelector } from 'react-redux';
import Tab from './Tab';

const ADD_ICON = (
  <svg width={15} height={15} viewBox="0 0 640 640">
    <path fill="white" d="M352 128C352 110.3 337.7 96 320 96C302.3 96 288 110.3 288 128L288 288L128 288C110.3 288 96 302.3 96 320C96 337.7 110.3 352 128 352L288 352L288 512C288 529.7 302.3 544 320 544C337.7 544 352 529.7 352 512L352 352L512 352C529.7 352 544 337.7 544 320C544 302.3 529.7 288 512 288L352 288L352 128z" />
  </svg>
);

export default function TabBar({ onNewTab, onCloseTab, onSwitchTab, onDragEnd }) {
  const tabOrder = useSelector(s => s.browser.tabOrder);
  const tabs = useSelector(s => s.browser.tabs);
  const currentTabId = useSelector(s => s.browser.currentTabId);

  const hoverTimeoutRef = useRef(null);

  const hideTooltip = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    window.electronAPI.tooltipHide();
  }, []);

  const handleTabHoverEnter = useCallback((id, tabEl) => {
    if (window._draggingTabId) return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(async () => {
      if (window._draggingTabId) return;
      const info = await window.electronAPI.getTabInfo(id);
      if (!info || window._draggingTabId) return;
      const rect = tabEl.getBoundingClientRect();
      const tooltipWidth = 280;
      const tooltipHeight = 140;
      let left = rect.left + rect.width / 2 - tooltipWidth / 2;
      left = Math.max(10, Math.min(window.innerWidth - tooltipWidth - 10, left));
      window.electronAPI.tooltipShow({
        title: info.title || 'New Tab',
        url: info.url,
        memory: info.memory,
        x: left,
        y: rect.bottom + 8,
        width: tooltipWidth,
        height: tooltipHeight,
      });
    }, 500);
  }, []);

  return (
    <div className="tab-bar">
      {tabOrder.map(id => (
        <Tab
          key={id}
          id={id}
          tab={tabs[id]}
          isActive={id === currentTabId}
          onClose={() => onCloseTab(id)}
          onSwitch={onSwitchTab}
          onDragEnd={onDragEnd}
          onHoverEnter={handleTabHoverEnter}
          onHoverLeave={hideTooltip}
          onHideTooltip={hideTooltip}
        />
      ))}
      <button id="add-tab" className="btn" onClick={() => onNewTab(false)}>
        {ADD_ICON}
      </button>
    </div>
  );
}
