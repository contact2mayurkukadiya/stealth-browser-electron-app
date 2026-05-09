const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Tab management
    newTab: (id, isStealth = false, url = null) => ipcRenderer.send('new-tab', { id, isStealth, url }),
    switchTab: (id) => ipcRenderer.send('switch-tab', { id }),
    closeTab: (id) => ipcRenderer.send('close-tab', { id }),
    navigate: (id, url) => ipcRenderer.send('navigate', { id, url }),
    goBack: (id) => ipcRenderer.send('go-back', { id }),
    goForward: (id) => ipcRenderer.send('go-forward', { id }),
    reload: (id) => ipcRenderer.send('reload', { id }),
    onUrlChanged: (callback) => ipcRenderer.on('url-changed', (event, data) => callback(data)),
    onTabUpdate: (callback) => ipcRenderer.on('tab-update', (event, data) => callback(data)),
    onTabCreated: (callback) => ipcRenderer.on('tab-created', (event, data) => callback(data)),
    onTabSwitched: (callback) => ipcRenderer.on('tab-switched', (event, data) => callback(data)),
    onOmniboxFocus: (callback) => ipcRenderer.on('omnibox:focus', (event, data) => callback(data)),
    onShortcutNewTab: (callback) => ipcRenderer.on('shortcut-new-tab', () => callback()),
    onShortcutNewStealthTab: (callback) => ipcRenderer.on('shortcut-new-stealth-tab', () => callback()),
    onShortcutHistory: (callback) => ipcRenderer.on('shortcut-history', () => callback()),
    onShortcutSettings: (callback) => ipcRenderer.on('shortcut-settings', () => callback()),
    onShortcutCloseTab: (callback) => ipcRenderer.on('shortcut-close-tab', () => callback()),
    onShortcutReload: (callback) => ipcRenderer.on('shortcut-reload', () => callback()),
    onShortcutSwitchTab: (callback) => ipcRenderer.on('shortcut-switch-tab', (event, data) => callback(data)),
    onShortcutTabNewToRight: (callback) => ipcRenderer.on('shortcut-tab-new-to-right', () => callback()),
    onShortcutTabDuplicate: (callback) => ipcRenderer.on('shortcut-tab-duplicate', () => callback()),
    onShortcutTabMuteSite: (callback) => ipcRenderer.on('shortcut-tab-mute-site', () => callback()),
    onShortcutTabPin: (callback) => ipcRenderer.on('shortcut-tab-pin', () => callback()),
    onShortcutTabCloseOthers: (callback) => ipcRenderer.on('shortcut-tab-close-others', () => callback()),
    onShortcutTabCloseRight: (callback) => ipcRenderer.on('shortcut-tab-close-right', () => callback()),
    onShortcutTabMoveNewWindow: (callback) => ipcRenderer.on('shortcut-tab-move-new-window', () => callback()),
    onShortcutTabSearch: (callback) => ipcRenderer.on('shortcut-tab-search', () => callback()),
    onShortcutCommandPalette: (callback) => ipcRenderer.on('shortcut-command-palette', () => callback()),

    runMenuCommand: (commandId) => ipcRenderer.invoke('app:run-menu-command', commandId),
    createWindow: (profileId) => ipcRenderer.invoke('window:create', { profileId }),
    windowGetBootstrap: () => ipcRenderer.invoke('window:get-bootstrap'),

    tabSetAudioMuted: (id, muted) => ipcRenderer.send('tab:set-audio-muted', { id, muted }),
    tabMenuSyncLabels: (payload) => ipcRenderer.send('tab-menu:sync-labels', payload),
    tabMoveToNewWindow: (id, fallbackTabId) => ipcRenderer.invoke('tab:move-to-new-window', { id, fallbackTabId }),

    // Bookmarks
    bookmarksGet: () => ipcRenderer.invoke('bookmarks:get'),
    bookmarksSave: (data) => ipcRenderer.invoke('bookmarks:save', data),
    bookmarksAdd: (item) => ipcRenderer.invoke('bookmarks:add', item),
    bookmarksRemove: (id) => ipcRenderer.invoke('bookmarks:remove', id),
    bookmarksReorder: (bar) => ipcRenderer.invoke('bookmarks:reorder', bar),
    bookmarksAddFolder: (name) => ipcRenderer.invoke('bookmarks:addFolder', name),
    bookmarksAddToFolder: (folderId, item) => ipcRenderer.invoke('bookmarks:addToFolder', folderId, item),

    // History
    historyGet: () => ipcRenderer.invoke('history:get'),
    historyRemoveItems: (timestamps) => ipcRenderer.invoke('history:remove-items', timestamps),
    historyClear: () => ipcRenderer.invoke('history:clear'),

    // Profiles
    profileList: () => ipcRenderer.invoke('profile:list'),
    profileGetCurrent: () => ipcRenderer.invoke('profile:get-current'),
    profileCreate: (displayName) => ipcRenderer.invoke('profile:create', { displayName }),
    profileUpdate: (payload) => ipcRenderer.invoke('profile:update', payload),
    profileSetAvatarData: (payload) => ipcRenderer.invoke('profile:setAvatarData', payload),
    profileSetAvatarFromPresetPng: (payload) => ipcRenderer.invoke('profile:setAvatarFromPresetPng', payload),
    profileValidateAvatarData: (dataUrl) => ipcRenderer.invoke('profile:validateAvatarData', { dataUrl }),
    profileListPresetAvatarPngs: () => ipcRenderer.invoke('profile:list-preset-avatar-pngs'),
    profileClearAvatar: (profileId) => ipcRenderer.invoke('profile:clearAvatar', { profileId }),
    profileGetAvatarDataUrl: (profileId) => ipcRenderer.invoke('profile:getAvatarDataUrl', { profileId }),
    profileDelete: (profileId) => ipcRenderer.invoke('profile:delete', { profileId }),
    profileOpenWindow: (profileId, options = {}) =>
        ipcRenderer.invoke('profile:open-window', {
            profileId,
            closeProfilePicker: options.closeProfilePicker === true,
        }),

    // Session
    sessionSave: (data) => ipcRenderer.invoke('session:save', data),
    sessionLoad: () => ipcRenderer.invoke('session:load'),

    getTabInfo: (id) => ipcRenderer.invoke('tab:get-info', { id }),
    tabHideActive: () => ipcRenderer.invoke('tab:hide-active'),
    tabRestoreActive: () => ipcRenderer.invoke('tab:restore-active'),
    tabCaptureActiveSnapshot: () => ipcRenderer.invoke('tab:capture-active-snapshot'),

    // Lazy tab loading: register a tab as sleeping (no WebContentsView created yet)
    tabSleepRegister: (id, url) => ipcRenderer.send('tab:sleep-register', { id, url }),
    // Called by main process when a sleeping tab's WebContentsView is created on activation
    onTabAwoken: (callback) => ipcRenderer.on('tab:awoken', (event, data) => callback(data)),

    // Settings
    settingsGet: () => ipcRenderer.invoke('settings:get'),
    settingsSave: (data) => ipcRenderer.invoke('settings:save', data),
    appRelaunch: () => ipcRenderer.invoke('app:relaunch'),

    compatDiagGetReport: (payload) => ipcRenderer.invoke('compatDiag:getReport', payload),
    compatDiagClear: (payload) => ipcRenderer.invoke('compatDiag:clear', payload),
    clipboardWriteText: (text) => clipboard.writeText(String(text || '')),

    // New Tab Page
    ntpGetTopSites: () => ipcRenderer.invoke('newtab:get-top-sites'),
    ntpStealFocus: () => ipcRenderer.send('omnibox:steal-focus'),

    // Tooltip Overlay
    tooltipShow: (data) => ipcRenderer.send('tooltip:show', data),
    tooltipHide: () => ipcRenderer.send('tooltip:hide'),
    onTooltipUpdate: (callback) => ipcRenderer.on('tooltip:update', (event, v) => callback(v)),

    // Platform identifier — used by the renderer to apply platform-specific styles
    platform: process.platform,
});