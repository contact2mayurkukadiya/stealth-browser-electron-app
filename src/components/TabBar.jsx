import React, { useRef, useCallback, useMemo, useState, useLayoutEffect } from 'react';
import { useSelector } from 'react-redux';
import Tab from './Tab';
import { tabAddSvg } from '../constants/appAssetUrls';
import { PLATFORM } from '../constants/conditionStrings.js';

const ADD_ICON = <img className="chrome-toolbar-icon-img" src={tabAddSvg} width={25} height={25} alt="" />;
const TAB_DISPLAY_MODE = {
  FULL: 'full',
  ICON_ONLY: 'icon-only',
  EXTREME_OVERFLOW: 'extreme-overflow',
};

const TAB_WIDTH_THRESHOLDS = {
  full: 60,
  iconOnly: 28,
};

function getTabDisplayMode(tabWidth) {
  if (tabWidth >= TAB_WIDTH_THRESHOLDS.full) return TAB_DISPLAY_MODE.FULL;
  if (tabWidth >= TAB_WIDTH_THRESHOLDS.iconOnly) return TAB_DISPLAY_MODE.ICON_ONLY;
  return TAB_DISPLAY_MODE.EXTREME_OVERFLOW;
}

export default function TabBar({
  isGhostWindow = false,
  onNewTab,
  onCloseTab,
  onSwitchTab,
  onDragEnd,
  onTabStripContextMenu,
}) {
  const tabOrder = useSelector(s => s.browser.tabOrder);
  const tabs = useSelector(s => s.browser.tabs);
  const currentTabId = useSelector(s => s.browser.currentTabId);

  const [tabDisplayModes, setTabDisplayModes] = useState({});
  const tabTrackRef = useRef(null);

  const hoverTimeoutRef = useRef(null);

  const hideTooltip = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    window.electronAPI.tooltipHide();
  }, []);

  const handleGhostDragMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, .tab, input')) return;

    e.preventDefault();

    let lastX = e.screenX;
    let lastY = e.screenY;

    const onMouseMove = (moveEvent) => {
      const deltaX = moveEvent.screenX - lastX;
      const deltaY = moveEvent.screenY - lastY;
      lastX = moveEvent.screenX;
      lastY = moveEvent.screenY;
      if (deltaX !== 0 || deltaY !== 0) {
        window.electronAPI?.ghostDrag?.(deltaX, deltaY);
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
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

  const platform = window.electronAPI?.platform;
  const isMac = platform === PLATFORM.DARWIN;
  const isWin = platform === PLATFORM.WIN32;
  const pinnedTabCount = useMemo(
    () => tabOrder.filter((tid) => tabs[tid]?.isPinned).length,
    [tabOrder, tabs],
  );

  useLayoutEffect(() => {
    const tabTrackEl = tabTrackRef.current;
    if (!tabTrackEl) return undefined;

    const syncDisplayModes = () => {
      const tabElements = tabTrackEl.querySelectorAll('.tab');
      if (tabElements.length === 0) return;

      const nextModes = {};
      tabElements.forEach((tabEl) => {
        nextModes[tabEl.id] = getTabDisplayMode(tabEl.offsetWidth);
      });
      setTabDisplayModes((prevModes) => {
        const prevKeys = Object.keys(prevModes);
        const nextKeys = Object.keys(nextModes);
        if (prevKeys.length !== nextKeys.length) return nextModes;
        for (const key of nextKeys) {
          if (prevModes[key] !== nextModes[key]) return nextModes;
        }
        return prevModes;
      });
    };

    syncDisplayModes();

    const resizeObserver = new ResizeObserver(syncDisplayModes);
    resizeObserver.observe(tabTrackEl);

    window.addEventListener('resize', syncDisplayModes);

    return () => {
      window.removeEventListener('resize', syncDisplayModes);
      resizeObserver.disconnect();
    };
  }, [tabOrder]);

  return (
    <div
      className={`tab-bar${isMac ? ' tab-bar--mac' : ''}${isWin ? ' tab-bar--win' : ''}${isGhostWindow ? ' tab-bar--ghost' : ''}`}
      onMouseDown={isGhostWindow ? handleGhostDragMouseDown : undefined}
    >
      {isGhostWindow && !isMac && (
        <div className="ghost-badge ghost-badge--left" title="Ghost Window: Non-activating floating browser">
          <span className="ghost-badge-dot" />
          <span>Ghost</span>
        </div>
      )}
      <div className="tab-container">
        <div ref={tabTrackRef} className="tab-track">
          {tabOrder.map(id => (
            <Tab
              key={id}
              id={id}
              tab={tabs[id]}
              isActive={id === currentTabId}
              displayMode={tabDisplayModes[id] || TAB_DISPLAY_MODE.FULL}
              pinnedTabCount={pinnedTabCount}
              onClose={() => onCloseTab(id)}
              onSwitch={onSwitchTab}
              onDragEnd={onDragEnd}
              onHoverEnter={handleTabHoverEnter}
              onHoverLeave={hideTooltip}
              onHideTooltip={hideTooltip}
              onContextMenu={onTabStripContextMenu ? (e) => onTabStripContextMenu(e, id) : undefined}
            />
          ))}
        </div>
      </div>
      <button id="add-tab" className="btn" onClick={() => onNewTab()}>
        {ADD_ICON}
      </button>
      {isGhostWindow && isMac && (
        <div className="ghost-badge ghost-badge--right" title="Ghost Window: Non-activating floating browser">
          <span className="ghost-badge-dot" />
          <span>Ghost</span>
        </div>
      )}
    </div>
  );
}
