const { WebContentsView, BrowserWindow, clipboard, Menu } = require('electron');
const path = require('path');
const State = require('../state');
const C = require('../../src/constants/conditionStrings.cjs');
const { UI_HEIGHT, CANONICAL_NTP_HTML } = require('../constants/defaults');

const {
    getWindowContextByTabId,
    getWindowContextForShellFallback,
    getWindowContextByBrowserWindow,
    getHostWindowForTabId
} = require('./windowContextUtils');

const {
    resolveTabLoadUrl,
    isAllowedTabNavigationUrl,
    resolveInternalPageUrl,
    toDisplayUrl,
    isBlankTab,
    shouldReassertOmniboxAfterPageLoad,
    isCustomNewTabDocumentUrl,
    classifyNavigationError,
    buildRedirectBlockedPage,
    buildSearchUrl
} = require('../utils/navigation');

// We use lazy requires for these to prevent circular dependencies
// const overlayManager = require('./overlayManager');
// const lensManager = require('./lensManager');

function createTabContentContainer(context) {
    const electron = require('electron');
    const View = electron.View || require('electron/main').View;
    if (!context?.window?.contentView || typeof View !== 'function') return null;
    try {
        const container = new View();
        context.window.contentView.addChildView(container);
        context.tabContentView = container;
        layoutTabContentContainer(context);
        return container;
    } catch (error) {
        console.warn('tab-content-container unavailable:', error?.message || error);
        context.tabContentView = null;
        return null;
    }
}

function getTabContentParent(context) {
    return context?.tabContentView || context?.window?.contentView || null;
}

function setNativeViewCornerRadius(view, radius) {
    try {
        if (view && typeof view.setBorderRadius === 'function') {
            view.setBorderRadius(radius);
        }
    } catch (_) { }
}

function addTabContentChildView(context, view) {
    if (!view) return false;
    const parent = getTabContentParent(context);
    if (!parent || typeof parent.addChildView !== 'function') return false;
    try {
        parent.addChildView(view);
        return true;
    } catch (_) {
        if (parent !== context?.window?.contentView && context?.window?.contentView) {
            try {
                context.window.contentView.addChildView(view);
                return true;
            } catch (_) { }
        }
        return false;
    }
}

function removeTabContentChildView(context, view) {
    if (!view) return false;
    const parent = getTabContentParent(context);
    if (parent && typeof parent.removeChildView === 'function') {
        try {
            parent.removeChildView(view);
            return true;
        } catch (_) { }
    }
    if (parent !== context?.window?.contentView && context?.window?.contentView) {
        try {
            context.window.contentView.removeChildView(view);
            return true;
        } catch (_) { }
    }
    return false;
}

function generateTabId() {
    State.generatedTabCounter += 1;
    return `tab-${Date.now()}-${State.generatedTabCounter}`;
}

function hideActiveTabViewForShellOverlay(context) {
    if (!context?.activeTabId || State.detachedTabWindows.has(context.activeTabId)) return;
    const view = context.tabs[context.activeTabId];
    if (!view || view.webContents.isDestroyed()) return;
    context.isActiveTabTemporarilyHidden = true;
    try {
        removeTabContentChildView(context, view);
        context.activeTabViewRemovedForShellOverlay = true;
    } catch (err) {
        console.error('hideActiveTabViewForShellOverlay removeChildView:', err?.message || err);
        try {
            view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } catch (_) { /* ignore */ }
    }
}

function restoreActiveTabViewFromShellOverlay(context) {
    if (!context?.activeTabId || State.detachedTabWindows.has(context.activeTabId)) return;
    const view = context.tabs[context.activeTabId];
    if (!view || view.webContents.isDestroyed()) return;
    context.isActiveTabTemporarilyHidden = false;
    if (context.activeTabViewRemovedForShellOverlay) {
        try {
            addTabContentChildView(context, view);
            context.activeTabViewRemovedForShellOverlay = false;
        } catch (err) {
            console.error('restoreActiveTabViewFromShellOverlay addChildView:', err?.message || err);
        }
    }
    try {
        layoutActiveTabView(context, context.activeTabId);
    } catch (err) {
        console.error('restoreActiveTabViewFromShellOverlay setBounds:', err?.message || err);
    }
    require('./overlayManager').ensureChromeOverlayOnTop(context);
}

function resetTabWebContentsScale(view) {
    const webContents = view?.webContents;
    if (!webContents || webContents.isDestroyed()) return;
    try { webContents.setZoomFactor(1); } catch (_) { }
    try { webContents.setZoomLevel(0); } catch (_) { }
    if (typeof webContents.setVisualZoomLevelLimits === 'function') {
        try {
            const result = webContents.setVisualZoomLevelLimits(1, 1);
            if (result && typeof result.catch === 'function') result.catch(() => { });
        } catch (_) { }
    }
}

