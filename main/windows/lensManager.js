
const { WebContentsView, clipboard, nativeImage } = require('electron');
const path = require('path');
const State = require('../state');
const C = require('../../src/constants/conditionStrings.cjs');
const { buildSecureWebPreferences } = require('../../runtime/webPreferences');
const {
    UI_HEIGHT, LENS_SIDEBAR_MIN_WIDTH, LENS_SIDEBAR_DEFAULT_RATIO,
    LENS_SIDEBAR_MAX_RATIO, LENS_PANEL_GAP, LENS_WORKSPACE_PADDING,
    LENS_SITE_CONTAINER_MAX_SCALE, LENS_PAGE_MIN_SCALE, LENS_PANEL_RADIUS,
    LENS_MOBILE_USER_AGENT
} = require('../constants/defaults');
const { getWindowContextByBrowserWindow, isViewWebContentsAlive } = require('./windowContextUtils');

// Lazy requires for cyclic breaking
// const { layoutActiveTabView, addTabContentChildView, removeTabContentChildView, resetTabWebContentsScale } = require('./tabManager');
// const { createChromeOverlayLayer, layoutChromeOverlayBounds, ensureChromeOverlayOnTop } = require('./overlayManager');
// const { loadSettings, getChromeOverlayThemePatchForContext } = require('../services/settingsService');
// const { isGoogleLensSearchableUrl } = require('../utils/navigation');

function getLensSession(context, tabId = context?.activeTabId, create = false) {
    if (!context || !tabId) return null;
    if (!context.lensSessions) context.lensSessions = new Map();
    let sessionState = context.lensSessions.get(tabId);
    if (!sessionState && create) {
        sessionState = {
            tabId,
            sidebarHostView: null,
            sidebarView: null,
            sidebarWidth: null,
            selectionActive: false,
            overlayAcquired: false,
            siteBounds: null,
            lastSelection: null,
            lastSelectionRatio: null,
            lastSelectionText: '',
            lastSelectionImage: null,
            textSnapshot: null,
            pageZoomFactorBeforeLens: null,
            pageScale: 1,
            sourceWidth: null,
            sourceHeight: null,
            magnifierImage: null,
        };
        context.lensSessions.set(tabId, sessionState);
    }
    return sessionState || null;
}

function destroyLensSidebarViews(context, lensSession) {
    if (!lensSession) return;
    const sidebarView = lensSession.sidebarView;
    const { removeTabContentChildView } = require('./tabManager');
    if (sidebarView) {
        removeTabContentChildView(context, lensSession.sidebarHostView || sidebarView);
        const wc = sidebarView.webContents;
        if (wc && typeof wc.isDestroyed === 'function' && !wc.isDestroyed()) {
            try { wc.removeAllListeners(); } catch (_) { }
            try {
                if (wc.debugger?.isAttached?.()) wc.debugger.detach();
            } catch (_) { }
            try { wc.destroy(); } catch (_) { }
        }
        lensSession.sidebarView = null;
    }
    const hostView = lensSession.sidebarHostView;
    if (hostView) {
        try {
            if (sidebarView) hostView.removeChildView(sidebarView);
        } catch (_) { }
        lensSession.sidebarHostView = null;
    }
}

function suspendLensSessionPresentation(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    if (!context || !tabId || !lensSession?.selectionActive) return false;
    const { removeTabContentChildView } = require('./tabManager');

    if (lensSession.sidebarView) {
        removeTabContentChildView(context, lensSession.sidebarHostView || lensSession.sidebarView);
    }

    if (lensSession.overlayAcquired && context.chromeOverlayAcquireCount > 0) {
        context.chromeOverlayAcquireCount -= 1;
    }
    lensSession.overlayAcquired = false;
    repairLensChromeOverlayAcquireCount(context);

    if ((context.chromeOverlayAcquireCount || 0) <= 0 && isViewWebContentsAlive(context.chromeOverlayView)) {
        try {
            context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
            context.chromeOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } catch (_) { }
    }

    if (context.activeTabId === tabId) {
        context.lensOverlayBounds = null;
        context.chromeOverlayFullWindowMode = false;
        context.isActiveTabTemporarilyHidden = false;
        context.activeTabViewRemovedForShellOverlay = false;
    }
    return true;
}

function getFirstActiveLensTabId(context) {
    if (!context?.lensSessions) return null;
    for (const [tabId, sessionState] of context.lensSessions.entries()) {
        if (!sessionState?.selectionActive) continue;
        const view = context.tabs[tabId];
        if (view && !view.webContents.isDestroyed()) return tabId;
    }
    return null;
}

function findActiveLensTabForProfile(profileId) {
    if (!profileId) return null;
    for (const context of State.windowContextsById.values()) {
        if (!context || context.profileId !== profileId) continue;
        const tabId = getFirstActiveLensTabId(context);
        if (tabId) return { context, tabId };
    }
    return null;
}

function countLensOverlayAcquires(context) {
    if (!context?.lensSessions) return 0;
    let required = 0;
    for (const sessionState of context.lensSessions.values()) {
        if (sessionState?.selectionActive && sessionState.overlayAcquired) required += 1;
    }
    return required;
}

function repairLensChromeOverlayAcquireCount(context) {
    const required = countLensOverlayAcquires(context);
    if (required > 0 && (context.chromeOverlayAcquireCount || 0) < required) {
        context.chromeOverlayAcquireCount = required;
    }
}

