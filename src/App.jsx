import React, { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  addTab, removeTab, setCurrentTab,
  reorderTabs, setTabNewTab,
} from './store/browserSlice';
import { setBookmarks } from './store/bookmarksSlice';
import { useElectronIPC } from './hooks/useElectronIPC';
import TabBar from './components/TabBar';
import NavBar from './components/NavBar';
import BookmarkBar from './components/BookmarkBar';

export default function App() {
  const dispatch = useDispatch();
  const tabs = useSelector(s => s.browser.tabs);
  const tabOrder = useSelector(s => s.browser.tabOrder);
  const currentTabId = useSelector(s => s.browser.currentTabId);

  // Always-fresh ref so event-handler closures never capture stale state
  const stateRef = useRef({});
  stateRef.current = { tabs, tabOrder, currentTabId };

  // ── Session save (debounced) ─────────────────────────────────────────────
  const sessionTimer = useRef(null);
  const requestSessionSave = useCallback(() => {
    clearTimeout(sessionTimer.current);
    sessionTimer.current = setTimeout(() => {
      const { tabs, tabOrder, currentTabId } = stateRef.current;
      const tabsToSave = tabOrder
        .filter(id => tabs[id] && !tabs[id].isStealth)
        .map(id => ({ id, url: tabs[id].url || 'https://www.google.com/' }));

      if (tabsToSave.length > 0 && window.electronAPI.sessionSave) {
        let activeTab = currentTabId;
        if (tabs[activeTab]?.isStealth) {
          activeTab = tabsToSave[tabsToSave.length - 1]?.id || null;
        }
        window.electronAPI.sessionSave({ tabs: tabsToSave, activeTabId: activeTab });
      }
    }, 700);
  }, []);

  useEffect(() => {
    if (tabOrder.length > 0) requestSessionSave();
  }, [tabOrder, requestSessionSave]);

  // ── navigate bridge for bookmark-popup.html (separate overlay window) ───
  useEffect(() => {
    window.__navigateCurrentTab = (url) => {
      const { currentTabId } = stateRef.current;
      if (currentTabId) window.electronAPI.navigate(currentTabId, url);
    };
  }, []);

  // ── Tab operations ───────────────────────────────────────────────────────
  const switchTab = useCallback((id) => {
    dispatch(setCurrentTab(id));
    window.electronAPI.switchTab(id);
  }, [dispatch]);

  const createTab = useCallback((isStealth = false) => {
    const id = 'tab-' + Date.now();
    dispatch(addTab({ id, isStealth, initialUrl: null }));
    window.electronAPI.newTab(id, isStealth, null);
    window.electronAPI.switchTab(id);
  }, [dispatch]);

  const createTabWithUrl = useCallback((id, isStealth, initialUrl) => {
    dispatch(addTab({ id, isStealth, initialUrl }));
    window.electronAPI.newTab(id, isStealth, initialUrl);
    window.electronAPI.switchTab(id);
  }, [dispatch]);

  const closeTab = useCallback((id) => {
    const { tabs, tabOrder, currentTabId } = stateRef.current;
    const isActive = currentTabId === id;

    dispatch(removeTab(id));
    window.electronAPI.closeTab(id);

    if (isActive) {
      const idx = tabOrder.indexOf(id);
      const remaining = tabOrder.filter(tid => tid !== id);
      const nextId = remaining[idx] ?? remaining[idx - 1];

      if (nextId) {
        // Small delay so removeTab dispatch settles before switchTab
        setTimeout(() => {
          dispatch(setCurrentTab(nextId));
          window.electronAPI.switchTab(nextId);
        }, 0);
      } else {
        setTimeout(() => createTab(false), 0);
      }
    }
  }, [dispatch, createTab]);

  const handleDragEnd = useCallback((newTabOrder) => {
    dispatch(reorderTabs(newTabOrder));
    requestSessionSave();
  }, [dispatch, requestSessionSave]);

  const handleSwitchTabDir = useCallback((direction) => {
    const { tabOrder, currentTabId } = stateRef.current;
    if (tabOrder.length <= 1) return;
    const idx = tabOrder.indexOf(currentTabId);
    const nextId = tabOrder[(idx + direction + tabOrder.length) % tabOrder.length];
    dispatch(setCurrentTab(nextId));
    window.electronAPI.switchTab(nextId);
  }, [dispatch]);

  const handleOpenHistory = useCallback(() => {
    const id = 'tab-' + Date.now();
    dispatch(addTab({ id, isStealth: false, initialUrl: null }));
    window.electronAPI.newTab(id, false, null);
    window.electronAPI.switchTab(id);
    setTimeout(() => window.electronAPI.navigate(id, 'stealth://History'), 50);
  }, [dispatch]);

  const handleOpenSettings = useCallback(() => {
    const id = 'tab-' + Date.now();
    dispatch(addTab({ id, isStealth: false, initialUrl: null }));
    window.electronAPI.newTab(id, false, null);
    window.electronAPI.switchTab(id);
    setTimeout(() => window.electronAPI.navigate(id, 'stealth://Settings'), 50);
  }, [dispatch]);

  const handleTabCreated = useCallback(({ id, url, isStealth }) => {
    const { tabs } = stateRef.current;
    if (!tabs[id]) {
      dispatch(addTab({ id, isStealth, initialUrl: url }));
    }
  }, [dispatch]);

  const handleTabSwitched = useCallback((id) => {
    dispatch(setCurrentTab(id));
  }, [dispatch]);

  // ── Register all IPC listeners ───────────────────────────────────────────
  useElectronIPC({
    onNewTab: createTab,
    onTabCreated: handleTabCreated,
    onTabSwitched: handleTabSwitched,
    onCloseTab: () => {
      const { currentTabId } = stateRef.current;
      if (currentTabId) closeTab(currentTabId);
    },
    onReload: () => {
      const { currentTabId } = stateRef.current;
      if (currentTabId) window.electronAPI.reload(currentTabId);
    },
    onSwitchTabDir: handleSwitchTabDir,
    onHistory: handleOpenHistory,
    onSettings: handleOpenSettings,
  });

  // ── Initialise: load bookmarks then restore session ──────────────────────
  useEffect(() => {
    async function init() {
      // 1. Load bookmarks first
      const bkData = await window.electronAPI.bookmarksGet();
      dispatch(setBookmarks(bkData));

      // 2. Restore session
      let session = null;
      if (window.electronAPI.sessionLoad) {
        session = await window.electronAPI.sessionLoad();
      }

      if (session?.tabs?.length > 0) {
        for (const t of session.tabs) {
          createTabWithUrl(t.id, false, t.url);
        }
        const target = session.activeTabId && document.getElementById(session.activeTabId)
          ? session.activeTabId
          : session.tabs[session.tabs.length - 1].id;

        // Give React a tick to render the tabs before switching
        setTimeout(() => {
          dispatch(setCurrentTab(target));
          window.electronAPI.switchTab(target);
        }, 0);
      } else {
        createTab(false);
      }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="header">
      <TabBar
        onNewTab={createTab}
        onCloseTab={closeTab}
        onSwitchTab={switchTab}
        onDragEnd={handleDragEnd}
      />
      <NavBar currentTabId={currentTabId} onOpenSettings={handleOpenSettings} />
      <BookmarkBar currentTabId={currentTabId} />
    </div>
  );
}