function layoutTabContentContainer(context) {
    if (!context?.tabContentView || !context?.window || context.window.isDestroyed()) return;
    try {
        const { width, height } = context.window.getContentBounds();
        context.tabContentView.setBounds({ x: 0, y: 0, width, height });
        if (typeof context.tabContentView.setBackgroundColor === 'function') {
            const { getChromeShellBackgroundColor } = require('./lensManager');
            context.tabContentView.setBackgroundColor(getChromeShellBackgroundColor(context));
        }
    } catch (_) { }
}

function layoutActiveTabView(context, tabId = context?.activeTabId) {
    if (!context || !tabId || State.detachedTabWindows.has(tabId)) return;
    const view = context.tabs[tabId];
    if (!view || view.webContents.isDestroyed()) return;

    const { getLensSession, getActiveTabContentBounds, layoutLensSidebar } = require('./lensManager');
    const lensSession = getLensSession(context, tabId, false);

    if (lensSession?.selectionActive) {
        // Keep the live view hidden/collapsed during selection
        try {
            view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } catch (_) { }
    } else {
        // Restore standard bounds on exit
        resetTabWebContentsScale(view);
        const bounds = getActiveTabContentBounds(context, tabId);
        view.setBounds(bounds);
        setNativeViewCornerRadius(view, 0);
    }

    layoutLensSidebar(context, tabId);
}

function sendOmniboxFocusToShell(context, tabId, selectAll, openOverlay = false) {
    if (!context?.window || context.window.isDestroyed()) return;
    if (context.ghostWindow) {
        if (!context.window.webContents || context.window.webContents.isDestroyed()) return;
        context.window.webContents.send(C.IPC_EVENT.OMNIBOX_FOCUS, {
            tabId,
            selectAll,
            openOverlay: !!openOverlay,
        });
        return;
    }
    try { context.window.focus(); } catch (_) { /* ignore */ }
    if (context.window.webContents && !context.window.webContents.isDestroyed()) {
        context.window.webContents.focus();
    }
    if (!context.window.webContents || context.window.webContents.isDestroyed()) return;
    context.window.webContents.send(C.IPC_EVENT.OMNIBOX_FOCUS, {
        tabId,
        selectAll,
        openOverlay: !!openOverlay,
    });
}

function activateTabInContext(context, id) {
    if (!context || !context.tabs[id]) return false;

    const overlayManager = require('./overlayManager');
    const lensManager = require('./lensManager');

    if (context.activeTabId !== id) {
        lensManager.suspendLensSessionPresentation(context, context.activeTabId);
        overlayManager.dismissChromeShellMenuOverlay(context, 'browser-action');
    }
    const skipSameTab =
        context.activeTabId === id &&
        !State.detachedTabWindows.has(id) &&
        !context.isActiveTabTemporarilyHidden;

    if (skipSameTab) {
        layoutActiveTabView(context, id);
        overlayManager.ensureChromeOverlayOnTop(context);
        return true;
    }
    if (State.detachedTabWindows.has(id)) {
        const w = State.detachedTabWindows.get(id);
        if (w && !w.isDestroyed()) {
            w.show();
            w.focus();
        }
        return true;
    }
    context.isActiveTabTemporarilyHidden = false;
    context.activeTabViewRemovedForShellOverlay = false;
    for (const tid of Object.keys(context.tabs)) {
        if (State.detachedTabWindows.has(tid)) continue;
        try {
            removeTabContentChildView(context, context.tabs[tid]);
        } catch (_) { }
    }
    lensManager.detachLensSidebarsExcept(context, id);
    addTabContentChildView(context, context.tabs[id]);
    context.activeTabId = id;
    layoutActiveTabView(context, id);

    const activeUrl = context.tabs[id]?.webContents.getURL() ?? '';
    const blankActive = isBlankTab(activeUrl);
    if (!blankActive && !context.ghostWindow) {
        context.tabs[id].webContents.focus();
    }
    if (context.ghostWindow && process.platform === 'win32') {
        const { hookWindowChildren } = require('../native');
        hookWindowChildren(context.window);
    }
    if (context.window && !context.window.webContents.isDestroyed()) {
        context.window.webContents.send(C.IPC_EVENT.TAB_SWITCHED, { id });
    }
    const lensSession = lensManager.getLensSession(context, id, false);
    if (lensSession?.selectionActive) {
        lensManager.restoreActiveLensTabPresentation(context, id);
    } else if (context.chromeOverlayView && !context.chromeOverlayView.webContents.isDestroyed()) {
        try {
            context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
            context.chromeOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } catch (_) { }
    }

    if (blankActive && !context.ghostWindow) {
        context.omniboxFocusGen = (context.omniboxFocusGen || 0) + 1;
        const omniboxGen = context.omniboxFocusGen;
        setImmediate(() => {
            if (context.omniboxFocusGen !== omniboxGen) return;
            sendOmniboxFocusToShell(context, id, true, false);
        });
    }

    overlayManager.ensureChromeOverlayOnTop(context);

    return true;
}