function ensureLensOverlayAcquired(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.selectionActive) return;
    const { createChromeOverlayLayer } = require('./overlayManager');
    createChromeOverlayLayer(context);
    if (!lensSession.overlayAcquired) {
        context.chromeOverlayAcquireCount = (context.chromeOverlayAcquireCount || 0) + 1;
        lensSession.overlayAcquired = true;
    } else if ((context.chromeOverlayAcquireCount || 0) <= 0) {
        context.chromeOverlayAcquireCount = 1;
    }
}

function restoreActiveLensTabPresentation(context, tabId = context?.activeTabId) {
    if (!context || !tabId) return false;
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.selectionActive) return false;

    const { hideActiveTabViewForShellOverlay, layoutActiveTabView } = require('./tabManager');
    hideActiveTabViewForShellOverlay(context);
    layoutActiveTabView(context, tabId);
    layoutLensSidebar(context, tabId);
    ensureLensOverlayAcquired(context, tabId);
    repairLensChromeOverlayAcquireCount(context);
    return postLensSelectionPatch(context);
}

function getLensSidebarWidth(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.selectionActive || !lensSession.sidebarView || lensSession.sidebarView.webContents.isDestroyed()) return 0;
    const { width } = context.window.getContentBounds();
    const maxWidth = Math.max(220, Math.floor(width * LENS_SIDEBAR_MAX_RATIO));
    const minWidth = Math.min(LENS_SIDEBAR_MIN_WIDTH, maxWidth);
    const preferredWidth = lensSession.sidebarWidth || Math.floor(width * LENS_SIDEBAR_DEFAULT_RATIO);
    return Math.max(minWidth, Math.min(preferredWidth, maxWidth));
}

function getLensLayoutMetrics(context, tabId = context?.activeTabId) {
    if (!context?.window || context.window.isDestroyed()) return null;
    const { width, height } = context.window.getContentBounds();
    const fs = State.htmlFullscreenTabId === tabId;
    const sidebarWidth = fs ? 0 : getLensSidebarWidth(context, tabId);
    const contentTop = fs ? 0 : UI_HEIGHT;
    const contentHeight = fs ? height : Math.max(0, height - UI_HEIGHT);
    const panelGap = fs || sidebarWidth <= 0 ? 0 : LENS_PANEL_GAP;
    const sidebarBounds = sidebarWidth > 0 ? {
        x: Math.max(panelGap, width - sidebarWidth - panelGap),
        y: contentTop + panelGap,
        width: Math.max(0, sidebarWidth),
        height: Math.max(0, contentHeight - (panelGap * 2)),
    } : { x: width, y: contentTop, width: 0, height: contentHeight };
    const leftPanelBounds = sidebarWidth > 0 ? {
        x: panelGap,
        y: contentTop + panelGap,
        width: Math.max(0, sidebarBounds.x - (panelGap * 2)),
        height: Math.max(0, contentHeight - (panelGap * 2)),
    } : {
        x: 0,
        y: contentTop,
        width,
        height: contentHeight,
    };

    return { width, height, fs, sidebarWidth, panelGap, contentTop, contentHeight, sidebarBounds, leftPanelBounds };
}

function computeLensChromeOverlayBounds(context, tabId = context?.activeTabId) {
    const { width, height } = context.window.getContentBounds();
    const metrics = getLensLayoutMetrics(context, tabId);
    if (!metrics || metrics.sidebarWidth <= 0) {
        return { x: 0, y: UI_HEIGHT, width, height: Math.max(0, height - UI_HEIGHT) };
    }
    return {
        x: 0,
        y: metrics.contentTop,
        width: Math.max(0, metrics.sidebarBounds.x),
        height: metrics.contentHeight,
    };
}

function getActiveTabContentBounds(context, tabId = context?.activeTabId) {
    if (!context?.window || context.window.isDestroyed()) return { x: 0, y: UI_HEIGHT, width: 0, height: 0 };
    const metrics = getLensLayoutMetrics(context, tabId);
    if (!metrics) return { x: 0, y: UI_HEIGHT, width: 0, height: 0 };
    const lensSession = getLensSession(context, tabId, false);

    if (lensSession?.selectionActive && !metrics.fs) {
        const leftPanel = metrics.leftPanelBounds;
        const maxContainerWidth = Math.max(1, leftPanel.width - (LENS_WORKSPACE_PADDING * 2));
        const maxContainerHeight = Math.max(1, leftPanel.height - (LENS_WORKSPACE_PADDING * 2));
        const sourceWidth = Math.max(1, Math.round(lensSession.sourceWidth || metrics.width));
        const sourceHeight = Math.max(1, Math.round(lensSession.sourceHeight || metrics.contentHeight));
        const scale = Math.max(
            LENS_PAGE_MIN_SCALE,
            Math.min(
                LENS_SITE_CONTAINER_MAX_SCALE,
                maxContainerWidth / sourceWidth,
                maxContainerHeight / sourceHeight,
            ),
        );
        const containerWidth = Math.floor(sourceWidth * scale);
        const containerHeight = Math.floor(sourceHeight * scale);
        const bounds = {
            x: leftPanel.x + Math.max(0, Math.floor((leftPanel.width - containerWidth) / 2)),
            y: leftPanel.y + Math.max(0, Math.floor((leftPanel.height - containerHeight) / 2)),
            width: Math.max(1, Math.min(containerWidth, maxContainerWidth)),
            height: Math.max(1, Math.min(containerHeight, maxContainerHeight)),
        };
        lensSession.siteBounds = bounds;
        lensSession.pageScale = scale;
        return bounds;
    }
    if (lensSession) {
        lensSession.siteBounds = null;
        lensSession.pageScale = 1;
    }
    return {
        x: 0,
        y: metrics.fs ? 0 : UI_HEIGHT,
        width: Math.max(0, metrics.width - metrics.sidebarWidth),
        height: metrics.contentHeight,
    };
}

