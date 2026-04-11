import React, { useRef, useCallback, useMemo, useState, useEffect, useLayoutEffect } from 'react';
import { useSelector } from 'react-redux';
import { useTabOverlay } from '../context/TabOverlayContext';
import Tab from './Tab';
import ContextMenu from './ContextMenu';

const ADD_ICON = (
  <svg width={15} height={15} viewBox="0 0 640 640">
    <path fill="white" d="M352 128C352 110.3 337.7 96 320 96C302.3 96 288 110.3 288 128L288 288L128 288C110.3 288 96 302.3 96 320C96 337.7 110.3 352 128 352L288 352L288 512C288 529.7 302.3 544 320 544C337.7 544 352 529.7 352 512L352 352L512 352C529.7 352 544 337.7 544 320C544 302.3 529.7 288 512 288L352 288L352 128z" />
  </svg>
);

export default function TabBar({ onNewTab, onCloseTab, onSwitchTab, onDragEnd, getTabContextMenuItems }) {
  const { beginOverlay, endOverlay } = useTabOverlay();
  const tabOrder = useSelector(s => s.browser.tabOrder);
  const tabs = useSelector(s => s.browser.tabs);
  const currentTabId = useSelector(s => s.browser.currentTabId);

  const [tabContextMenu, setTabContextMenu] = useState(null);
  const tabBarRef = useRef(null);

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

  const platform = window.electronAPI?.platform;
  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';
  const isActiveTabStealth = !!tabs[currentTabId]?.isStealth;

  const pinnedTabCount = useMemo(
    () => tabOrder.filter((tid) => tabs[tid]?.isPinned).length,
    [tabOrder, tabs],
  );

  const handleTabContextMenuOpen = useCallback(async (e, tabId) => {
    if (!getTabContextMenuItems) return;
    const menuApproxHeight = 320;
    const menuApproxWidth = 220;
    let x = e.clientX;
    let y = e.clientY;
    x = Math.max(8, Math.min(x, window.innerWidth - menuApproxWidth - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - menuApproxHeight - 8));
    await beginOverlay();
    setTabContextMenu({ tabId, x, y });
  }, [getTabContextMenuItems, beginOverlay]);

  useEffect(() => {
    if (!tabContextMenu) return undefined;
    const closeMenu = () => setTabContextMenu(null);
    const closeMenuOnShortcut = (event) => {
      const pressedModifier = event.metaKey || event.ctrlKey || event.altKey;
      const pressedOnlyModifier = ['Meta', 'Control', 'Alt', 'Shift'].includes(event.key);
      if (pressedModifier && !pressedOnlyModifier) {
        closeMenu();
      }
    };

    // Keep menu behavior stable: resizing or losing focus should close it,
    // which also restores the hidden active WebContentsView.
    window.addEventListener('resize', closeMenu);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('keydown', closeMenuOnShortcut, true);
    window.addEventListener('electron-shortcut-invoked', closeMenu);

    return () => {
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('keydown', closeMenuOnShortcut, true);
      window.removeEventListener('electron-shortcut-invoked', closeMenu);
      endOverlay();
    };
  }, [tabContextMenu, endOverlay]);

  useEffect(() => {
    if (!tabContextMenu) return;
    setTabContextMenu(null);
  }, [currentTabId, tabOrder.length]); // Close menu on tab switch/create/close changes.

  const tabContextMenuItems = useMemo(() => {
    if (!tabContextMenu?.tabId || !getTabContextMenuItems) return [];
    return getTabContextMenuItems(tabContextMenu.tabId);
  }, [tabContextMenu, getTabContextMenuItems]);

  useLayoutEffect(() => {
    const tabBarEl = tabBarRef.current;
    if (!tabBarEl) return undefined;

    const syncActiveSlider = () => {
      const activeTabEl = tabBarEl.querySelector('.tab.active');
      if (!activeTabEl) {
        tabBarEl.style.setProperty('--active-width', '0px');
        return;
      }

      tabBarEl.style.setProperty('--active-left', `${activeTabEl.offsetLeft}px`);
      tabBarEl.style.setProperty('--active-width', `${activeTabEl.offsetWidth}px`);
    };

    syncActiveSlider();

    const resizeObserver = new ResizeObserver(syncActiveSlider);
    resizeObserver.observe(tabBarEl);
    tabBarEl.querySelectorAll('.tab').forEach((tabEl) => resizeObserver.observe(tabEl));

    window.addEventListener('resize', syncActiveSlider);
    // Tab drag updates can finish before React paints; one extra frame keeps alignment stable.
    const rafId = window.requestAnimationFrame(syncActiveSlider);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', syncActiveSlider);
      resizeObserver.disconnect();
    };
  }, [tabOrder, tabs, currentTabId]);

  return (
    <div
      ref={tabBarRef}
      className={`tab-bar${isMac ? ' tab-bar--mac' : ''}${isWin ? ' tab-bar--win' : ''}${isActiveTabStealth ? ' tab-bar--active-stealth' : ''}`}
    >
      <div className="tab-active-slider" aria-hidden />
      {tabOrder.map(id => (
        <Tab
          key={id}
          id={id}
          tab={tabs[id]}
          isActive={id === currentTabId}
          pinnedTabCount={pinnedTabCount}
          onClose={() => onCloseTab(id)}
          onSwitch={onSwitchTab}
          onDragEnd={onDragEnd}
          onHoverEnter={handleTabHoverEnter}
          onHoverLeave={hideTooltip}
          onHideTooltip={hideTooltip}
          onContextMenu={getTabContextMenuItems ? handleTabContextMenuOpen : undefined}
        />
      ))}
      <button id="add-tab" className="btn" onClick={() => onNewTab(false)}>
        {ADD_ICON}
      </button>
      {tabContextMenu && (
        <ContextMenu
          items={tabContextMenuItems}
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          variant="tab"
          onClose={() => setTabContextMenu(null)}
        />
      )}
    </div>
  );
}