function activateTab(id) {
    const context = getWindowContextByTabId(id) || getWindowContextForShellFallback();
    return activateTabInContext(context, id);
}

function layoutDetachedTabView(tabId) {
    const context = getWindowContextByTabId(tabId);
    if (!context) return;
    const view = context.tabs[tabId];
    const win = State.detachedTabWindows.get(tabId);
    if (!view || view.webContents.isDestroyed() || !win || win.isDestroyed()) return;
    const { width, height } = win.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
}

function moveTabToDetachedWindow(id, fallbackTabId) {
    const context = getWindowContextByTabId(id) || getWindowContextForShellFallback();
    if (!context) return { ok: false };
    if (context.stealthWindow) return { ok: false };
    activateOrWakeTab(id);
    if (!context.tabs[id] || State.detachedTabWindows.has(id)) {
        return { ok: false };
    }

    const view = context.tabs[id];
    if (!view || view.webContents.isDestroyed()) return { ok: false };
    const tabWebContents = view.webContents;
    const movedTabUrl = tabWebContents.getURL();
    const { captureNavigationHistorySnapshot } = require('../services/sessionService');
    const movedTabHistory = captureNavigationHistorySnapshot(tabWebContents);
    const movedTabTitle = tabWebContents.getTitle();
    if (!movedTabUrl) return { ok: false };

    if (context.activeTabId === id) {
        const next =
            fallbackTabId && context.tabs[fallbackTabId] && !State.detachedTabWindows.has(fallbackTabId)
                ? fallbackTabId
                : Object.keys(context.tabs).find((tid) => tid !== id && !State.detachedTabWindows.has(tid));
        if (next) {
            activateTabInContext(context, next);
        } else {
            context.activeTabId = null;
        }
    }

    try {
        removeTabContentChildView(context, view);
    } catch (_) { }
    try {
        view.webContents.destroy();
    } catch (_) { }

    require('./lensManager').destroyLensSession(context, id);
    delete context.tabs[id];
    delete context.sleepingTabs[id];
    State.tabIdToWindowId.delete(id);
    State.pendingTransitionsByTab.delete(String(id));

    if (State.historyService) State.historyService.clearTab(id);
    const compatDiagnostics = require('../../compatibilityDiagnostics');
    compatDiagnostics.clear(id);

    const { createWindow } = require('./windowManager');
    const targetContext = createWindow({ profileId: context.profileId });
    State.windowBootstrapById.set(targetContext.windowId, {
        movedTab: {
            url: toDisplayUrl(movedTabUrl),
            title: movedTabTitle || '',
            isStealth: false,
            history: movedTabHistory,
        },
    });

    return { ok: true, mode: 'full-shell-window' };
}

function openUrlInNewTab(targetUrl, options = {}) {
    console.log('targetUrl', targetUrl);
    console.log('options', options);
    const context = options.context || getWindowContextByBrowserWindow(State.mainWindow);
    if (!context) return false;
    const openInBackground = options.background === true;
    const resolvedTargetUrl = resolveInternalPageUrl(targetUrl);
    console.log('resolvedTargetUrl', resolvedTargetUrl);
    console.log('openInBackground', openInBackground);
    if (!isAllowedTabNavigationUrl(resolvedTargetUrl)) return false;

    console.log('context', context);
    const newTabId = generateTabId();
    const stealthTab = !!context.stealthWindow;
    createTab(context, newTabId, resolvedTargetUrl, stealthTab, { activate: !openInBackground });

    if (context.window && !context.window.webContents.isDestroyed()) {
        context.window.webContents.send(C.IPC_EVENT.TAB_CREATED, { id: newTabId, isStealth: stealthTab, url: resolvedTargetUrl });
    }
    if (!openInBackground) {
        activateTabInContext(context, newTabId);
    }
    return true;
}

function getActiveTabView() {
    const context = getWindowContextByBrowserWindow(State.mainWindow);
    if (!context || !context.activeTabId) return null;
    return context.tabs[context.activeTabId] || null;
}

function getTabIdByDisplayUrl(targetDisplayUrl) {
    if (!targetDisplayUrl) return null;
    const { normalizeInternalSchemeUrl } = require('../utils/navigation');
    const targetNorm = normalizeInternalSchemeUrl(targetDisplayUrl);

    const context = getWindowContextByBrowserWindow(State.mainWindow);
    if (!context) return null;
    for (const [id, view] of Object.entries(context.tabs)) {
        if (!view || view.webContents.isDestroyed()) continue;
        const currentNorm = normalizeInternalSchemeUrl(toDisplayUrl(view.webContents.getURL()));
        if (currentNorm === targetNorm) return id;
    }

    for (const [id, entry] of Object.entries(context.sleepingTabs)) {
        const cand = entry.url.startsWith('app://') ? toDisplayUrl(entry.url) : entry.url;
        if (normalizeInternalSchemeUrl(cand) === targetNorm) return id;
    }

    return null;
}