function applyLensSidebarMobileViewport(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    const sidebarView = lensSession?.sidebarView;
    if (!context?.window || !sidebarView || sidebarView.webContents.isDestroyed()) return;
    try { sidebarView.webContents.setUserAgent(LENS_MOBILE_USER_AGENT); } catch (_) { }
    try { sidebarView.webContents.setZoomFactor(1); } catch (_) { }
}

function layoutLensSidebar(context, tabId = context?.activeTabId) {
    if (tabId !== context?.activeTabId) return;
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.sidebarView || lensSession.sidebarView.webContents.isDestroyed()) return;
    const metrics = getLensLayoutMetrics(context, tabId);
    if (!metrics) return;
    const radius = metrics.sidebarWidth > 0 ? LENS_PANEL_RADIUS : 0;
    const hostView = lensSession.sidebarHostView || lensSession.sidebarView;
    const { setNativeViewCornerRadius } = require('./tabManager');

    hostView.setBounds(metrics.sidebarBounds);
    setNativeViewCornerRadius(hostView, radius);
    if (typeof hostView.setBackgroundColor === 'function') {
        try { hostView.setBackgroundColor(getChromeShellBackgroundColor(context)); } catch (_) { }
    }
    if (lensSession.sidebarHostView) {
        lensSession.sidebarView.setBounds({
            x: 0,
            y: 0,
            width: Math.max(0, metrics.sidebarBounds.width),
            height: Math.max(0, metrics.sidebarBounds.height),
        });
    } else {
        setNativeViewCornerRadius(lensSession.sidebarView, radius);
    }
    applyLensSidebarMobileViewport(context, tabId);
}

function detachLensSidebarsExcept(context, activeTabId) {
    if (!context?.lensSessions) return;
    const { removeTabContentChildView } = require('./tabManager');
    for (const [tabId, sessionState] of context.lensSessions.entries()) {
        const sidebarView = sessionState?.sidebarView;
        if (!sidebarView || sidebarView.webContents.isDestroyed()) continue;
        if (tabId === activeTabId) continue;
        removeTabContentChildView(context, sessionState.sidebarHostView || sidebarView);
    }
}

function destroyLensSession(context, tabId) {
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession) return;
    if (lensSession.overlayAcquired && context.chromeOverlayAcquireCount > 0) {
        context.chromeOverlayAcquireCount -= 1;
    }
    destroyLensSidebarViews(context, lensSession);
    context.lensSessions.delete(tabId);
    repairLensChromeOverlayAcquireCount(context);
    const remainingLensTabId = getFirstActiveLensTabId(context);
    if (!remainingLensTabId && isViewWebContentsAlive(context.chromeOverlayView)) {
        context.chromeOverlayFullWindowMode = false;
        try {
            context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
            if (context.chromeOverlayAcquireCount <= 0) {
                context.chromeOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            }
        } catch (_) { }
    } else if (
        context.activeTabId &&
        context.activeTabId === remainingLensTabId &&
        getLensSession(context, context.activeTabId, false)?.selectionActive
    ) {
        restoreActiveLensTabPresentation(context, context.activeTabId);
    }
}

function getChromeShellBackgroundColor(context) {
    const { nativeTheme } = require('electron');
    const { getChromeOverlayThemePatchForContext } = require('../services/settingsService');
    try {
        const patch = getChromeOverlayThemePatchForContext(context);
        return patch?.tokens?.['--chrome-shell-tint'] || patch?.tokens?.['--chrome-shell-bg'] || patch?.tokens?.['--chrome-body-bg'] || (patch?.effectiveDark ? '#253035' : '#ffffff');
    } catch (_) {
        return nativeTheme?.shouldUseDarkColors ? '#253035' : '#ffffff';
    }
}

