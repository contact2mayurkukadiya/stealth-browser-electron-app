import { createSlice } from '@reduxjs/toolkit';
import { URL as URL_C } from '../constants/conditionStrings.js';

// The canonical URL for new tabs — resolved by main.js to the actual newtab.html.
const NTP_URL = URL_C.NTP_DISPLAY;

/**
 * Returns true when a URL represents the custom New Tab Page.
 * Covers both the short form (stored in Redux / session) and the resolved
 * app:// path that comes back via url-changed after navigation.
 */
function isNtpUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower === URL_C.NTP_DISPLAY || lower.startsWith(URL_C.NTP_LOCALHOST_PREFIX);
}

function tabChromeDefaults() {
  return {
    isPinned: false,
    isAudioMuted: false,
    lastActiveAt: Date.now(),
  };
}

/** All pinned tabs first (left), then unpinned; preserves relative order within each group. */
function applyPinnedLeadingOrder(state) {
  const pinned = state.tabOrder.filter(tid => state.tabs[tid]?.isPinned);
  const unpinned = state.tabOrder.filter(tid => !state.tabs[tid]?.isPinned);
  state.tabOrder = [...pinned, ...unpinned];
}

const browserSlice = createSlice({
  name: 'browser',
  initialState: {
    /**
     * { [tabId]: { url, title, favicon, isNewTab, isStealth, isLoading, isSleeping,
     *   isPinned, isAudioMuted, lastActiveAt } }
     * isSleeping=true means the tab exists visually but its WebContentsView has not
     * been created yet (lazy session restore). Content loads on first activation.
     */
    tabs: {},
    /** Ordered array of tab IDs (reflects visual left→right order) */
    tabOrder: [],
    currentTabId: null,
  },
  reducers: {
    addTab(state, action) {
      const { id, isStealth = false, initialUrl = null } = action.payload;
      const url = initialUrl || NTP_URL;
      state.tabs[id] = {
        url,
        title: 'New Tab',
        favicon: null,
        isNewTab: !initialUrl || isNtpUrl(url),
        isStealth,
        isLoading: false,
        isSleeping: false,
        ...tabChromeDefaults(),
      };
      state.tabOrder.push(id);
      state.currentTabId = id;
      applyPinnedLeadingOrder(state);
    },

    /**
     * Inserts a new tab immediately after `afterId` in tabOrder and focuses it.
     */
    insertTabAfter(state, action) {
      const { afterId, id, isStealth = false, initialUrl = null } = action.payload;
      const url = initialUrl || NTP_URL;
      const afterIdx = state.tabOrder.indexOf(afterId);
      state.tabs[id] = {
        url,
        title: 'New Tab',
        favicon: null,
        isNewTab: !initialUrl || isNtpUrl(url),
        isStealth,
        isLoading: false,
        isSleeping: false,
        ...tabChromeDefaults(),
      };
      if (afterIdx === -1) {
        state.tabOrder.push(id);
      } else {
        state.tabOrder.splice(afterIdx + 1, 0, id);
      }
      state.currentTabId = id;
      applyPinnedLeadingOrder(state);
    },

    /**
     * Registers a session-restored tab as sleeping: the tab strip shows the
     * saved title/favicon immediately, but no WebContentsView is created until
     * the user first activates the tab.
     */
    addSleepingTab(state, action) {
      const { id, url, title, favicon, isStealth = false } = action.payload;
      const resolvedUrl = url || NTP_URL;
      state.tabs[id] = {
        url: resolvedUrl,
        title: title || 'New Tab',
        favicon: favicon || null,
        isNewTab: isNtpUrl(resolvedUrl),
        isStealth,
        isLoading: false,
        isSleeping: true,
        ...tabChromeDefaults(),
      };
      state.tabOrder.push(id);
      // currentTabId is intentionally NOT set — the active tab is handled separately.
    },

    /**
     * Clears the isSleeping flag once the main process has created the
     * WebContentsView for this tab (triggered by tab:awoken IPC event).
     */
    wakeTab(state, action) {
      const id = action.payload;
      if (state.tabs[id]) state.tabs[id].isSleeping = false;
    },

    removeTab(state, action) {
      const id = action.payload;
      delete state.tabs[id];
      state.tabOrder = state.tabOrder.filter(tid => tid !== id);
    },

    setCurrentTab(state, action) {
      const id = action.payload;
      state.currentTabId = id;
      if (state.tabs[id]) {
        state.tabs[id].lastActiveAt = Date.now();
      }
    },

    setTabPinned(state, action) {
      const { id, pinned } = action.payload;
      if (!state.tabs[id]) return;
      const wasPinned = !!state.tabs[id].isPinned;
      const next = !!pinned;
      if (next === wasPinned) return;
      state.tabs[id].isPinned = next;

      const others = state.tabOrder.filter(tid => tid !== id);
      if (next && !wasPinned) {
        const otherPinned = others.filter(tid => state.tabs[tid]?.isPinned);
        const unpinned = others.filter(tid => !state.tabs[tid]?.isPinned);
        state.tabOrder = [id, ...otherPinned, ...unpinned];
      } else if (!next && wasPinned) {
        const pinnedIds = others.filter(tid => state.tabs[tid]?.isPinned);
        const unpinnedIds = others.filter(tid => !state.tabs[tid]?.isPinned);
        state.tabOrder = [...pinnedIds, id, ...unpinnedIds];
      }
    },

    setTabAudioMuted(state, action) {
      const { id, muted } = action.payload;
      if (state.tabs[id]) state.tabs[id].isAudioMuted = !!muted;
    },

    updateTab(state, action) {
      const { id, title, favicon, isLoading, url } = action.payload;
      if (!state.tabs[id]) {
        state.tabs[id] = {
          url: NTP_URL,
          isNewTab: true,
          isStealth: false,
          isLoading: false,
          ...tabChromeDefaults(),
        };
        if (!state.tabOrder.includes(id)) state.tabOrder.push(id);
      }
      const tab = state.tabs[id];
      if (url != null) tab.url = url;
      if (favicon != null) tab.favicon = favicon;
      if (isLoading != null) tab.isLoading = isLoading;
      if (title) {
        const currentUrl = url || tab.url || '';
        tab.title = (tab.isNewTab && isNtpUrl(currentUrl)) ? 'New Tab' : title;
      }
    },

    updateTabUrl(state, action) {
      const { id, url } = action.payload;
      if (!state.tabs[id]) {
        state.tabs[id] = {
          url: NTP_URL,
          isNewTab: true,
          isStealth: false,
          isLoading: false,
          ...tabChromeDefaults(),
        };
        if (!state.tabOrder.includes(id)) state.tabOrder.push(id);
      }
      const tab = state.tabs[id];
      tab.url = url;
      // NTP (empty omnibox) vs real navigations — e.g. clearing invisurf://settings + Enter.
      tab.isNewTab = isNtpUrl(url);
      if (tab.isNewTab) tab.title = 'New Tab';
    },

    setTabNewTab(state, action) {
      const { id, value } = action.payload;
      if (state.tabs[id]) state.tabs[id].isNewTab = value;
    },

    reorderTabs(state, action) {
      // action.payload: new ordered array of tab IDs
      state.tabOrder = action.payload;
      applyPinnedLeadingOrder(state);
    },
  },
});

export const {
  addTab,
  insertTabAfter,
  addSleepingTab,
  wakeTab,
  removeTab,
  setCurrentTab,
  setTabPinned,
  setTabAudioMuted,
  updateTab,
  updateTabUrl,
  setTabNewTab,
  reorderTabs,
} = browserSlice.actions;

export default browserSlice.reducer;