function activateOrWakeTab(id) {
    const context = getWindowContextByTabId(id) || getWindowContextForShellFallback();
    if (!context) return false;
    if (!id) return false;
    if (!context.tabs[id] && context.sleepingTabs[id]) {
        const sleep = context.sleepingTabs[id];
        const resolvedUrl = resolveTabLoadUrl(sleep.url);
        const sleepHistory = sleep.history || null;
        delete context.sleepingTabs[id];
        createTab(context, id, resolvedUrl, !!context.stealthWindow, {
            navigationHistory: sleepHistory,
        });

        if (context.window && !context.window.webContents.isDestroyed()) {
            context.window.webContents.send(C.IPC_EVENT.TAB_AWOKEN, { id });
        }
    }
    return activateTabInContext(context, id);
}

function openOrActivateSettingsTab() {
    const existingSettingsTabId = getTabIdByDisplayUrl(C.URL.SETTINGS_DISPLAY);
    if (existingSettingsTabId) {
        return activateOrWakeTab(existingSettingsTabId);
    }
    return openUrlInNewTab(C.URL.SETTINGS_DISPLAY, { background: false });
}

function navigateActiveTabHome() {
    const context = getWindowContextForShellFallback();
    const { getLensSession, closeGoogleLensSelection } = require('./lensManager');
    if (getLensSession(context, context?.activeTabId, false)?.selectionActive) {
        closeGoogleLensSelection(context, { closeSidebar: true });
    }
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return;
    resetTabWebContentsScale(activeView);
    activeView.webContents.loadURL('https://www.google.com');
}

function goBackInActiveTab() {
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return;
    activeView.webContents.navigationHistory.goBack();
}

function goForwardInActiveTab() {
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return;
    activeView.webContents.navigationHistory.goForward();
}

function openViewSourceForActiveTab() {
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return;
    const currentUrl = activeView.webContents.getURL();
    if (!currentUrl || currentUrl.startsWith(C.URL.SCHEME_VIEW_SOURCE)) return;
    if (currentUrl.startsWith(C.URL.SCHEME_DATA)) return;
    openUrlInNewTab(`${C.URL.SCHEME_VIEW_SOURCE}${currentUrl}`, { background: false });
}

function openDevToolsForActiveTab(panel) {
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return;
    const webContents = activeView.webContents;
    webContents.openDevTools({ mode: 'right', activate: true });
    if (!panel) return;

    const panelScript = `
        (() => {
            const panelName = ${JSON.stringify(panel)};
            const trySelectPanel = () => {
                try {
                    if (typeof InspectorFrontendAPI !== 'undefined' && InspectorFrontendAPI.showPanel) {
                        InspectorFrontendAPI.showPanel(panelName);
                        return true;
                    }
                    if (typeof UI !== 'undefined' && UI.inspectorView && UI.inspectorView.showPanel) {
                        UI.inspectorView.showPanel(panelName);
                        return true;
                    }
                } catch (_) {}
                return false;
            };
            if (!trySelectPanel()) setTimeout(trySelectPanel, 120);
        })();
    `;

    const selectPanel = () => {
        const devToolsWebContents = webContents.devToolsWebContents;
        if (!devToolsWebContents || devToolsWebContents.isDestroyed()) return;
        devToolsWebContents.executeJavaScript(panelScript).catch(() => { });
    };

    if (webContents.isDevToolsOpened()) {
        selectPanel();
    } else {
        webContents.once('devtools-opened', selectPanel);
    }
}

function openUndockedDevToolsForActiveTab(context, panel = C.DEVTOOLS_PANEL.ELEMENTS) {
    const activeView = context?.activeTabId ? context.tabs[context.activeTabId] : getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return;
    const wc = activeView.webContents;
    wc.openDevTools({ mode: 'undocked', activate: true });
    if (!panel) return;

    const panelScript = `
        (() => {
            const panelName = ${JSON.stringify(panel)};
            const trySelectPanel = () => {
                try {
                    if (typeof InspectorFrontendAPI !== 'undefined' && InspectorFrontendAPI.showPanel) {
                        InspectorFrontendAPI.showPanel(panelName);
                        return true;
                    }
                    if (typeof UI !== 'undefined' && UI.inspectorView && UI.inspectorView.showPanel) {
                        UI.inspectorView.showPanel(panelName);
                        return true;
                    }
                } catch (_) {}
                return false;
            };
            if (!trySelectPanel()) setTimeout(trySelectPanel, 120);
        })();
    `;

    const selectPanel = () => {
        const devToolsWebContents = wc.devToolsWebContents;
        if (!devToolsWebContents || devToolsWebContents.isDestroyed()) return;
        devToolsWebContents.executeJavaScript(panelScript).catch(() => { });
    };

    if (wc.isDevToolsOpened()) {
        selectPanel();
    } else {
        wc.once('devtools-opened', selectPanel);
    }
}