function injectLensSidebarCloseButton(context, tabId) {
    const lensSession = getLensSession(context, tabId, false);
    const sidebarView = lensSession?.sidebarView;
    if (!isViewWebContentsAlive(sidebarView)) return;
    const background = getChromeShellBackgroundColor(context);
    const gutterMaskHeight = Math.max(10, Math.min(18, LENS_PANEL_RADIUS - 6));
    const script = `
        (() => {
            const style = document.getElementById('invisurf-lens-panel-style') || document.createElement('style');
            style.id = 'invisurf-lens-panel-style';
            style.textContent = \`
                html { background: ${background} !important; }
                body { min-height: 100vh; margin: 0 !important; overflow-x: hidden !important; background: ${background} !important; }
                #invisurf-lens-panel-border { position: fixed !important; inset: 0 !important; z-index: 2147483646 !important; border: 1px solid rgba(95, 99, 104, 0.24) !important; border-radius: ${LENS_PANEL_RADIUS}px !important; box-sizing: border-box !important; pointer-events: none !important; }
                .invisurf-lens-gutter-mask { position: fixed !important; left: 0 !important; right: 0 !important; height: ${gutterMaskHeight}px !important; z-index: 2147483645 !important; background: ${background} !important; pointer-events: none !important; }
                #invisurf-lens-gutter-mask-top { top: 0 !important; }
                #invisurf-lens-gutter-mask-bottom { bottom: 0 !important; }
                body::-webkit-scrollbar { width: 10px; }
            \`;
            if (!style.parentNode) document.head.appendChild(style);
            document.documentElement.style.backgroundColor = ${JSON.stringify(background)};
            if (document.body) document.body.style.backgroundColor = ${JSON.stringify(background)};
            const ensureMask = (id) => {
                let mask = document.getElementById(id);
                if (!mask) {
                    mask = document.createElement('div');
                    mask.id = id;
                    mask.className = 'invisurf-lens-gutter-mask';
                    document.documentElement.appendChild(mask);
                }
                return mask;
            };
            ensureMask('invisurf-lens-gutter-mask-top');
            ensureMask('invisurf-lens-gutter-mask-bottom');
            let border = document.getElementById('invisurf-lens-panel-border');
            if (!border) {
                border = document.createElement('div');
                border.id = 'invisurf-lens-panel-border';
                document.documentElement.appendChild(border);
            }
            if (document.getElementById('invisurf-lens-close')) return;
            const meta = document.querySelector('meta[name="viewport"]') || document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
            if (!meta.parentNode) document.head.appendChild(meta);
            const style = document.createElement('style');
            style.id = 'invisurf-lens-mobile-style';
            style.textContent = 'html,body{max-width:100vw!important;overflow-x:hidden!important;}';
            document.head.appendChild(style);
            const btn = document.createElement('button');
            btn.id = 'invisurf-lens-close';
            btn.type = 'button';
            btn.textContent = '×';
            btn.title = 'Close Google Lens';
            btn.setAttribute('aria-label', 'Close Google Lens');
            Object.assign(btn.style, {
                position: 'fixed', top: '8px', right: '8px', zIndex: '2147483647',
                width: '28px', height: '28px', border: '0', borderRadius: '999px',
                background: 'rgba(60,64,67,.9)', color: '#fff', font: '20px/28px system-ui, sans-serif',
                cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.22)',
            });
            btn.addEventListener('click', () => { window.location.href = 'invisurf-lens://close'; });
            document.documentElement.appendChild(btn);
        })();
    `;
    sidebarView.webContents.executeJavaScript(script).catch(() => { });
}

function buildLensSidebarPlaceholderHtml(context) {
    const background = getChromeShellBackgroundColor(context);
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: ${background}; color: #7b8188; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { display: grid; place-items: center; }
    body::before { content: ""; position: fixed; inset: 0; border: 1px solid rgba(95, 99, 104, 0.24); border-radius: ${LENS_PANEL_RADIUS}px; box-sizing: border-box; pointer-events: none; }
    .placeholder { max-width: 220px; text-align: center; font-size: 13px; line-height: 1.45; font-weight: 500; }
  </style>
</head>
<body>
  <div class="placeholder">Drag on site to search on Google Lens</div>
</body>
</html>`;
}

function createLensSidebarHostView(context) {
    const { View } = require('electron');
    if (typeof View !== 'function') return null;
    try {
        const host = new View();
        if (typeof host.setBackgroundColor === 'function') {
            host.setBackgroundColor(getChromeShellBackgroundColor(context));
        }
        const { setNativeViewCornerRadius } = require('./tabManager');
        setNativeViewCornerRadius(host, LENS_PANEL_RADIUS);
        return host;
    } catch (_) {
        return null;
    }
}

function openLensSidebarNavigationInTab(context, url, options = {}) {
    const targetUrl = String(url || '').trim();
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        return false;
    }
    const { openUrlInNewTab } = require('./tabManager');
    return openUrlInNewTab(targetUrl, {
        context,
        background: options.background === true,
        keepLensOpen: true,
    });
}

function createLensSidebar(context, tabId = context?.activeTabId) {
    if (!context || context.window.isDestroyed() || !tabId) return null;
    const lensSession = getLensSession(context, tabId, true);
    if (lensSession.sidebarView && !isViewWebContentsAlive(lensSession.sidebarView)) {
        lensSession.sidebarView = null;
        lensSession.sidebarHostView = null;
    }
    if (isViewWebContentsAlive(lensSession.sidebarView)) {
        return lensSession.sidebarView;
    }

    const sidebar = new WebContentsView({
        webPreferences: buildSecureWebPreferences({ partition: context.partition }),
    });
    try { sidebar.webContents.setBackgroundColor(getChromeShellBackgroundColor(context)); } catch (_) { }
    let sidebarHostView = createLensSidebarHostView(context);
    if (sidebarHostView) {
        try {
            sidebarHostView.addChildView(sidebar);
        } catch (_) {
            sidebarHostView = null;
        }
    }
    sidebar.webContents.setUserAgent(LENS_MOBILE_USER_AGENT);

    const { isGoogleLensSidebarUrl } = require('../utils/navigation');

    sidebar.webContents.setWindowOpenHandler(({ url, disposition }) => {
        const lensUrl = isGoogleLensSidebarUrl(url);
        if (lensUrl) {
            sidebar.webContents.loadURL(url).catch(() => { });
            return { action: 'deny' };
        }
        openLensSidebarNavigationInTab(context, url, {
            background: disposition === 'background-tab',
        });
        return { action: 'deny' };
    });
    sidebar.webContents.on('will-navigate', (event, url) => {
        const lensUrl = isGoogleLensSidebarUrl(url);
        if (String(url || '').startsWith('invisurf-lens://close')) {
            event.preventDefault();
            if (context.activeTabId === tabId) {
                closeGoogleLensSelection(context, { closeSidebar: true });
            } else {
                destroyLensSession(context, tabId);
            }
            return;
        }
        if (!lensUrl) {
            event.preventDefault();
            openLensSidebarNavigationInTab(context, url);
        }
    });
    sidebar.webContents.on('will-redirect', (event, url) => {
        const lensUrl = isGoogleLensSidebarUrl(url);
        if (!lensUrl) {
            event.preventDefault();
            openLensSidebarNavigationInTab(context, url);
        }
    });
    sidebar.webContents.on('did-finish-load', () => {
        injectLensSidebarCloseButton(context, tabId);
    });
    lensSession.sidebarHostView = sidebarHostView;
    lensSession.sidebarView = sidebar;
    sidebar.webContents.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(buildLensSidebarPlaceholderHtml(context)).toString('base64')}`).catch(() => { });

    if (tabId === context.activeTabId) {
        const { addTabContentChildView } = require('./tabManager');
        addTabContentChildView(context, sidebarHostView || sidebar);
        layoutLensSidebar(context, tabId);
    }
    return sidebar;
}

