import { createSlice } from '@reduxjs/toolkit';

const GOOGLE_HOME = 'https://www.google.com/';

function isGoogleHome(url) {
  return url && url.startsWith('https://www.google.com/') && !url.includes('/search');
}

const browserSlice = createSlice({
  name: 'browser',
  initialState: {
    /**
     * { [tabId]: { url, title, favicon, isNewTab, isStealth, isLoading, isSleeping } }
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
      const url = initialUrl || GOOGLE_HOME;
      state.tabs[id] = {
        url,
        title: 'New Tab',
        favicon: null,
        isNewTab: !initialUrl || isGoogleHome(url),
        isStealth,
        isLoading: false,
        isSleeping: false,
      };
      state.tabOrder.push(id);
      state.currentTabId = id;
    },

    /**
     * Registers a session-restored tab as sleeping: the tab strip shows the
     * saved title/favicon immediately, but no WebContentsView is created until
     * the user first activates the tab.
     */
    addSleepingTab(state, action) {
      const { id, url, title, favicon, isStealth = false } = action.payload;
      const resolvedUrl = url || GOOGLE_HOME;
      state.tabs[id] = {
        url: resolvedUrl,
        title: title || 'New Tab',
        favicon: favicon || null,
        isNewTab: isGoogleHome(resolvedUrl),
        isStealth,
        isLoading: false,
        isSleeping: true,
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
      state.currentTabId = action.payload;
    },

    updateTab(state, action) {
      const { id, title, favicon, isLoading, url } = action.payload;
      if (!state.tabs[id]) {
        state.tabs[id] = { url: GOOGLE_HOME, isNewTab: true, isStealth: false, isLoading: false };
        if (!state.tabOrder.includes(id)) state.tabOrder.push(id);
      }
      const tab = state.tabs[id];
      if (url != null) tab.url = url;
      if (favicon != null) tab.favicon = favicon;
      if (isLoading != null) tab.isLoading = isLoading;
      if (title) {
        const currentUrl = url || tab.url || '';
        tab.title = (tab.isNewTab && isGoogleHome(currentUrl)) ? 'New Tab' : title;
      }
    },

    updateTabUrl(state, action) {
      const { id, url } = action.payload;
      if (!state.tabs[id]) {
        state.tabs[id] = { url: GOOGLE_HOME, isNewTab: true, isStealth: false, isLoading: false };
        if (!state.tabOrder.includes(id)) state.tabOrder.push(id);
      }
      const tab = state.tabs[id];
      tab.url = url;
      if (!isGoogleHome(url)) tab.isNewTab = false;
    },

    setTabNewTab(state, action) {
      const { id, value } = action.payload;
      if (state.tabs[id]) state.tabs[id].isNewTab = value;
    },

    reorderTabs(state, action) {
      // action.payload: new ordered array of tab IDs
      state.tabOrder = action.payload;
    },
  },
});

export const {
  addTab,
  addSleepingTab,
  wakeTab,
  removeTab,
  setCurrentTab,
  updateTab,
  updateTabUrl,
  setTabNewTab,
  reorderTabs,
} = browserSlice.actions;

export default browserSlice.reducer;