function printActiveTab() {
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return false;
    activeView.webContents.print({}, (success, failureReason) => {
        if (!success && failureReason) {
            console.error('Print failed:', failureReason);
        }
    });
    return true;
}

function triggerFindInActiveTab() {
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return false;
    try {
        activeView.webContents.focus();
        const modifier = process.platform === 'darwin' ? 'meta' : 'control';
        activeView.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: [modifier] });
        activeView.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: [modifier] });
        return true;
    } catch (error) {
        console.error('Find shortcut failed:', error?.message || error);
        return false;
    }
}

function buildDevToolsTypographyCss() {
    let monoStack;
    if (process.platform === C.PLATFORM.DARWIN) {
        monoStack = "ui-monospace, 'SF Mono', Menlo, Monaco, 'Courier New', monospace";
    } else if (process.platform === 'win32') {
        monoStack = "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace";
    } else {
        monoStack = "'Liberation Mono', 'DejaVu Sans Mono', 'Ubuntu Mono', monospace";
    }
    return `:root {
  --monospace-font-family: ${monoStack} !important;
  --source-code-font-family: ${monoStack} !important;
}
body {
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}`;
}

function installDevToolsTypographyOnOpen(webContents) {
    webContents.on('devtools-opened', () => {
        const devTools = webContents.devToolsWebContents;
        if (!devTools || devTools.isDestroyed()) return;
        devTools.insertCSS(buildDevToolsTypographyCss(), { cssOrigin: 'user' }).catch(() => { });
    });
}