function closeGoogleLensSelection(context, { closeSidebar = false } = {}) {
    if (!context) return;
    const tabId = context.activeTabId;
    const lensSession = getLensSession(context, tabId, false);
    if (lensSession) lensSession.selectionActive = false;
    context.lensOverlayBounds = null;
    context.chromeOverlayFullWindowMode = false;
    if (context.chromeOverlayView && !context.chromeOverlayView.webContents.isDestroyed()) {
        try {
            context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
        } catch (_) { }
    }
    if (lensSession?.overlayAcquired && context.chromeOverlayAcquireCount > 0) {
        context.chromeOverlayAcquireCount -= 1;
        lensSession.overlayAcquired = false;
        repairLensChromeOverlayAcquireCount(context);
        if (context.chromeOverlayAcquireCount <= 0 && context.chromeOverlayView && !context.chromeOverlayView.webContents.isDestroyed()) {
            try { context.chromeOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch (_) { }
        }
    }
    if (lensSession) {
        if (context.activeTabId && context.tabs[context.activeTabId] && lensSession.pageZoomFactorBeforeLens !== null) {
            try { context.tabs[context.activeTabId].webContents.setZoomFactor(lensSession.pageZoomFactorBeforeLens || 1); } catch (_) { }
        }
        lensSession.pageZoomFactorBeforeLens = null;
        lensSession.pageScale = 1;
        lensSession.sourceWidth = null;
        lensSession.sourceHeight = null;
        lensSession.siteBounds = null;
        lensSession.fullSnapshot = null;
        lensSession.snapshotDataUrl = null;
        lensSession.magnifierImage = null;
        lensSession.lastSelectionRatio = null;
        lensSession.lastSelectionText = '';
        lensSession.textSnapshot = null;
    }
    if (closeSidebar && lensSession) {
        destroyLensSidebarViews(context, lensSession);
        context.lensSessions.delete(tabId);
    }

    const { restoreActiveTabViewFromShellOverlay, layoutActiveTabView } = require('./tabManager');
    if (context.activeTabViewRemovedForShellOverlay || context.isActiveTabTemporarilyHidden) {
        restoreActiveTabViewFromShellOverlay(context);
    } else {
        layoutActiveTabView(context, tabId);
    }
    const { ensureChromeOverlayOnTop } = require('./overlayManager');
    ensureChromeOverlayOnTop(context);
}

function postLensSelectionPatch(context) {
    if (!context?.chromeOverlayView || context.chromeOverlayView.webContents.isDestroyed()) return false;
    const lensSession = getLensSession(context, context.activeTabId, false);
    if (!lensSession?.selectionActive) return false;

    const lensMetrics = getLensLayoutMetrics(context, context.activeTabId);
    const tabBounds = getActiveTabContentBounds(context, context.activeTabId);
    if (tabBounds.width < 40 || tabBounds.height < 40) return false;

    const { width: windowWidth, height: windowHeight } = context.window.getContentBounds();
    const sidebarWidth = getLensSidebarWidth(context, context.activeTabId);
    const overlayOriginY = context.chromeOverlayFullWindowMode ? 0 : (lensMetrics?.contentTop ?? UI_HEIGHT);
    const backdropTop = context.chromeOverlayFullWindowMode ? (lensMetrics?.contentTop ?? UI_HEIGHT) : 0;
    const overlayHeight = context.chromeOverlayFullWindowMode
        ? windowHeight
        : (lensMetrics?.contentHeight || 0);

    const siteBounds = {
        x: tabBounds.x,
        y: Math.max(0, tabBounds.y - overlayOriginY),
        width: tabBounds.width,
        height: tabBounds.height,
    };

    const selectionRatio = lensSession.lastSelectionRatio || null;
    const selectionRect = selectionRatio ? {
        x: Math.round(selectionRatio.x * siteBounds.width),
        y: Math.round(selectionRatio.y * siteBounds.height),
        width: Math.max(1, Math.round(selectionRatio.width * siteBounds.width)),
        height: Math.max(1, Math.round(selectionRatio.height * siteBounds.height)),
    } : (lensSession.lastSelection || null);

    const patch = {
        kind: 'lensSelection',
        hint: 'Select any text or image to search with Google Lens',
        sidebarWidth,
        minSidebarWidth: Math.min(LENS_SIDEBAR_MIN_WIDTH, Math.max(220, Math.floor(context.window.getContentBounds().width * LENS_SIDEBAR_MAX_RATIO))),
        maxSidebarWidth: Math.max(220, Math.floor(context.window.getContentBounds().width * LENS_SIDEBAR_MAX_RATIO)),
        windowWidth,
        panelRadius: LENS_PANEL_RADIUS,
        sourceWidth: lensSession.sourceWidth || windowWidth,
        sourceHeight: lensSession.sourceHeight || (lensMetrics?.contentHeight || 0),
        snapshotDataUrl: lensSession.snapshotDataUrl,
        siteBounds,
        leftPanelBounds: lensMetrics ? {
            x: lensMetrics.leftPanelBounds.x,
            y: Math.max(0, lensMetrics.leftPanelBounds.y - overlayOriginY),
            width: lensMetrics.leftPanelBounds.width,
            height: lensMetrics.leftPanelBounds.height,
        } : null,
        sidebarBounds: lensMetrics ? {
            x: lensMetrics.sidebarBounds.x,
            y: Math.max(0, lensMetrics.sidebarBounds.y - overlayOriginY),
            width: lensMetrics.sidebarBounds.width,
            height: lensMetrics.sidebarBounds.height,
        } : null,
        panelGap: lensMetrics?.panelGap || LENS_PANEL_GAP,
        backdropTop,
        contentHeight: overlayHeight,
        selectionRect,
        selectionRatio,
        hasSelectionText: !!lensSession.lastSelectionText,
        hasSelection: !!selectionRect,
    };

    const { layoutChromeOverlayBounds, ensureChromeOverlayOnTop } = require('./overlayManager');
    layoutChromeOverlayBounds(context, patch);
    ensureChromeOverlayOnTop(context);
    context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, patch);
    return true;
}

