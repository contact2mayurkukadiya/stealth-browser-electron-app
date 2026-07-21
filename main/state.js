
/**
 * Global State Store
 * Acts as the centralized memory for the browser process.
 * Prevents circular dependencies between Window, Tab, and Service modules.
 */
const State = {
    mainWindow: null,
    htmlFullscreenTabId: null,
    tabMenuMuteSiteShowsUnmute: false,
    tabMenuPinShowsUnpin: false,

    // Window/Tab/Profile registries
    windowContextsById: new Map(), // BrowserWindow.id -> context
    tabIdToWindowId: new Map(), // tabId -> BrowserWindow.id
    profilesById: new Map(), // profileId -> profile metadata
    windowBootstrapById: new Map(), // app windowId -> bootstrap payload

    // Core references
    defaultProfileId: null,
    startupSessionDoc: null,
    profilePickerWindow: null,

    // App Lifecycle Flags
    appIsQuitting: false,
    appQuitAfterHistoryClose: false,
    appHistoryCloseStarted: false,
    appHistoryClosed: false,
    appCookieCleanupStarted: false,
    appCookieCleanupClosed: false,

    // UI & Tab Management
    generatedTabCounter: 0,
    recentlyClosedTabsByProfile: new Map(),

    // Legacy global kept for compatibility in a few guard paths
    sleepingTabs: {},

    // Map Electron webContents.id → tab id (for webRequest diagnostics on shared sessions)
    webContentsIdToTabId: new Map(),

    // Tabs moved out of the main shell into their own window
    detachedTabWindows: new Map(),

    // Protocol Handlers
    appProtocolInstalledSessions: new WeakSet(),

    // Dev Watchers
    devFileWatchers: [],

    // Request/Navigation state guards
    mainFrameRequestWindowsByWebContents: new Map(),
    pendingTransitionsByTab: new Map(),

    // Cookie & Session state
    cookiePolicyCacheByProfileId: new Map(),
    cookieStoreGuardedSessions: new WeakSet(),
    cookieModifiedAtBySession: new WeakMap(),

    // Theme state
    nativeThemeTitleBarListenersAttached: false,

    // Services (Injected at boot)
    historyService: null,
    appLogger: null
};

module.exports = State;