function createTab(context, id, url = C.URL.NTP_DISPLAY, isStealth = false, options = {}) {
    if (!context) return;
    console.log('id', id);
    console.log('url', url);
    const shouldActivate = options.activate !== false;
    const effectiveStealth = !!context.stealthWindow;
    const tabPartition = context.stealthWindow ? context.stealthTabsPartition : context.partition;
    const { buildSecureWebPreferences } = require('../../runtime/webPreferences');
    const { applyIdentityToWebContents } = require('../../runtime/browserIdentity');
    const { installSessionNetworkGuards, recordCompatEvent } = require('../services/networkService');

    const view = new WebContentsView({
        webPreferences: buildSecureWebPreferences({ partition: tabPartition }),
    });

    context.tabs[id] = view;
    State.tabIdToWindowId.set(id, context.window.id);

    if (State.appLogger) {
        State.appLogger.info('tab:create', {
            windowId: context.windowId,
            profileId: context.profileId,
            tabId: id,
            url,
            isStealth: !!isStealth,
            shouldActivate,
            restoresHistory: !!options.navigationHistory,
        });
    }

    if (!shouldActivate) {
        addTabContentChildView(context, view);
        view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    if (context.ghostWindow && process.platform === 'win32') {
        const { hookWindowChildren } = require('../native');
        hookWindowChildren(context.window);
    }

    const webContentsNumericId = view.webContents.id;
    State.webContentsIdToTabId.set(webContentsNumericId, id);
    resetTabWebContentsScale(view);

    view.webContents.on('destroyed', () => {
        if (State.appLogger) {
            State.appLogger.info('tab:webcontents-destroyed', {
                windowId: context.windowId,
                profileId: context.profileId,
                tabId: id,
                webContentsId: webContentsNumericId,
            });
        }
        State.webContentsIdToTabId.delete(webContentsNumericId);
        const { clearTabTopLevelRegisterableDomain } = require('../../runtime/sessionPolicy');
        clearTabTopLevelRegisterableDomain(webContentsNumericId);
    });

    applyIdentityToWebContents(view.webContents);
    installSessionNetworkGuards(view.webContents.session, {
        profileId: context.profileId,
        isStealthSession: !!context.stealthWindow,
    });
    installDevToolsTypographyOnOpen(view.webContents);

    view.webContents.setWindowOpenHandler(({ url: targetUrl, disposition }) => {
        if (State.appLogger) {
            State.appLogger.info('tab:window-open-request', {
                windowId: context.windowId,
                profileId: context.profileId,
                tabId: id,
                url: targetUrl,
                disposition,
            });
        }
        if (!isAllowedTabNavigationUrl(targetUrl)) {
            console.warn(`[Security] Blocked popup/open to: ${targetUrl}`);
            if (State.appLogger) {
                State.appLogger.warn('security:blocked-window-open', {
                    windowId: context.windowId,
                    profileId: context.profileId,
                    tabId: id,
                    url: targetUrl,
                });
            }
            return { action: 'deny' };
        }

        const isBackgroundTab = disposition === 'background-tab';
        openUrlInNewTab(targetUrl, { background: isBackgroundTab, context });

        return { action: 'deny' };
    });

    view.webContents.on('will-navigate', (event, targetUrl) => {
        const allowed = isAllowedTabNavigationUrl(targetUrl);
        if (!allowed) {
            console.warn(`[Security] Blocked navigation to: ${targetUrl}`);
            if (State.appLogger) {
                State.appLogger.warn('security:blocked-navigation', {
                    windowId: context.windowId,
                    profileId: context.profileId,
                    tabId: id,
                    url: targetUrl,
                });
            }
            event.preventDefault();
        }
    });

    const { REDIRECT_WINDOW_MS, MAX_MAINFRAME_REDIRECTS } = require('../constants/defaults');
    const { getHostnameSafe, isLikelyTrackingRedirectUrl } = require('../utils/navigation');
    const redirectGuard = { startedAt: 0, count: 0 };

    view.webContents.on('will-redirect', (event, targetUrl, isInPlace, isMainFrame) => {
        if (!isMainFrame) return;

        const now = Date.now();
        if (!redirectGuard.startedAt || now - redirectGuard.startedAt > REDIRECT_WINDOW_MS) {
            redirectGuard.startedAt = now;
            redirectGuard.count = 0;
        }
        redirectGuard.count += 1;

        const currentHost = getHostnameSafe(view.webContents.getURL());
        const redirectHost = getHostnameSafe(targetUrl);
        const isCrossSiteRedirect = currentHost && redirectHost && currentHost !== redirectHost;
        const isTrackingRedirect = isCrossSiteRedirect && isLikelyTrackingRedirectUrl(targetUrl);
        const isRedirectLoop = redirectGuard.count > MAX_MAINFRAME_REDIRECTS;

        if (!isTrackingRedirect && !isRedirectLoop) return;

        event.preventDefault();
        const reasonText = isRedirectLoop
            ? `Blocked because this tab performed more than ${MAX_MAINFRAME_REDIRECTS} redirects within ${Math.round(REDIRECT_WINDOW_MS / 1000)} seconds.`
            : 'Blocked because the redirect target matches known tracking/csync redirect patterns.';

        console.warn(`[RedirectGuard] Blocked redirect to ${targetUrl}. Reason: ${reasonText}`);
        if (State.appLogger) {
            State.appLogger.warn('security:blocked-redirect', {
                windowId: context.windowId,
                profileId: context.profileId,
                tabId: id,
                fromUrl: view.webContents.getURL(),
                targetUrl,
                reason: reasonText,
            });
        }
        recordCompatEvent(id, {
            type: 'redirect-blocked',
            fromUrl: view.webContents.getURL(),
            targetUrl,
            reason: reasonText,
        });
        const blockedHtml = buildRedirectBlockedPage(targetUrl, reasonText);
        setImmediate(() => {
            if (!view.webContents.isDestroyed()) {
                view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(blockedHtml)}`);
            }
        });
    });

    view.webContents.on('enter-html-full-screen', () => {
        State.htmlFullscreenTabId = id;
        const host = getHostWindowForTabId(id);
        host.setFullScreen(true);
        const { width, height } = host.getContentBounds();
        view.setBounds({ x: 0, y: 0, width, height });
    });

    view.webContents.on('leave-html-full-screen', () => {
        State.htmlFullscreenTabId = null;
        const host = getHostWindowForTabId(id);
        host.setFullScreen(false);
        const { width, height } = host.getContentBounds();
        const detached = State.detachedTabWindows.has(id);
        view.setBounds(
            detached
                ? { x: 0, y: 0, width, height }
                : { x: 0, y: UI_HEIGHT, width, height: height - UI_HEIGHT },
        );
    });

    view.webContents.on('context-menu', (_event, params) => {
        const contextTemplate = [];
        const hasSelection = Boolean(params.selectionText && params.selectionText.trim());
        const linkUrl = params.linkURL || '';
        const imageUrl = params.srcURL || '';
        const isLinkContext = Boolean(linkUrl);
        const isImageContext = params.mediaType === 'image' && Boolean(imageUrl);

        if (isLinkContext) {
            contextTemplate.push(
                { label: 'Open link in new tab', click: () => openUrlInNewTab(linkUrl, { background: false }) },
                { label: 'Open link in new tab in background', click: () => openUrlInNewTab(linkUrl, { background: true }) },
                { label: 'Open link in current tab', click: () => view.webContents.loadURL(linkUrl) },
                { type: 'separator' },
                { label: 'Copy link address', click: () => clipboard.writeText(linkUrl) },
            );
        }

        if (isImageContext) {
            if (contextTemplate.length > 0) contextTemplate.push({ type: 'separator' });
            contextTemplate.push(
                { label: 'Open image in new tab', click: () => openUrlInNewTab(imageUrl, { background: false }) },
                { label: 'Copy image address', click: () => clipboard.writeText(imageUrl) },
            );
        }

        if (params.isEditable) {
            if (contextTemplate.length > 0) contextTemplate.push({ type: 'separator' });
            contextTemplate.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
        } else if (hasSelection) {
            if (contextTemplate.length > 0) contextTemplate.push({ type: 'separator' });
            contextTemplate.push({ role: 'copy' });
        }

        if (!params.isEditable) {
            if (contextTemplate.length > 0) contextTemplate.push({ type: 'separator' });
            contextTemplate.push(
                { label: 'Back', enabled: view.webContents.canGoBack(), click: () => view.webContents.goBack() },
                { label: 'Forward', enabled: view.webContents.canGoForward(), click: () => view.webContents.goForward() },
                { label: 'Reload', click: () => view.webContents.reload() },
            );
        }

        if (contextTemplate.length > 0) contextTemplate.push({ type: 'separator' });
        contextTemplate.push({
            label: 'Inspect Element',
            click: () => view.webContents.inspectElement(params.x, params.y),
        });

        const contextMenu = Menu.buildFromTemplate(contextTemplate);
        contextMenu.popup();
    });

    const { handleShortcuts } = require('../ui/shortcuts');
    view.webContents.on('before-input-event', handleShortcuts);

    view.webContents.on('page-title-updated', (e, title) => {
        if (!context.window || context.window.isDestroyed() || context.window.webContents.isDestroyed()) return;
        const { toDisplayUrl, isInternalPageUrl } = require('../utils/navigation');
        const currentDisplayUrl = toDisplayUrl(view.webContents.getURL());
        context.window.webContents.send(C.IPC_EVENT.TAB_UPDATE, { id, title, url: currentDisplayUrl });
        if (!effectiveStealth && currentDisplayUrl && !currentDisplayUrl.startsWith('data:') && !isInternalPageUrl(currentDisplayUrl)) {
            if (State.historyService) {
                State.historyService.updateTitle(context.profileId, currentDisplayUrl, title).catch((err) => {
                    console.error('Failed to update history title:', err);
                });
            }
        }
    });

    view.webContents.on('page-favicon-updated', (e, favicons) => {
        if (!context.window || context.window.isDestroyed() || context.window.webContents.isDestroyed()) return;
        const { toDisplayUrl } = require('../utils/navigation');
        context.window.webContents.send(C.IPC_EVENT.TAB_UPDATE, { id, favicon: favicons[0] || null, url: toDisplayUrl(view.webContents.getURL()) });
    });

    view.webContents.on('did-start-loading', () => {
        if (!context.window || context.window.isDestroyed() || context.window.webContents.isDestroyed()) return;
        resetTabWebContentsScale(view);
        const { toDisplayUrl } = require('../utils/navigation');
        context.window.webContents.send(C.IPC_EVENT.TAB_UPDATE, { id, isLoading: true, url: toDisplayUrl(view.webContents.getURL()) });
    });

    view.webContents.on('did-stop-loading', () => {
        if (!context.window || context.window.isDestroyed() || context.window.webContents.isDestroyed()) return;
        const { toDisplayUrl } = require('../utils/navigation');
        context.window.webContents.send(C.IPC_EVENT.TAB_UPDATE, { id, isLoading: false, url: toDisplayUrl(view.webContents.getURL()) });
    });

    view.webContents.on('did-finish-load', () => {
        resetTabWebContentsScale(view);
        const loadedUrl = view.webContents.getURL();
        if (context.activeTabId !== id) return;

        if (shouldReassertOmniboxAfterPageLoad(loadedUrl)) {
            setImmediate(() => {
                if (context.activeTabId !== id) return;
                sendOmniboxFocusToShell(context, id, false, false);
            });
            return;
        }

        if (isCustomNewTabDocumentUrl(loadedUrl) && isBlankTab(loadedUrl)) {
            setImmediate(() => {
                if (context.activeTabId !== id) return;
                sendOmniboxFocusToShell(context, id, true, false);
            });
        }
    });

    const { consumeNextNavigationTransition, isInternalPageUrl } = require('../utils/navigation');

    view.webContents.on('did-navigate', (event, targetUrl) => {
        resetTabWebContentsScale(view);
        const { toDisplayUrl } = require('../utils/navigation');
        let displayUrl = toDisplayUrl(targetUrl);
        if (State.appLogger) {
            State.appLogger.info('tab:navigate', {
                windowId: context.windowId,
                profileId: context.profileId,
                tabId: id,
                url: displayUrl,
            });
        }
        recordCompatEvent(id, { type: 'navigated', url: displayUrl, rawUrl: targetUrl });
        context.window.webContents.send(C.IPC_EVENT.URL_CHANGED, { id, url: displayUrl });
        if (!effectiveStealth && !targetUrl.startsWith('data:') && !isInternalPageUrl(targetUrl)) {
            if (State.historyService) {
                State.historyService.recordVisit(context.profileId, {
                    tabId: id,
                    url: displayUrl,
                    title: view.webContents.getTitle() || displayUrl,
                    transition: consumeNextNavigationTransition(id),
                }).catch((err) => {
                    console.error('Failed to record history:', err);
                });
            }
        }
    });

    view.webContents.on('did-navigate-in-page', (event, targetUrl) => {
        resetTabWebContentsScale(view);
        const { toDisplayUrl } = require('../utils/navigation');
        let displayUrl = toDisplayUrl(targetUrl);
        if (State.appLogger) {
            State.appLogger.info('tab:navigate-in-page', {
                windowId: context.windowId,
                profileId: context.profileId,
                tabId: id,
                url: displayUrl,
            });
        }
        context.window.webContents.send(C.IPC_EVENT.URL_CHANGED, { id, url: displayUrl });
        if (!effectiveStealth && !targetUrl.startsWith('data:') && !isInternalPageUrl(targetUrl)) {
            if (State.historyService) {
                State.historyService.recordVisit(context.profileId, {
                    tabId: id,
                    url: displayUrl,
                    title: view.webContents.getTitle() || displayUrl,
                    transition: consumeNextNavigationTransition(id),
                }).catch((err) => {
                    console.error('Failed to record in-page history:', err);
                });
            }
        }
    });

    view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        if (errorCode === -3) return;

        console.log(`Navigation failed: ${validatedURL} (${errorCode}: ${errorDescription})`);
        if (State.appLogger) {
            State.appLogger.warn('tab:load-failed', {
                windowId: context.windowId,
                profileId: context.profileId,
                tabId: id,
                url: validatedURL,
                errorCode,
                errorDescription,
            });
        }

        recordCompatEvent(id, { type: 'load-failed', validatedURL, errorCode, errorDescription });

        if (errorCode === -105) {
            const { loadSettings } = require('../services/settingsService');
            const searchQuery = validatedURL.replace(/^https?:\/\//, '').replace(/\/$/, '');
            const activeEngine = (loadSettings().searchEngine) || 'google';
            const searchFallbackUrl = buildSearchUrl(activeEngine, searchQuery);
            recordCompatEvent(id, { type: 'dns-fallback', query: searchQuery, fallbackUrl: searchFallbackUrl });
            setImmediate(() => {
                if (!view.webContents.isDestroyed()) {
                    view.webContents.loadURL(searchFallbackUrl);
                }
            });
            return;
        }

        const errorMeta = classifyNavigationError(errorCode, errorDescription);
        const errorHtml = `
            <!DOCTYPE html>
            <html style="background: #253035; color: white; font-family: sans-serif; height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0;">
                <div style="text-align: center; max-width: 500px; padding: 20px;">
                    <img src="app://localhost/assets/images/exclamation.svg" width="64" height="64" alt="" style="margin-bottom: 20px;" />
                    <h1 style="margin: 0 0 10px 0; font-size: 24px;">${errorMeta.title}</h1>
                    <p style="color: #aaa; margin: 0 0 10px 0;">${errorMeta.details}</p>
                    <p style="color: #9fc6d8; margin: 0 0 20px 0;">${errorMeta.suggestion}</p>
                    <p style="color: #aaa; margin: 0 0 20px 0;">URL: <strong>${validatedURL}</strong></p>
                    <div style="background: #1e2c32; padding: 15px; border-radius: 8px; font-family: monospace; color: #ff6b6b; font-size: 14px;">
                        Error: ${errorDescription} (${errorCode})
                    </div>
                </div>
            </html>
        `;

        setImmediate(() => {
            if (!view.webContents.isDestroyed()) {
                view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
            }
        });
    });

    const restoreHistory = options.navigationHistory;
    if (restoreHistory?.entries?.length && view.webContents.navigationHistory?.restore) {
        view.webContents.navigationHistory.restore({
            entries: restoreHistory.entries,
            index: restoreHistory.index,
        }).catch((err) => {
            console.warn('Failed to restore tab navigation history:', err?.message || err);
            if (!view.webContents.isDestroyed()) {
                view.webContents.loadURL(resolveTabLoadUrl(url));
            }
        });
    } else {
        view.webContents.loadURL(resolveTabLoadUrl(url));
    }

    if (shouldActivate) {
        activateTabInContext(context, id);
    }
}

module.exports = {
    createTabContentContainer,
    getTabContentParent,
    setNativeViewCornerRadius,
    addTabContentChildView,
    removeTabContentChildView,
    generateTabId,
    hideActiveTabViewForShellOverlay,
    restoreActiveTabViewFromShellOverlay,
    resetTabWebContentsScale,
    layoutTabContentContainer,
    layoutActiveTabView,
    sendOmniboxFocusToShell,
    activateTabInContext,
    activateTab,
    layoutDetachedTabView,
    moveTabToDetachedWindow,
    openUrlInNewTab,
    getActiveTabView,
    getTabIdByDisplayUrl,
    activateOrWakeTab,
    openOrActivateSettingsTab,
    navigateActiveTabHome,
    goBackInActiveTab,
    goForwardInActiveTab,
    openViewSourceForActiveTab,
    openDevToolsForActiveTab,
    openUndockedDevToolsForActiveTab,
    printActiveTab,
    triggerFindInActiveTab,
    createTab
};