function resizeGoogleLensSidebar(context, width) {
    const lensSession = getLensSession(context, context?.activeTabId, false);
    if (!lensSession?.sidebarView || lensSession.sidebarView.webContents.isDestroyed()) return false;
    const { width: windowWidth } = context.window.getContentBounds();
    const maxWidth = Math.max(220, Math.floor(windowWidth * LENS_SIDEBAR_MAX_RATIO));
    const minWidth = Math.min(LENS_SIDEBAR_MIN_WIDTH, maxWidth);
    const nextWidth = Math.max(minWidth, Math.min(Math.round(Number(width) || 0), maxWidth));
    lensSession.sidebarWidth = nextWidth;

    const { layoutActiveTabView } = require('./tabManager');
    layoutActiveTabView(context, context.activeTabId);

    if (lensSession.selectionActive) {
        const { layoutChromeOverlayBounds, ensureChromeOverlayOnTop } = require('./overlayManager');
        layoutChromeOverlayBounds(context, { kind: 'lensSelection' });
        ensureChromeOverlayOnTop(context);
    }
    return true;
}

function commitGoogleLensSidebarResize(context, width) {
    const resized = resizeGoogleLensSidebar(context, width);
    if (resized) postLensSelectionPatch(context);
    return resized;
}

function copyLensSelectionImage(context) {
    const lensSession = getLensSession(context, context?.activeTabId, false);
    if (!lensSession?.lastSelectionImage) return false;
    try {
        clipboard.writeImage(nativeImage.createFromBuffer(lensSession.lastSelectionImage));
        return true;
    } catch (error) {
        console.error('Copy Lens image failed:', error?.message || error);
        return false;
    }
}

async function copyLensSelectionText(context) {
    const lensSession = getLensSession(context, context?.activeTabId, false);
    const text = String(lensSession?.lastSelectionText || '').trim();
    if (!text) return false;
    try {
        clipboard.writeText(text);
        return true;
    } catch (error) {
        console.error('Copy Lens text failed:', error?.message || error);
        return false;
    }
}

async function extractLensPageTextSnapshot(activeView) {
    if (!activeView || activeView.webContents.isDestroyed()) return null;
    const script = `
        (() => {
            const root = document.body || document.documentElement;
            if (!root) return null;
            const vv = window.visualViewport;
            const viewportWidth = Math.max(1, Math.round((vv && vv.width) || window.innerWidth || document.documentElement.clientWidth || 1));
            const viewportHeight = Math.max(1, Math.round((vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 1));
            const words = [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    const text = node.nodeValue || '';
                    if (!text.trim()) return NodeFilter.FILTER_REJECT;
                    const parent = node.parentElement;
                    if (!parent || parent.closest('script,style,noscript,template')) return NodeFilter.FILTER_REJECT;
                    const style = window.getComputedStyle(parent);
                    if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            });
            const intersectsViewport = (rect) =>
                rect.width > 0 && rect.height > 0 &&
                rect.right >= 0 && rect.bottom >= 0 &&
                rect.left <= viewportWidth && rect.top <= viewportHeight;
            let node;
            while ((node = walker.nextNode()) && words.length < 4000) {
                const text = node.nodeValue || '';
                const re = /\\S+/g;
                let match;
                while ((match = re.exec(text)) && words.length < 4000) {
                    const range = document.createRange();
                    try {
                        range.setStart(node, match.index);
                        range.setEnd(node, match.index + match[0].length);
                        const rects = Array.from(range.getClientRects()).filter(intersectsViewport);
                        for (const rect of rects) {
                            words.push({ text: match[0], x: rect.left, y: rect.top, width: rect.width, height: rect.height });
                        }
                    } catch (_) { } finally { range.detach(); }
                }
            }
            return { width: viewportWidth, height: viewportHeight, words };
        })();
    `;
    try {
        const snapshot = await activeView.webContents.executeJavaScript(script, true);
        if (!snapshot || !Array.isArray(snapshot.words)) return null;
        return snapshot;
    } catch (error) {
        console.warn('Lens text snapshot failed:', error?.message || error);
        return null;
    }
}

