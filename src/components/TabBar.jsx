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

  const [isStuckToRight, setIsStuckToRight] = useState(false);
  const [tabWidth, setTabWidth] = useState(240);
  const tabBarRef = useRef(null);
  const tabTrackRef = useRef(null);
  const tabContainerRef = useRef(null);

  const hoverTimeoutRef = useRef(null);

  const hideTooltip = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    window.electronAPI.tooltipHide();
  }, []);

  const handleWheel = useCallback((e) => {
    hideTooltip();
    const container = tabContainerRef.current;
    if (!container) return;
    if (container.scrollWidth <= container.clientWidth) return;

    // Trackpad horizontal swipe (deltaX !== 0) is natively handled by Chromium with momentum.
    // Only convert pure vertical wheel (e.g. mouse wheel where deltaX === 0) to horizontal scroll.
    if (Math.abs(e.deltaX) === 0 && e.deltaY !== 0) {
      e.preventDefault();
      container.scrollLeft += e.deltaY;
    }
  }, [hideTooltip]);

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

  const updateTabWidth = useCallback(() => {
    const bar = tabBarRef.current;
    if (!bar) return;

    const computed = window.getComputedStyle(bar);
    const padLeft = parseFloat(computed.paddingLeft) || 0;
    const padRight = parseFloat(computed.paddingRight) || 0;
    const totalBarWidth = bar.clientWidth - padLeft - padRight;

    // Reserve space for #add-tab button (32px + 5px gap = 37px) + right window drag buffer (25px)
    const addTabSpace = 62;
    const maxAvailable = Math.max(100, totalBarWidth - addTabSpace);

    const unpinnedCount = tabOrder.length - pinnedTabCount;
    if (unpinnedCount <= 0) {
      setIsStuckToRight(false);
      setTabWidth(240);
      return;
    }

    // Pinned tabs take 42px each + 5px gap = 47px
    const pinnedSpace = pinnedTabCount * 47;
    // Gaps between unpinned tabs (5px each) + container left/right padding (20px)
    const gapsAndPadding = Math.max(0, (unpinnedCount - 1) * 5) + 20;

    // Total width if all unpinned tabs were at full preferred width (240px)
    const totalWidthAtFull = (unpinnedCount * 240) + pinnedSpace + gapsAndPadding;
    const shouldStick = totalWidthAtFull > maxAvailable;
    setIsStuckToRight(shouldStick);

    const availableForUnpinned = maxAvailable - pinnedSpace - gapsAndPadding;
    const idealWidth = availableForUnpinned / unpinnedCount;
    const nextWidth = Math.min(240, Math.max(28, Math.floor(idealWidth)));

    setTabWidth(nextWidth);

    // If total tabs now fit within container, reset scrollLeft so tabs align cleanly
    const container = tabContainerRef.current;
    if (container && (!shouldStick || container.scrollWidth <= container.clientWidth)) {
      container.scrollLeft = 0;
    }
  }, [tabOrder.length, pinnedTabCount]);

  useLayoutEffect(() => {
    updateTabWidth();

    const barEl = tabBarRef.current;
    if (!barEl) return undefined;

    const resizeObserver = new ResizeObserver(() => {
      updateTabWidth();
    });
    resizeObserver.observe(barEl);

    window.addEventListener('resize', updateTabWidth);

    return () => {
      window.removeEventListener('resize', updateTabWidth);
      resizeObserver.disconnect();
    };
  }, [updateTabWidth]);

  useLayoutEffect(() => {
    if (!currentTabId || !tabTrackRef.current) return;
    const activeTabEl = tabTrackRef.current.querySelector(`.tab[data-tab-id="${currentTabId}"]`);
    if (activeTabEl) {
      activeTabEl.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [currentTabId]);

  const displayMode = useMemo(() => {
    if (tabWidth >= 60) return TAB_DISPLAY_MODE.FULL;
    return TAB_DISPLAY_MODE.ICON_ONLY;
  }, [tabWidth]);

  return (
    <div
      ref={tabBarRef}
      className={`tab-bar${isMac ? ' tab-bar--mac' : ''}${isWin ? ' tab-bar--win' : ''}${isGhostWindow ? ' tab-bar--ghost' : ''}`}
      onMouseDown={isGhostWindow ? handleGhostDragMouseDown : undefined}
    >
      {isGhostWindow && !isMac && (
        <div className="ghost-badge ghost-badge--left" title="Ghost Window: Non-activating floating browser">
          <span className="ghost-badge-dot" />
          <span>Ghost</span>
        </div>
      )}
      <div
        ref={tabContainerRef}
        className={`tab-container${isStuckToRight ? ' tab-container--stuck' : ''}`}
        onWheel={handleWheel}
      >
        <div ref={tabTrackRef} className="tab-track" style={{ '--tab-width': `${tabWidth}px` }}>
          {tabOrder.map(id => (
            <Tab
              key={id}
              id={id}
              tab={tabs[id]}
              isActive={id === currentTabId}
              displayMode={displayMode}
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
