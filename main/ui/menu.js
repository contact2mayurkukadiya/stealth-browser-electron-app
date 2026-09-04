
const { Menu, app, shell, webContents } = require('electron');
const path = require('path');
const State = require('../state');
const C = require('../../src/constants/conditionStrings.cjs');

const {
    focusedShellWebContents,
    getFocusedShellWindow,
    getWindowContextByBrowserWindow,
    getWindowContextForShellFallback
} = require('../windows/windowContextUtils');

const { buildRecentlyClosedMenuItems, restoreRecentlyClosed } = require('../services/sessionService');

function openDownloadsFolder() {
    try {
        const downloadsPath = app.getPath('downloads');
        shell.openPath(downloadsPath).catch((error) => {
            console.error('Failed to open downloads folder:', error?.message || error);
        });
        return true;
    } catch (error) {
        console.error('Failed to resolve downloads folder:', error?.message || error);
        return false;
    }
}

function buildApplicationMenu() {
    const tabManager = require('../windows/tabManager');
    const windowManager = require('../windows/windowManager');

    return Menu.buildFromTemplate([
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Tab',
                    accelerator: 'CmdOrCtrl+T',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_NEW_TAB)
                },
                {
                    label: 'New Stealth Window',
                    accelerator: 'CmdOrCtrl+Shift+N',
                    click: () => {
                        const w = getFocusedShellWindow() || State.mainWindow;
                        const context = getWindowContextByBrowserWindow(w);
                        if (!context) return;
                        windowManager.createWindow({ profileId: context.profileId, stealthWindow: true });
                    },
                },
                {
                    label: 'New Ghost Window',
                    accelerator: 'CmdOrCtrl+Alt+G',
                    click: () => {
                        const w = getFocusedShellWindow() || State.mainWindow;
                        const context = getWindowContextByBrowserWindow(w);
                        const profileId = context?.profileId || State.defaultProfileId;
                        windowManager.createWindow({ profileId, ghostWindow: true });
                    },
                },
                {
                    label: 'New Window',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        const w = getFocusedShellWindow() || State.mainWindow;
                        const context = getWindowContextByBrowserWindow(w);
                        if (!context) return;
                        windowManager.createWindow({ profileId: context.profileId });
                    },
                },
                {
                    label: 'Close Tab',
                    accelerator: 'CmdOrCtrl+W',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_CLOSE_TAB)
                },
                {
                    label: 'Print...',
                    accelerator: 'CmdOrCtrl+P',
                    click: () => tabManager.printActiveTab(),
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_RELOAD)
                },
                { type: 'separator' },
                {
                    label: 'Settings page',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => tabManager.openOrActivateSettingsTab(),
                },
                {
                    label: 'Developer',
                    submenu: [
                        {
                            label: 'View Source',
                            click: () => tabManager.openViewSourceForActiveTab(),
                        },
                        {
                            label: 'Inspect Elements',
                            click: () => tabManager.openDevToolsForActiveTab('elements'),
                        },
                        {
                            label: 'JavaScript Console',
                            click: () => tabManager.openDevToolsForActiveTab('console'),
                        },
                    ],
                },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'History',
            submenu: [
                {
                    label: 'Show History',
                    accelerator: 'CmdOrCtrl+Y',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_HISTORY),
                },
                { type: 'separator' },
                { label: 'Home', click: () => tabManager.navigateActiveTabHome() },
                { label: 'Back', click: () => tabManager.goBackInActiveTab() },
                { label: 'Forward', click: () => tabManager.goForwardInActiveTab() },
                { type: 'separator' },
                {
                    label: 'Reopen Closed Tab',
                    accelerator: 'CmdOrCtrl+Shift+T',
                    enabled: (() => {
                        const context = getWindowContextForShellFallback();
                        const { getOrCreateRecentlyClosedForProfile } = require('../services/sessionService');
                        return !!context && getOrCreateRecentlyClosedForProfile(context.profileId).length > 0;
                    })(),
                    click: () => restoreRecentlyClosed(),
                },
                { label: 'Recently Closed', enabled: false },
                ...buildRecentlyClosedMenuItems(),
            ]
        },
        {
            label: 'Tab',
            submenu: [
                {
                    label: 'New Tab to the Right',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_NEW_RIGHT),
                },
                { type: 'separator' },
                {
                    label: 'Select Next Tab',
                    accelerator: 'Control+Tab',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_SWITCH_TAB, { direction: 1 }),
                },
                {
                    label: 'Select Previous Tab',
                    accelerator: 'Control+Shift+Tab',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_SWITCH_TAB, { direction: -1 }),
                },
                { type: 'separator' },
                {
                    label: 'Duplicate Tab',
                    accelerator: 'CommandOrControl+Shift+D',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_DUPLICATE),
                },
                {
                    label: State.tabMenuMuteSiteShowsUnmute ? 'Unmute Site' : 'Mute Site',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_MUTE),
                },
                {
                    label: State.tabMenuPinShowsUnpin ? 'Unpin Tab' : 'Pin Tab',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_PIN),
                },
                {
                    label: 'Group Tab',
                    enabled: false,
                },
                { type: 'separator' },
                {
                    label: 'Close Other Tabs',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_CLOSE_OTHERS),
                },
                {
                    label: 'Close Tabs to the Right',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_CLOSE_RIGHT),
                },
                { type: 'separator' },
                {
                    label: 'Move Tab to New Window',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_MOVE_WINDOW),
                },
                {
                    label: 'Search Tabs…',
                    accelerator: 'Shift+CommandOrControl+A',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_SEARCH),
                },
            ],
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Search…',
                    accelerator: 'CommandOrControl+Shift+P',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_COMMAND_PALETTE),
                },
            ],
        },
    ]);
}