function getLensSelectionText(lensSession, selectionRatio) {
    const snapshot = lensSession?.textSnapshot;
    if (!snapshot?.words?.length || !selectionRatio) return '';
    const rect = {
        x: selectionRatio.x * snapshot.width,
        y: selectionRatio.y * snapshot.height,
        width: selectionRatio.width * snapshot.width,
        height: selectionRatio.height * snapshot.height,
    };
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    const intersects = (word) => {
        const wordRight = word.x + word.width;
        const wordBottom = word.y + word.height;
        return wordRight >= rect.x && word.x <= right && wordBottom >= rect.y && word.y <= bottom;
    };
    const selected = snapshot.words
        .filter(intersects)
        .sort((a, b) => {
            const lineDelta = a.y - b.y;
            if (Math.abs(lineDelta) > 8) return lineDelta;
            return a.x - b.x;
        });
    if (!selected.length) return '';
    const lines = [];
    for (const word of selected) {
        const current = lines[lines.length - 1];
        if (!current || Math.abs(word.y - current.y) > Math.max(8, word.height * 0.8)) {
            lines.push({ y: word.y, words: [word.text] });
        } else {
            current.words.push(word.text);
        }
    }
    return lines.map((line) => line.words.join(' ')).join('\n').trim();
}

async function startGoogleLensSelection(context = getWindowContextByBrowserWindow(State.mainWindow)) {
    if (!context || !context.activeTabId || State.detachedTabWindows.has(context.activeTabId)) return false;
    const activeView = context.tabs[context.activeTabId];
    if (!activeView || activeView.webContents.isDestroyed()) return false;

    const { isGoogleLensSearchableUrl } = require('../utils/navigation');
    const { activateTabInContext, hideActiveTabViewForShellOverlay, layoutActiveTabView } = require('./tabManager');

    try {
        if (!isGoogleLensSearchableUrl(activeView.webContents.getURL())) return false;
    } catch (_) { return false; }

    const existingLens = findActiveLensTabForProfile(context.profileId);
    if (existingLens) {
        try {
            if (!existingLens.context.window.isDestroyed()) {
                existingLens.context.window.focus();
            }
        } catch (_) { }
        if (existingLens.tabId !== context.activeTabId || existingLens.context !== context) {
            activateTabInContext(existingLens.context, existingLens.tabId);
        } else {
            restoreActiveLensTabPresentation(context, existingLens.tabId);
        }
        return true;
    }

    const lensSession = getLensSession(context, context.activeTabId, true);
    lensSession.selectionActive = true;

    try {
        lensSession.textSnapshot = await extractLensPageTextSnapshot(activeView);
        const image = await activeView.webContents.capturePage();
        if (!image || image.isEmpty()) {
            lensSession.selectionActive = false;
            return false;
        }
        lensSession.fullSnapshot = image;
        lensSession.snapshotDataUrl = image.toDataURL();

        const size = image.getSize();
        lensSession.sourceWidth = size.width;
        lensSession.sourceHeight = size.height;
    } catch (err) {
        console.error('Failed to capture webpage for Lens:', err);
        lensSession.selectionActive = false;
        return false;
    }

    createLensSidebar(context, context.activeTabId);
    hideActiveTabViewForShellOverlay(context);
    layoutActiveTabView(context, context.activeTabId);

    const { createChromeOverlayLayer } = require('./overlayManager');
    createChromeOverlayLayer(context);
    if (!lensSession.overlayAcquired) {
        context.chromeOverlayAcquireCount += 1;
        lensSession.overlayAcquired = true;
    }

    return postLensSelectionPatch(context);
}

function submitLensImageInSidebar(context, tabId, pngBuffer, dimensions) {
    const sidebar = createLensSidebar(context, tabId);
    if (!isViewWebContentsAlive(sidebar)) return Promise.resolve(false);
    const imageDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    const uploadUrl = `https://lens.google.com/v3/upload?ep=ccm&s=&st=${Date.now()}`;
    const background = getChromeShellBackgroundColor(context);
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Google Lens</title>
  <style>
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:${background};color:#7b8188;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    body{display:grid;place-items:center}
    .loading{display:grid;place-items:center;gap:10px;text-align:center;font-size:13px;font-weight:500}
    .spinner{width:24px;height:24px;border:3px solid rgba(123,129,136,.28);border-top-color:#1a73e8;border-radius:50%;animation:s 1s linear infinite}
    body::before{content:"";position:fixed;inset:0;border:1px solid rgba(95,99,104,.24);border-radius:${LENS_PANEL_RADIUS}px;box-sizing:border-box;pointer-events:none}
    p{margin:0}
    @keyframes s{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <p>Searching with Google Lens...</p>
  </div>
  <script>
    (async function () {
      try {
        const response = await fetch(${JSON.stringify(imageDataUrl)});
        const blob = await response.blob();
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = ${JSON.stringify(uploadUrl)};
        form.enctype = 'multipart/form-data';
        form.style.display = 'none';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.name = 'encoded_image';
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], 'invisurf-lens.png', { type: 'image/png' }));
        fileInput.files = transfer.files;
        form.appendChild(fileInput);

        const dimensionsInput = document.createElement('input');
        dimensionsInput.type = 'hidden';
        dimensionsInput.name = 'processed_image_dimensions';
        dimensionsInput.value = ${JSON.stringify(`${dimensions.width},${dimensions.height}`)};
        form.appendChild(dimensionsInput);

        document.body.appendChild(form);
        form.submit();
      } catch (error) {
        document.body.innerHTML = '<p>Could not send this image to Google Lens.</p>';
      }
    })();
  </script>
