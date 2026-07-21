const { BrowserWindow } = require('electron');
const State = require('../state');

function getWindowContextById(windowId) {
    return State.windowContextsById.get(windowId) || null;
}

function getWindowContextByBrowserWindow(win) {
    if (!win || win.isDestroyed()) return null;
    return getWindowContextById(win.id);
}

function getFocusedShellWindow() {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && State.windowContextsById.has(focused.id)) return focused;
    for (const ctx of State.windowContextsById.values()) {
        if (ctx.window && !ctx.window.isDestroyed()) return ctx.window;
    }
    return null;
}

function focusedShellWebContents() {
    const w = getFocusedShellWindow();
    if (w && !w.isDestroyed()) return w.webContents;
    return State.mainWindow && !State.mainWindow.isDestroyed() ? State.mainWindow.webContents : null;
}

/** Prefer the focused shell window over `mainWindow` when tab-id lookup fails (secondary windows / stealth). */
function getWindowContextForShellFallback() {
    const focused = getFocusedShellWindow();
    if (focused) {
        const ctx = getWindowContextByBrowserWindow(focused);
        if (ctx) return ctx;
    }
    return getWindowContextByBrowserWindow(State.mainWindow);
}

function getWindowContextByTabId(tabId) {
    const windowId = State.tabIdToWindowId.get(tabId);
    if (!windowId) return null;
    return getWindowContextById(windowId);
}

function getHostWindowForTabId(tabId) {
    return State.detachedTabWindows.get(tabId) || getWindowContextByTabId(tabId)?.window || getFocusedShellWindow();
}

function getWindowContextByEventSender(sender) {
    if (!sender) return null;
    try {
        if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return null;
    } catch (_) {
        return null;
    }
    const win = BrowserWindow.fromWebContents(sender);
    if (win && !win.isDestroyed()) {
        const ctx = getWindowContextByBrowserWindow(win);
        if (ctx) return ctx;
    }
    const tabId = State.webContentsIdToTabId.get(sender.id);
    if (tabId) return getWindowContextByTabId(tabId);
    return null;
}

function isViewWebContentsAlive(view) {
    const wc = view?.webContents;
    return !!(wc && typeof wc.isDestroyed === 'function' && !wc.isDestroyed());
}

function getWindowContextByChromeOverlaySender(sender) {
    if (!sender || sender.isDestroyed?.()) return null;
    for (const ctx of State.windowContextsById.values()) {
        const ov = ctx.chromeOverlayView;
        if (isViewWebContentsAlive(ov) && ov.webContents === sender) {
            return ctx;
        }
        const shellOv = ctx.chromeShellMenuOverlayView;
        if (isViewWebContentsAlive(shellOv) && shellOv.webContents === sender) {
            return ctx;
        }
        const omniboxOv = ctx.chromeOmniboxOverlayView;
        if (isViewWebContentsAlive(omniboxOv) && omniboxOv.webContents === sender) {
            return ctx;
        }
    }
    return null;
}

module.exports = {
    getWindowContextById,
    getWindowContextByBrowserWindow,
    getFocusedShellWindow,
    focusedShellWebContents,
    getWindowContextForShellFallback,
    getWindowContextByTabId,
    getHostWindowForTabId,
    getWindowContextByEventSender,
    isViewWebContentsAlive,
    getWindowContextByChromeOverlaySender
};