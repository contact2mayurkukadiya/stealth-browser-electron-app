import { createSlice } from '@reduxjs/toolkit';

const GOOGLE_HOME = 'https://www.google.com/';

function isGoogleHome(url) {
  return url && url.startsWith('https://www.google.com/') && !url.includes('/search');
}

const browserSlice = createSlice({
  name: 'browser',
  initialState: {
    /** { [tabId]: { url, title, favicon, isNewTab, isStealth, isLoading } } */
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
      };
      state.tabOrder.push(id);
      state.currentTabId = id;
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
  removeTab,
  setCurrentTab,
  updateTab,
  updateTabUrl,
  setTabNewTab,
  reorderTabs,
} = browserSlice.actions;

export default browserSlice.reducer;