</body>
</html>`;

    return new Promise((resolve) => {
        let finished = false;
        const cleanup = () => {
            sidebar.webContents.removeListener('did-navigate', onNavigate);
            sidebar.webContents.removeListener('did-fail-load', onFail);
        };
        const onNavigate = (_event, targetUrl) => {
            if (!/^https:\/\/lens\.google\.com\//i.test(String(targetUrl || ''))) return;
            finished = true;
            cleanup();
            resolve(true);
        };
        const onFail = (_event, _errorCode, errorDescription) => {
            if (finished) return;
            cleanup();
            console.error('Google Lens sidebar load failed:', errorDescription);
            resolve(false);
        };
        sidebar.webContents.on('did-navigate', onNavigate);
        sidebar.webContents.on('did-fail-load', onFail);
        sidebar.webContents.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`).catch((error) => {
            cleanup();
            console.error('Google Lens submit page failed:', error?.message || error);
            resolve(false);
        });
        setTimeout(() => {
            if (finished || !isViewWebContentsAlive(sidebar)) return;
            cleanup();
            resolve(true);
        }, 8000);
    });
}

async function captureGoogleLensSelection(context, rect = {}) {
    const tabId = context?.activeTabId;
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.selectionActive || !tabId) return false;
    const activeView = context.tabs[tabId];
    if (!activeView || activeView.webContents.isDestroyed()) return false;

    const site = lensSession.siteBounds;
    if (!site || !site.width || !site.height) return false;

    try {
        if (!lensSession.fullSnapshot || lensSession.fullSnapshot.isEmpty()) return false;

        const origSize = lensSession.fullSnapshot.getSize();
        const selectionX = Math.max(0, Math.min(Math.round(Number(rect.x) || 0), Math.max(0, site.width - 1)));
        const selectionY = Math.max(0, Math.min(Math.round(Number(rect.y) || 0), Math.max(0, site.height - 1)));
        const selectionWidth = Math.max(1, Math.min(Math.round(Number(rect.width) || 0), site.width - selectionX));
        const selectionHeight = Math.max(1, Math.min(Math.round(Number(rect.height) || 0), site.height - selectionY));
        if (selectionWidth < 8 || selectionHeight < 8) return false;

        const x = Math.max(0, Math.round((selectionX / site.width) * origSize.width));
        const y = Math.max(0, Math.round((selectionY / site.height) * origSize.height));
        const width = Math.max(1, Math.round((selectionWidth / site.width) * origSize.width));
        const height = Math.max(1, Math.round((selectionHeight / site.height) * origSize.height));

        const safeX = Math.min(x, origSize.width - 1);
        const safeY = Math.min(y, origSize.height - 1);
        const safeWidth = Math.max(1, Math.min(width, origSize.width - safeX));
        const safeHeight = Math.max(1, Math.min(height, origSize.height - safeY));

        const croppedImage = lensSession.fullSnapshot.crop({ x: safeX, y: safeY, width: safeWidth, height: safeHeight });
        const png = croppedImage.toPNG();

        lensSession.lastSelection = { x: selectionX, y: selectionY, width: selectionWidth, height: selectionHeight };
        lensSession.lastSelectionRatio = {
            x: selectionX / site.width,
            y: selectionY / site.height,
            width: selectionWidth / site.width,
            height: selectionHeight / site.height,
        };
        lensSession.lastSelectionText = getLensSelectionText(lensSession, lensSession.lastSelectionRatio);
        lensSession.lastSelectionImage = png;

        await submitLensImageInSidebar(context, tabId, png, { width: safeWidth, height: safeHeight });

        if (context.activeTabId === tabId && lensSession.selectionActive) {
            postLensSelectionPatch(context);
            require('./overlayManager').ensureChromeOverlayOnTop(context);
            try {
                const sidebar = lensSession.sidebarView;
                if (sidebar && !sidebar.webContents.isDestroyed()) {
                    sidebar.webContents.focus();
                }
            } catch (_) { }
        }
        return true;
    } catch (error) {
        console.error('Google Lens capture failed:', error?.message || error);
        if (context.activeTabId === tabId && lensSession.selectionActive) postLensSelectionPatch(context);
        return false;
    }
}

async function refreshLensMagnifierSnapshot(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    const view = tabId ? context?.tabs?.[tabId] : null;
    if (!lensSession?.selectionActive || !view || view.webContents.isDestroyed()) return false;
    try {
        const image = await view.webContents.capturePage();
        if (!image || image.isEmpty()) return false;
        lensSession.magnifierImage = image.toDataURL();
        if (context.activeTabId === tabId && lensSession.selectionActive) postLensSelectionPatch(context);
        return true;
    } catch (error) {
        console.error('Lens magnifier snapshot failed:', error?.message || error);
        return false;
    }
}

module.exports = {
    getLensSession,
    destroyLensSidebarViews,
    suspendLensSessionPresentation,
    getFirstActiveLensTabId,
    findActiveLensTabForProfile,
    countLensOverlayAcquires,
    repairLensChromeOverlayAcquireCount,
    ensureLensOverlayAcquired,
    restoreActiveLensTabPresentation,
    getLensSidebarWidth,
    getLensLayoutMetrics,
    computeLensChromeOverlayBounds,
    getActiveTabContentBounds,
    applyLensSidebarMobileViewport,
    layoutLensSidebar,
    detachLensSidebarsExcept,
    destroyLensSession,
    getChromeShellBackgroundColor,
    injectLensSidebarCloseButton,
    buildLensSidebarPlaceholderHtml,
    createLensSidebarHostView,
    openLensSidebarNavigationInTab,
    createLensSidebar,
    closeGoogleLensSelection,
    postLensSelectionPatch,
    resizeGoogleLensSidebar,
    commitGoogleLensSidebarResize,
    copyLensSelectionImage,
    copyLensSelectionText,
    extractLensPageTextSnapshot,
    getLensSelectionText,
    startGoogleLensSelection,
    submitLensImageInSidebar,
    captureGoogleLensSelection,
    refreshLensMagnifierSnapshot
};