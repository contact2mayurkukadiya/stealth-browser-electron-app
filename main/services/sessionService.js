
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const encryption = require('../../encryption');
const State = require('../state');
const { MAX_RECENTLY_CLOSED_TABS } = require('../constants/defaults');
const {
    canStoreRecentlyClosedUrl,
    resolveInternalPageUrl,
    toDisplayUrl
} = require('../utils/navigation');
const { getWindowContextForShellFallback } = require('../windows/windowContextUtils');

let sessionPath;

function getSessionPath() {
    if (!sessionPath) {
        sessionPath = path.join(app.getPath('userData'), 'session.json');
    }
    return sessionPath;
}

function clearSessionSnapshot() {
    try {
        const p = getSessionPath();
        if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (err) {
        console.error('Failed to clear session snapshot:', err);
    }
}

function readDecodedSessionDoc() {
    try {
        const sessionDocPath = getSessionPath();
        if (!fs.existsSync(sessionDocPath)) return null;
        const parsed = JSON.parse(fs.readFileSync(sessionDocPath, 'utf-8'));
        const decoded = (parsed && parsed.encrypted !== undefined)
            ? (() => {
                const dec = encryption.decrypt(parsed);
                return dec ? JSON.parse(dec) : null;
            })()
            : parsed;
        if (decoded?.schemaVersion === 2 && decoded.windowsById && typeof decoded.windowsById === 'object') {
            return decoded;
        }
        return null;
    } catch (error) {
        console.error('Failed to read session document:', error);
        return null;
    }
}

function findSessionWindowIdForProfile(decoded, profileId) {
    if (!decoded?.windowsById || !profileId) return undefined;
    for (const [windowId, windowData] of Object.entries(decoded.windowsById)) {
        if (windowData?.profileId === profileId) return windowId;
    }
    return undefined;
}

function captureNavigationHistorySnapshot(tabWebContents) {
    try {
        const navigationHistory = tabWebContents?.navigationHistory;
        if (!navigationHistory || typeof navigationHistory.getAllEntries !== 'function') return null;
        const rawEntries = navigationHistory.getAllEntries();
        if (!Array.isArray(rawEntries) || rawEntries.length === 0) return null;

        const activeIndex = typeof navigationHistory.getActiveIndex === 'function'
            ? navigationHistory.getActiveIndex()
            : rawEntries.length - 1;
        const entries = [];
        let index = 0;

        for (let i = 0; i < rawEntries.length; i += 1) {
            const entry = rawEntries[i];
            const displayUrl = toDisplayUrl(entry?.url || '');
            if (!canStoreRecentlyClosedUrl(displayUrl)) continue;
            entries.push({
                ...entry,
                url: resolveInternalPageUrl(displayUrl),
                title: entry?.title || displayUrl,
            });
            if (i <= activeIndex) index = entries.length - 1;
        }

        if (entries.length === 0) return null;
        return { entries, index: Math.max(0, Math.min(index, entries.length - 1)) };
    } catch (err) {
        console.warn('Failed to capture navigation history snapshot:', err?.message || err);
        return null;
    }
}

function captureClosedTabSnapshot(context, tabId) {
    if (!context || !tabId) return null;
    if (State.detachedTabWindows.has(tabId)) return null;

    if (context.sleepingTabs[tabId]) {
        const sleep = context.sleepingTabs[tabId];
        const displayUrl = toDisplayUrl(sleep.url || '');
        if (!canStoreRecentlyClosedUrl(displayUrl)) {
            if (context.ghostWindow) {
                return {
                    id: tabId,
                    title: (sleep.title || '').trim() || 'Ghost Window',
                    url: '',
                    history: null,
                    favicon: sleep.favicon || null,
                    isSleeping: true,
                };
            }
            return null;
        }
        return {
            id: tabId,
            title: (sleep.title || '').trim() || displayUrl,
            url: displayUrl,
            history: sleep.history || null,
            favicon: sleep.favicon || null,
            isSleeping: true,
        };
    }

    const view = context.tabs[tabId];
    if (!view || view.webContents.isDestroyed()) return null;
    const tabWebContents = view.webContents;
    const rawUrl = tabWebContents.getURL();
    const displayUrl = toDisplayUrl(rawUrl);
    if (!canStoreRecentlyClosedUrl(displayUrl)) {
        if (context.ghostWindow) {
            return {
                id: tabId,
                title: (tabWebContents.getTitle() || '').trim() || 'Ghost Window',
                url: '',
                history: null,
                favicon: null,
                isSleeping: false,
            };
        }
        return null;
    }
    return {
        id: tabId,
        title: (tabWebContents.getTitle() || '').trim() || displayUrl,
        url: displayUrl,
        history: captureNavigationHistorySnapshot(tabWebContents),
        favicon: null,
        isSleeping: false,
    };
}

function captureClosedWindowSnapshot(context) {
    if (!context || context.stealthWindow) return null;

    const sessionWindow = readDecodedSessionDoc()?.windowsById?.[context.windowId] || null;
    const persistedTabsById = new Map(
        Array.isArray(sessionWindow?.tabs)
            ? sessionWindow.tabs
                .filter((tab) => tab?.id)
                .map((tab) => [tab.id, tab])
            : [],
    );
    const tabIds = new Set([
        ...persistedTabsById.keys(),
        ...Object.keys(context.tabs),
        ...Object.keys(context.sleepingTabs),
    ]);
    const tabs = [];
    for (const tabId of tabIds) {
        const snap = captureClosedTabSnapshot(context, tabId) || persistedTabsById.get(tabId);
        if (snap) tabs.push(snap);
    }
    if (tabs.length === 0) return null;

    let activeTabId = context.activeTabId || sessionWindow?.activeTabId;
    if (!activeTabId || !tabs.some((t) => t.id === activeTabId)) {
        activeTabId = tabs[tabs.length - 1].id;
    }

    let bounds = null;
    try {
        if (context.window && !context.window.isDestroyed()) {
            bounds = context.window.getBounds();
        }
    } catch (_) { }

    return {
        type: 'window',
        profileId: context.profileId,
        ghostWindow: !!context.ghostWindow,
        bounds,
        tabs,
        activeTabId,
    };
}

function truncateMenuLabel(value, maxLength = 70) {
    if (!value) return '';
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function recentlyClosedEntryLabel(entry) {
    if (!entry) return '';
    if (entry.type === 'window') {
        const count = entry.tabs?.length || 0;
        const prefix = entry.ghostWindow ? 'Ghost Window' : 'Window';
        if (count === 1) {
            const only = entry.tabs[0];
            const title = only.title || only.url || (entry.ghostWindow ? 'Ghost Window' : 'New Tab');
            return truncateMenuLabel(entry.ghostWindow ? `Ghost: ${title}` : title);
        }
        return `${prefix} (${count} tabs)`;
    }
    return truncateMenuLabel(entry.title || entry.url);
}

function recentlyClosedEntryTooltip(entry) {
    if (!entry) return '';
    if (entry.type === 'window') {
        const prefix = entry.ghostWindow ? '[Ghost Window]\n' : '';
        return prefix + (entry.tabs || []).map((t) => t.url).filter(Boolean).join('\n');
    }
    return entry.url || '';
}

function getOrCreateRecentlyClosedForProfile(profileId) {
    if (!State.recentlyClosedTabsByProfile.has(profileId)) {
        State.recentlyClosedTabsByProfile.set(profileId, []);
    }
    return State.recentlyClosedTabsByProfile.get(profileId);
}

function triggerMenuRebuild() {
    const menuUI = require('../ui/menu');
    if (menuUI && typeof menuUI.rebuildApplicationMenu === 'function') {
        menuUI.rebuildApplicationMenu();
    }
}

function pushRecentlyClosedEntry(profileId, entry) {
    if (!profileId || !entry) return;
    const stack = getOrCreateRecentlyClosedForProfile(profileId);
    let normalized;

    if (entry.type === 'window') {
        const isGhost = !!entry.ghostWindow;
        const tabs = (entry.tabs || []).filter((t) => t && (canStoreRecentlyClosedUrl(t.url) || (isGhost && (t.url === '' || !t.url))));
        if (tabs.length === 0) return;
        let activeTabId = entry.activeTabId;
        if (!activeTabId || !tabs.some((t) => t.id === activeTabId)) {
            activeTabId = tabs[tabs.length - 1].id;
        }
        normalized = {
            type: 'window',
            profileId: entry.profileId || profileId,
            ghostWindow: isGhost,
            bounds: entry.bounds || null,
            tabs,
            activeTabId,
            closedAt: Date.now(),
        };
    } else {
        if (!canStoreRecentlyClosedUrl(entry.url)) return;
        normalized = {
            type: 'tab',
            title: (entry.title || '').trim(),
            url: toDisplayUrl(entry.url),
            history: entry.history || null,
            ghostWindow: !!entry.ghostWindow,
            closedAt: Date.now(),
        };
    }

    stack.unshift(normalized);
    if (stack.length > MAX_RECENTLY_CLOSED_TABS) {
        stack.length = MAX_RECENTLY_CLOSED_TABS;
    }
    if (State.appLogger) {
        State.appLogger.info('recently-closed:push', {
            profileId,
            type: normalized.type,
            url: normalized.url,
            ghostWindow: normalized.ghostWindow,
            tabCount: normalized.tabs?.length || undefined,
            stackSize: stack.length,
        });
    }
    triggerMenuRebuild();
}

/** @deprecated Use pushRecentlyClosedEntry */
function pushRecentlyClosedTab(profileId, entry) {
    if (!entry) return;
    pushRecentlyClosedEntry(profileId, { type: 'tab', ...entry });
}

function restoreRecentlyClosedTabInContext(context, entry) {
    if (!context || !entry?.url) return false;
    const tabManager = require('../windows/tabManager');
    const newTabId = tabManager.generateTabId();
    const stealthTab = !!context.stealthWindow;
    const { resolveTabLoadUrl } = require('../utils/navigation');
    const resolvedUrl = resolveTabLoadUrl(entry.url);

    tabManager.createTab(context, newTabId, resolvedUrl, stealthTab, {
        activate: true,
        navigationHistory: entry.history,
    });

    if (State.appLogger) {
        State.appLogger.info('recently-closed:restore-tab', {
            windowId: context.windowId,
            profileId: context.profileId,
            tabId: newTabId,
            url: entry.url,
            historyLength: entry.history?.entries?.length || 0,
        });
    }

    if (context.window && !context.window.webContents.isDestroyed()) {
        const C = require('../../src/constants/conditionStrings.cjs');
        context.window.webContents.send(C.IPC_EVENT.TAB_CREATED, {
            id: newTabId,
            isStealth: stealthTab,
            url: toDisplayUrl(entry.url),
            title: entry.title || '',
        });
    }
    return true;
}

function restoreRecentlyClosedWindowEntry(entry) {
    const profileId = entry?.profileId;
    if (!profileId || !entry?.tabs?.length) return false;

    const { ensureProfile } = require('./profileService');
    const { createWindow } = require('../windows/windowManager');
    ensureProfile(profileId);

    const isGhost = !!entry.ghostWindow;
    const bootstrapPayload = {
        ghostWindow: isGhost,
        restoreWindow: {
            tabs: entry.tabs,
            activeTabId: entry.activeTabId,
        },
    };

    const targetContext = createWindow({
        profileId,
        ghostWindow: isGhost,
        bounds: entry.bounds || null,
        bootstrapPayload,
    });

    if (State.appLogger) {
        State.appLogger.info('recently-closed:restore-window', {
            profileId,
            windowId: targetContext.windowId,
            ghostWindow: isGhost,
            bounds: entry.bounds || null,
            tabCount: entry.tabs.length,
            activeTabId: entry.activeTabId,
        });
    }
    return true;
}

function consumeRecentlyClosedWindowForProfile(profileId) {
    if (!profileId) return null;
    const stack = getOrCreateRecentlyClosedForProfile(profileId);
    const index = stack.findIndex((entry) => (
        entry?.type === 'window' &&
        !entry.ghostWindow &&
        entry.profileId === profileId &&
        Array.isArray(entry.tabs) &&
        entry.tabs.length > 0
    ));
    if (index < 0) return null;
    const [entry] = stack.splice(index, 1);
    triggerMenuRebuild();

    if (State.appLogger) {
        State.appLogger.info('recently-closed:consume-window-for-profile', {
            profileId,
            closedAt: entry.closedAt,
            tabCount: entry.tabs.length,
            remaining: stack.length,
        });
    }
    return entry;
}

function restoreRecentlyClosedEntry(context, entry) {
    if (!entry) return false;
    if (entry.type === 'window') {
        return restoreRecentlyClosedWindowEntry(entry);
    }
    return restoreRecentlyClosedTabInContext(context, entry);
}

function resolveRestoreTargetContext(profileId, callerContext = null) {
    if (callerContext && !callerContext.window?.isDestroyed() && callerContext.profileId === profileId) {
        return callerContext;
    }
    const focused = getWindowContextForShellFallback();
    if (focused && focused.profileId === profileId) return focused;
    for (const ctx of State.windowContextsById.values()) {
        if (
            ctx.profileId === profileId &&
            !ctx.stealthWindow &&
            !ctx.ghostWindow &&
            ctx.window &&
            !ctx.window.isDestroyed()
        ) {
            return ctx;
        }
    }
    const { createWindow } = require('../windows/windowManager');
    return createWindow({ profileId });
}

function restoreRecentlyClosed(closedAt = null, callerContext = null) {
    const focusedContext = callerContext || getWindowContextForShellFallback();
    const profileId = focusedContext?.profileId || State.defaultProfileId;
    if (!profileId) return;

    const stack = getOrCreateRecentlyClosedForProfile(profileId);
    if (stack.length === 0) return;

    const targetIndex = closedAt == null
        ? 0
        : stack.findIndex((entry) => entry && entry.closedAt === closedAt);
    if (targetIndex < 0) return;
    const [entry] = stack.splice(targetIndex, 1);
    triggerMenuRebuild();
    if (!entry) return;

    if (State.appLogger) {
        State.appLogger.info('recently-closed:restore', {
            profileId,
            type: entry.type,
            ghostWindow: !!entry.ghostWindow,
            closedAt: entry.closedAt,
            remaining: stack.length,
        });
    }

    if (entry.type === 'window') {
        restoreRecentlyClosedWindowEntry(entry);
        return;
    }

    const targetContext = resolveRestoreTargetContext(entry.profileId || profileId, callerContext);
    restoreRecentlyClosedTabInContext(targetContext, entry);
}

/** @deprecated Use restoreRecentlyClosed */
function restoreRecentlyClosedTab(closedAt = null) {
    restoreRecentlyClosed(closedAt);
}

function buildRecentlyClosedMenuItems() {
    const context = getWindowContextForShellFallback();
    const profileId = context?.profileId || State.defaultProfileId;
    if (!profileId) return [{ label: 'No recently closed tabs', enabled: false }];
    const stack = getOrCreateRecentlyClosedForProfile(profileId);
    if (stack.length === 0) {
        return [{ label: 'No recently closed tabs', enabled: false }];
    }

    return stack.map((entry) => ({
        label: recentlyClosedEntryLabel(entry),
        toolTip: recentlyClosedEntryTooltip(entry),
        click: () => restoreRecentlyClosed(entry.closedAt),
    }));
}

module.exports = {
    getSessionPath,
    clearSessionSnapshot,
    readDecodedSessionDoc,
    findSessionWindowIdForProfile,
    captureNavigationHistorySnapshot,
    captureClosedTabSnapshot,
    captureClosedWindowSnapshot,
    truncateMenuLabel,
    recentlyClosedEntryLabel,
    recentlyClosedEntryTooltip,
    getOrCreateRecentlyClosedForProfile,
    pushRecentlyClosedEntry,
    pushRecentlyClosedTab,
    restoreRecentlyClosedTabInContext,
    restoreRecentlyClosedWindowEntry,
    consumeRecentlyClosedWindowForProfile,
    restoreRecentlyClosedEntry,
    resolveRestoreTargetContext,
    restoreRecentlyClosed,
    restoreRecentlyClosedTab,
    buildRecentlyClosedMenuItems
};