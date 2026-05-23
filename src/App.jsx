import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  addTab, addSleepingTab, wakeTab,
  removeTab, setCurrentTab,
  reorderTabs,
  insertTabAfter,
  setTabPinned,
  setTabAudioMuted,
} from './store/browserSlice';
import { setBookmarks } from './store/bookmarksSlice';
import { useElectronIPC } from './hooks/useElectronIPC';
import { useChromeTheme } from './hooks/useChromeTheme';
import TabBar from './components/TabBar';
import NavBar from './components/NavBar';
import BookmarkBar from './components/BookmarkBar';
import SearchTabsModal from './components/SearchTabsModal';
import CommandPaletteModal from './components/CommandPaletteModal';
import { buildCommandPaletteCommands } from './commandPaletteCommands';
import { TabOverlayProvider } from './context/TabOverlayContext';
import { ChromeOverlayProvider } from './context/ChromeOverlayContext';
import {
  URL as URL_C,
  NAV_SOURCE,
  TAB_STRIP_MENU,
  CONTEXT_MENU,
} from './constants/conditionStrings.js';

function hostnameFromUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    return new URL(url).hostname || '';
  } catch {
    return '';
  }
}

function AppShell() {
  useChromeTheme();
  const dispatch = useDispatch();
  const tabs = useSelector(s => s.browser.tabs);
  const tabOrder = useSelector(s => s.browser.tabOrder);
  const currentTabId = useSelector(s => s.browser.currentTabId);
  /** True for dedicated stealth (incognito) windows — all tabs are private; chrome is fixed dark InvSurf. */
  const stealthWindowRef = useRef(!!(typeof window !== 'undefined' && window.__INVISURF_STEALTH_WINDOW__));
  const isStealthShell = stealthWindowRef.current;

  const [searchTabsOpen, setSearchTabsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [searchEngine, setSearchEngine] = useState('google');

  // Always-fresh ref so event-handler closures never capture stale state
  const stateRef = useRef({});
  stateRef.current = { tabs, tabOrder, currentTabId };
  /** Latest handlers for native tab strip context menu action IPC (refilled each render). */
  const tabStripMenuHandlersRef = useRef({});

  // ── Session save (debounced) ─────────────────────────────────────────────
  const sessionTimer = useRef(null);
  const requestSessionSave = useCallback(() => {
    clearTimeout(sessionTimer.current);
    sessionTimer.current = setTimeout(() => {
      const { tabs, tabOrder, currentTabId } = stateRef.current;
      const tabsToSave = tabOrder
        .filter(id => tabs[id] && !tabs[id].isStealth)
        .map(id => ({
          id,
          url: tabs[id].url || URL_C.NTP_DISPLAY,
          // Persist display metadata so sleeping tabs can show the right
          // title and favicon immediately on the next session restore.
          title: tabs[id].title || URL_C.NEW_TAB_LABEL,
          favicon: tabs[id].favicon || null,
        }));

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

  // Native Tab menu: Mute/Unmute Site + Pin/Unpin labels for the active tab
  useEffect(() => {
    const sync = window.electronAPI.tabMenuSyncLabels;
    if (!sync) return;
    const cur = tabs[currentTabId];
    let muteSiteShowsUnmute = false;
    let pinShowsUnpin = false;
    if (cur) {
      pinShowsUnpin = !!cur.isPinned;
      const host = hostnameFromUrl(cur.url);
      if (host) {
        const match = tabOrder.filter((tid) => hostnameFromUrl(tabs[tid]?.url) === host);
        muteSiteShowsUnmute = match.length > 0 && match.every((tid) => tabs[tid]?.isAudioMuted);
      }
    }
    sync({ muteSiteShowsUnmute, pinShowsUnpin });
  }, [tabs, tabOrder, currentTabId]);

  // ── navigate bridge for bookmark-popup.html (separate overlay window) ───
  useEffect(() => {
    window.__navigateCurrentTab = (url) => {
      const { currentTabId } = stateRef.current;
      if (currentTabId) window.electronAPI.navigate(currentTabId, url, { source: NAV_SOURCE.BOOKMARK });
    };
  }, []);

  // ── Tab operations ───────────────────────────────────────────────────────
  const switchTab = useCallback((id) => {
    if (stateRef.current.currentTabId === id) return;
    dispatch(setCurrentTab(id));
    window.electronAPI.switchTab(id);
  }, [dispatch]);

  const createTab = useCallback(() => {
    const st = stealthWindowRef.current;
    const id = 'tab-' + Date.now();
    dispatch(addTab({ id, isStealth: st, initialUrl: null }));
    // Main activates the tab inside new-tab → createTab; avoid redundant switch-tab IPC
    // (stateRef is stale until the next render, so switchTab would always fire duplicate IPC).
    window.electronAPI.newTab(id, st, null);
  }, [dispatch]);

  const createTabWithUrl = useCallback((id, isStealth, initialUrl) => {
    const st = stealthWindowRef.current || isStealth;
    dispatch(addTab({ id, isStealth: st, initialUrl }));
    window.electronAPI.newTab(id, st, initialUrl);
  }, [dispatch]);

  /** Normal windows always keep one tab; stealth windows close when the last tab goes away. */
  const createTabOrCloseStealthWindow = useCallback(() => {
    setTimeout(() => {
      if (stealthWindowRef.current) {
        window.electronAPI.closeStealthWindow?.();
      } else {
        createTab();
      }
    }, 0);
  }, [createTab]);

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
        createTabOrCloseStealthWindow();
      }
    }
  }, [dispatch, createTabOrCloseStealthWindow]);

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

  const newTabToRight = useCallback(() => {
    const { currentTabId } = stateRef.current;
    if (!currentTabId) return;
    const st = stealthWindowRef.current;
    const id = `tab-${Date.now()}`;
    dispatch(insertTabAfter({ afterId: currentTabId, id, isStealth: st, initialUrl: null }));
    window.electronAPI.newTab(id, st, null);
  }, [dispatch]);

  const duplicateTab = useCallback(() => {
    const { currentTabId, tabs: tmap } = stateRef.current;
    if (!currentTabId || !tmap[currentTabId]) return;
    const t = tmap[currentTabId];
    const url = t.url || 'https://www.google.com/';
    const isStealth = !!t.isStealth;
    const newId = `tab-${Date.now()}`;
    dispatch(insertTabAfter({ afterId: currentTabId, id: newId, isStealth, initialUrl: url }));
    window.electronAPI.newTab(newId, isStealth, url);
  }, [dispatch]);

  const toggleMuteSite = useCallback(() => {
    const { tabs: tmap, tabOrder: order, currentTabId: cur } = stateRef.current;
    if (!cur || !tmap[cur]) return;
    const host = hostnameFromUrl(tmap[cur].url);
    if (!host) return;
    const matching = order.filter((id) => hostnameFromUrl(tmap[id]?.url) === host);
    const anyUnmuted = matching.some((id) => !tmap[id]?.isAudioMuted);
    const muted = anyUnmuted;
    matching.forEach((id) => {
      dispatch(setTabAudioMuted({ id, muted }));
      if (!tmap[id]?.isSleeping && window.electronAPI.tabSetAudioMuted) {
        window.electronAPI.tabSetAudioMuted(id, muted);
      }
    });
  }, [dispatch]);

  const togglePinTab = useCallback(() => {
    const { currentTabId: cur, tabs: tmap } = stateRef.current;
    if (!cur || !tmap[cur]) return;
    dispatch(setTabPinned({ id: cur, pinned: !tmap[cur].isPinned }));
  }, [dispatch]);

  const closeOtherTabs = useCallback(() => {
    const { currentTabId: cur, tabOrder: order } = stateRef.current;
    if (!cur) return;
    const toClose = order.filter((id) => id !== cur);
    toClose.forEach((id) => closeTab(id));
  }, [closeTab]);

  const closeTabsToTheRight = useCallback(() => {
    const { currentTabId: cur, tabOrder: order } = stateRef.current;
    if (!cur) return;
    const idx = order.indexOf(cur);
    if (idx === -1) return;
    const toClose = order.slice(idx + 1);
    toClose.forEach((id) => closeTab(id));
  }, [closeTab]);

  const newTabToTheRightOf = useCallback((afterId) => {
    if (!afterId) return;
    const st = stealthWindowRef.current;
    const id = `tab-${Date.now()}`;
    dispatch(insertTabAfter({ afterId, id, isStealth: st, initialUrl: null }));
    window.electronAPI.newTab(id, st, null);
  }, [dispatch]);

  const duplicateTabFrom = useCallback((sourceId) => {
    const t = stateRef.current.tabs[sourceId];
    if (!t) return;
    const url = t.url || 'https://www.google.com/';
    const isStealth = !!t.isStealth;
    const newId = `tab-${Date.now()}`;
    dispatch(insertTabAfter({ afterId: sourceId, id: newId, isStealth, initialUrl: url }));
    window.electronAPI.newTab(newId, isStealth, url);
  }, [dispatch]);

  const muteSiteForTab = useCallback((anchorTabId) => {
    const { tabs: tmap, tabOrder: order } = stateRef.current;
    const anchor = tmap[anchorTabId];
    if (!anchor) return;
    const host = hostnameFromUrl(anchor.url);
    if (!host) return;
    const matching = order.filter((tid) => hostnameFromUrl(tmap[tid]?.url) === host);
    const anyUnmuted = matching.some((tid) => !tmap[tid]?.isAudioMuted);
    const muted = anyUnmuted;
    matching.forEach((tid) => {
      dispatch(setTabAudioMuted({ id: tid, muted }));
      if (!tmap[tid]?.isSleeping && window.electronAPI.tabSetAudioMuted) {
        window.electronAPI.tabSetAudioMuted(tid, muted);
      }
    });
  }, [dispatch]);

  const togglePinForTab = useCallback((tabId) => {
    const t = stateRef.current.tabs[tabId];
    if (!t) return;
    dispatch(setTabPinned({ id: tabId, pinned: !t.isPinned }));
  }, [dispatch]);

  const closeOtherTabsThan = useCallback((keepId) => {
    const { tabOrder: order } = stateRef.current;
    order.filter((id) => id !== keepId).forEach((id) => closeTab(id));
  }, [closeTab]);

  const closeTabsToTheRightOf = useCallback((boundaryId) => {
    const { tabOrder: order } = stateRef.current;
    const idx = order.indexOf(boundaryId);
    if (idx === -1) return;
    order.slice(idx + 1).forEach((id) => closeTab(id));
  }, [closeTab]);

  const moveTabToNewWindowFor = useCallback(async (tabId) => {
    const { tabOrder, currentTabId } = stateRef.current;
    const wasActive = currentTabId === tabId;
    let fallbackTabId = null;
    if (wasActive) {
      const idx = tabOrder.indexOf(tabId);
      const remaining = tabOrder.filter((tid) => tid !== tabId);
      fallbackTabId = remaining[idx] ?? remaining[idx - 1] ?? null;
    }
    const move = window.electronAPI.tabMoveToNewWindow;
    if (!move) return;
    const result = await move(tabId, fallbackTabId);
    if (!result?.ok) return;
    dispatch(removeTab(tabId));
    if (wasActive) {
      if (fallbackTabId) {
        dispatch(setCurrentTab(fallbackTabId));
      } else {
        createTabOrCloseStealthWindow();
      }
    }
  }, [dispatch, createTabOrCloseStealthWindow]);

  const handleTabMoveNewWindowShortcut = useCallback(() => {
    const id = stateRef.current.currentTabId;
    if (id) moveTabToNewWindowFor(id);
  }, [moveTabToNewWindowFor]);

  /** Serializable rows for main-process Menu.buildFromTemplate (ids allowlisted in main). */
  const buildTabStripContextMenuSpec = useCallback((targetId) => {
    const { tabs: tmap, tabOrder: order } = stateRef.current;
    const t = tmap[targetId];
    if (!t) return [];

    const host = hostnameFromUrl(t.url);
    let muteLabel = 'Mute Site';
    if (host) {
      const match = order.filter((tid) => hostnameFromUrl(tmap[tid]?.url) === host);
      if (match.length > 0 && match.every((tid) => tmap[tid]?.isAudioMuted)) {
        muteLabel = 'Unmute Site';
      }
    }
    const pinLabel = t.isPinned ? 'Unpin' : 'Pin';
    const stealthShell = stealthWindowRef.current;

    return [
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.NEW_TAB_RIGHT, label: 'New Tab to the Right', enabled: true },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.MOVE_NEW_WINDOW, label: 'Move Tab to New Window', enabled: !stealthShell },
      { type: CONTEXT_MENU.TYPE_SEPARATOR },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.RELOAD, label: 'Reload', enabled: !t.isSleeping },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.DUPLICATE, label: 'Duplicate', enabled: true },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.TOGGLE_PIN, label: pinLabel, enabled: true },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.TOGGLE_MUTE_SITE, label: muteLabel, enabled: !!host },
      { type: CONTEXT_MENU.TYPE_SEPARATOR },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.CLOSE, label: 'Close', enabled: true },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.CLOSE_OTHERS, label: 'Close Other Tabs', enabled: true },
      { type: CONTEXT_MENU.TYPE_ITEM, id: TAB_STRIP_MENU.CLOSE_RIGHT, label: 'Close Tabs to the Right', enabled: true },
    ];
  }, []);

  const handleTabStripContextMenu = useCallback(async (e, tabId) => {
    e.preventDefault();
    const api = window.electronAPI;
    if (!api?.tabStripContextMenuShow) return;
    const items = buildTabStripContextMenuSpec(tabId);
    if (items.length === 0) return;
    try {
      await api.tabStripContextMenuShow({
        tabId,
        x: e.clientX,
        y: e.clientY,
        items,
      });
    } catch (err) {
      console.error('tabStripContextMenuShow', err);
    }
  }, [buildTabStripContextMenuSpec]);

  /**
   * Opens an internal invisurf:// page as a singleton tab (legacy stealth:// is still accepted in main).
   * If a tab with the given URL is already open, switches to it instead
   * of creating a duplicate — matching Chrome's behaviour for chrome:// pages.
   *
   * @param {string} navigateTo - The invisurf:// URL to navigate to (e.g. 'invisurf://History')
   * @param {string} canonicalUrl - The lowercase display URL stored in Redux (e.g. 'invisurf://history')
   */
  const openSingletonTab = useCallback((navigateTo, canonicalUrl) => {
    const { tabs, tabOrder } = stateRef.current;
    const existingId = tabOrder.find(id => tabs[id]?.url === canonicalUrl);
    if (existingId) {
      dispatch(setCurrentTab(existingId));
      window.electronAPI.switchTab(existingId);
      return;
    }
    const st = stealthWindowRef.current;
    const id = 'tab-' + Date.now();
    dispatch(addTab({ id, isStealth: st, initialUrl: null }));
    window.electronAPI.newTab(id, st, null);
    setTimeout(() => window.electronAPI.navigate(id, navigateTo), 50);
  }, [dispatch]);

  const handleOpenHistory = useCallback(() => {
    openSingletonTab(URL_C.HISTORY_NAVIGATE, URL_C.HISTORY_DISPLAY);
  }, [openSingletonTab]);

  const paletteCommands = useMemo(
    () =>
      buildCommandPaletteCommands({
        platform: window.electronAPI?.platform || 'darwin',
        createTab,
        closeCurrentTab: () => {
          const id = stateRef.current.currentTabId;
          if (id) closeTab(id);
        },
        reload: () => {
          const id = stateRef.current.currentTabId;
          if (id) window.electronAPI.reload(id);
        },
        openHistory: handleOpenHistory,
        switchTabDir: handleSwitchTabDir,
        newTabToRight,
        duplicateTab,
        toggleMuteSite,
        togglePinTab,
        closeOtherTabs,
        closeTabsToTheRight,
        openTabSearch: () => {
          setCommandPaletteOpen(false);
          setSearchTabsOpen(true);
        },
        runMenuCommand: (id) => window.electronAPI.runMenuCommand(id),
        createStealthWindow: () => window.electronAPI.createStealthWindow?.(),
      }),
    [
      createTab,
      closeTab,
      handleOpenHistory,
      handleSwitchTabDir,
      newTabToRight,
      duplicateTab,
      toggleMuteSite,
      togglePinTab,
      closeOtherTabs,
      closeTabsToTheRight,
    ],
  );

  const handleOpenSettings = useCallback(() => {
    openSingletonTab(URL_C.SETTINGS_NAVIGATE, URL_C.SETTINGS_DISPLAY);
  }, [openSingletonTab]);

  const handleTabCreated = useCallback(({ id, url, isStealth }) => {
    const { tabs } = stateRef.current;
    if (!tabs[id]) {
      dispatch(addTab({ id, isStealth, initialUrl: url }));
    }
  }, [dispatch]);

  const handleTabSwitched = useCallback((id) => {
    dispatch(setCurrentTab(id));
  }, [dispatch]);

  // Fired by main process when a sleeping tab's WebContentsView is created.
  const handleTabAwoken = useCallback((id) => {
    dispatch(wakeTab(id));
    setTimeout(() => {
      const t = stateRef.current.tabs[id];
      if (t?.isAudioMuted && window.electronAPI.tabSetAudioMuted) {
        window.electronAPI.tabSetAudioMuted(id, true);
      }
    }, 0);
  }, [dispatch]);

  // ── Register all IPC listeners ───────────────────────────────────────────
  useEffect(() => {
    const unsub = window.electronAPI?.onTabStripContextMenuAction?.((data) => {
      const { tabId, id } = data || {};
      if (!tabId || !id) return;
      const fn = tabStripMenuHandlersRef.current[id];
      if (typeof fn === 'function') fn(tabId);
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, []);

  useElectronIPC({
    onNewTab: createTab,
    onTabCreated: handleTabCreated,
    onTabSwitched: handleTabSwitched,
    onTabAwoken: handleTabAwoken,
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
    onTabNewToRight: newTabToRight,
    onTabDuplicate: duplicateTab,
    onTabMuteSite: toggleMuteSite,
    onTabPin: togglePinTab,
    onTabCloseOthers: closeOtherTabs,
    onTabCloseRight: closeTabsToTheRight,
    onTabMoveNewWindow: handleTabMoveNewWindowShortcut,
    onTabSearch: () => {
      setCommandPaletteOpen(false);
      setSearchTabsOpen(true);
    },
    onCommandPalette: () => {
      setSearchTabsOpen(false);
      setCommandPaletteOpen(true);
    },
  });

  // ── Initialise: load bookmarks then restore session ──────────────────────
  useEffect(() => {
    async function init() {
      const bootstrap = typeof window.__APP_BOOTSTRAP !== 'undefined' ? window.__APP_BOOTSTRAP : null;
      if (bootstrap?.stealthWindow) {
        stealthWindowRef.current = true;
      }

      // 1. Load bookmarks and settings in parallel
      const [bkData, settingsData] = await Promise.all([
        window.electronAPI.bookmarksGet(),
        window.electronAPI.settingsGet?.() || Promise.resolve({}),
      ]);
      dispatch(setBookmarks(bkData));
      if (settingsData?.searchEngine) setSearchEngine(settingsData.searchEngine);

      // 1.5 Dedicated stealth window: one fresh private tab (session not restored).
      if (bootstrap?.stealthWindow) {
        createTab();
        return;
      }

      // 1.6 Bootstrap payload for windows created from "Move Tab to New Window".
      if (bootstrap?.movedTab?.url) {
        const movedTabId = `tab-${Date.now()}`;
        createTabWithUrl(movedTabId, !!bootstrap.movedTab.isStealth, bootstrap.movedTab.url);
        return;
      }

      // 2. Restore session
      let session = null;
      if (window.electronAPI.sessionLoad) {
        session = await window.electronAPI.sessionLoad();
      }

      if (session?.tabs?.length > 0) {
        // Determine which tab should be active on restore.
        const activeId = session.activeTabId && session.tabs.some(t => t.id === session.activeTabId)
          ? session.activeTabId
          : session.tabs[session.tabs.length - 1].id;

        for (const t of session.tabs) {
          if (t.id === activeId) {
            // Active tab: create the WebContentsView and load its URL eagerly.
            dispatch(addTab({ id: t.id, isStealth: false, initialUrl: t.url }));
            window.electronAPI.newTab(t.id, false, t.url);
          } else {
            // Inactive tabs: add to the tab strip using cached metadata only.
            // No WebContentsView is created; it will be created on first activation.
            dispatch(addSleepingTab({ id: t.id, url: t.url, title: t.title, favicon: t.favicon }));
            window.electronAPI.tabSleepRegister(t.id, t.url);
          }
        }

        // Give React a tick to render the tab strip before switching.
        setTimeout(() => {
          dispatch(setCurrentTab(activeId));
          window.electronAPI.switchTab(activeId);
        }, 0);
      } else {
        createTab();
      }
    }
    init();
  }, [dispatch, createTab, createTabWithUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  tabStripMenuHandlersRef.current = {
    [TAB_STRIP_MENU.NEW_TAB_RIGHT]: newTabToTheRightOf,
    [TAB_STRIP_MENU.MOVE_NEW_WINDOW]: moveTabToNewWindowFor,
    [TAB_STRIP_MENU.RELOAD]: (tid) => window.electronAPI.reload(tid),
    [TAB_STRIP_MENU.DUPLICATE]: duplicateTabFrom,
    [TAB_STRIP_MENU.TOGGLE_PIN]: togglePinForTab,
    [TAB_STRIP_MENU.TOGGLE_MUTE_SITE]: muteSiteForTab,
    [TAB_STRIP_MENU.CLOSE]: closeTab,
    [TAB_STRIP_MENU.CLOSE_OTHERS]: closeOtherTabsThan,
    [TAB_STRIP_MENU.CLOSE_RIGHT]: closeTabsToTheRightOf,
  };

  return (
    <div className={`header${isStealthShell ? ' header--stealth-window' : ''}`}>
      <CommandPaletteModal
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        commands={paletteCommands}
      />
      <SearchTabsModal
        open={searchTabsOpen}
        onClose={() => setSearchTabsOpen(false)}
        tabOrder={tabOrder}
        tabs={tabs}
        currentTabId={currentTabId}
        onSelectTab={(id) => {
          dispatch(setCurrentTab(id));
          window.electronAPI.switchTab(id);
        }}
        onCloseTab={closeTab}
      />
      <TabBar
        onNewTab={createTab}
        onCloseTab={closeTab}
        onSwitchTab={switchTab}
        onDragEnd={handleDragEnd}
        onTabStripContextMenu={handleTabStripContextMenu}
      />
      <NavBar currentTabId={currentTabId} onOpenSettings={handleOpenSettings} searchEngine={searchEngine} />
      <BookmarkBar currentTabId={currentTabId} />
    </div>
  );
}

export default function App() {
  return (
    <TabOverlayProvider>
      <ChromeOverlayProvider>
        <AppShell />
      </ChromeOverlayProvider>
    </TabOverlayProvider>
  );
}