function runMenuCommandFromPalette(commandId) {
    const tabManager = require('../windows/tabManager');
    const windowManager = require('../windows/windowManager');
    const lensManager = require('../windows/lensManager');

    switch (commandId) {
        case C.MENU_COMMAND.OPEN_SETTINGS:
            tabManager.openOrActivateSettingsTab();
            return true;
        case C.MENU_COMMAND.NAVIGATE_HOME:
            tabManager.navigateActiveTabHome();
            return true;
        case C.MENU_COMMAND.HISTORY_BACK:
            tabManager.goBackInActiveTab();
            return true;
        case C.MENU_COMMAND.HISTORY_FORWARD:
            tabManager.goForwardInActiveTab();
            return true;
        case C.MENU_COMMAND.VIEW_SOURCE:
            tabManager.openViewSourceForActiveTab();
            return true;
        case C.MENU_COMMAND.DEVTOOLS_ELEMENTS:
            tabManager.openDevToolsForActiveTab(C.DEVTOOLS_PANEL.ELEMENTS);
            return true;
        case C.MENU_COMMAND.DEVTOOLS_CONSOLE:
            tabManager.openDevToolsForActiveTab(C.DEVTOOLS_PANEL.CONSOLE);
            return true;
        case C.MENU_COMMAND.TOGGLE_FULLSCREEN:
            if (State.mainWindow && !State.mainWindow.isDestroyed()) {
                State.mainWindow.setFullScreen(!State.mainWindow.isFullScreen());
            }
            return true;
        case C.MENU_COMMAND.QUIT:
            app.quit();
            return true;
        case C.MENU_COMMAND.NEW_WINDOW_CURRENT_PROFILE: {
            const context = getWindowContextByBrowserWindow(State.mainWindow);
            if (!context) return false;
            windowManager.createWindow({ profileId: context.profileId });
            return true;
        }
        case C.MENU_COMMAND.EDIT_UNDO: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.undo();
            return true;
        }
        case C.MENU_COMMAND.EDIT_REDO: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.redo();
            return true;
        }
        case C.MENU_COMMAND.EDIT_CUT: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.cut();
            return true;
        }
        case C.MENU_COMMAND.EDIT_COPY: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.copy();
            return true;
        }
        case C.MENU_COMMAND.EDIT_PASTE: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.paste();
            return true;
        }
        case C.MENU_COMMAND.EDIT_SELECT_ALL: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.selectAll();
            return true;
        }
        case C.MENU_COMMAND.OPEN_DOWNLOADS:
            return openDownloadsFolder();
        case C.MENU_COMMAND.PRINT_ACTIVE_TAB:
            return tabManager.printActiveTab();
        case C.MENU_COMMAND.FIND_IN_PAGE:
            return tabManager.triggerFindInActiveTab();
        case C.MENU_COMMAND.SEARCH_WITH_GOOGLE_LENS:
            return lensManager.startGoogleLensSelection();
        default:
            return false;
    }
}

function rebuildApplicationMenu() {
    if (!State.mainWindow || State.mainWindow.isDestroyed()) return;
    Menu.setApplicationMenu(buildApplicationMenu());
}

module.exports = {
    openDownloadsFolder,
    buildApplicationMenu,
    runMenuCommandFromPalette,
    rebuildApplicationMenu
};