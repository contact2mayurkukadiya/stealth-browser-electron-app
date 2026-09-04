
const { WebContentsView } = require('electron');
const path = require('path');
const State = require('../state');
const { buildSecureWebPreferences } = require('../../runtime/webPreferences');
const { applyIdentityToWebContents } = require('../../runtime/browserIdentity');
const { isViewWebContentsAlive } = require('./windowContextUtils');
const { sendChromeOverlayThemePatch, sendChromeOmniboxOverlayThemePatch, sendChromeShellMenuOverlayThemePatch } = require('../services/settingsService');
const C = require('../../src/constants/conditionStrings.cjs');

function createChromeOverlayLayer(context) {
    if (context.chromeOverlayView) return;
    const overlayView = new WebContentsView({
        webPreferences: buildSecureWebPreferences(),
    });
    applyIdentityToWebContents(overlayView.webContents);
    overlayView.setBackgroundColor('#00000000');
    overlayView.webContents.once('did-finish-load', () => {
        sendChromeOverlayThemePatch(context);
    });
    overlayView.webContents.loadURL('app://localhost/chrome-overlay.html').catch((err) => {
        console.error('chrome-overlay load', err);
    });
    context.window.contentView.addChildView(overlayView);
    overlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    context.chromeOverlayView = overlayView;
}

function createChromeOmniboxOverlayLayer(context) {
    if (context.chromeOmniboxOverlayView) return;
    context.chromeOmniboxOverlayReady = false;
    const overlayView = new WebContentsView({
        webPreferences: buildSecureWebPreferences(),
    });
    applyIdentityToWebContents(overlayView.webContents);
    overlayView.setBackgroundColor('#00000000');
    overlayView.webContents.once('did-finish-load', () => {
        context.chromeOmniboxOverlayReady = true;
        sendChromeOmniboxOverlayThemePatch(context);
        replayOmniboxOverlayPatchIfNeeded(context);
    });
    overlayView.webContents.on('blur', () => {
        dismissOmniboxChromeOverlayOnBlur(context);
    });
    overlayView.webContents.loadURL('app://localhost/chrome-overlay.html?omnibox=1').catch((err) => {
        console.error('chrome-omnibox-overlay load', err);
    });
    context.window.contentView.addChildView(overlayView);
    overlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    context.chromeOmniboxOverlayView = overlayView;
}

function createChromeShellMenuOverlayLayer(context) {
    if (context.chromeShellMenuOverlayView) return;
    const overlayView = new WebContentsView({
        webPreferences: buildSecureWebPreferences(),
    });
    applyIdentityToWebContents(overlayView.webContents);
    overlayView.setBackgroundColor('#00000000');
    overlayView.webContents.once('did-finish-load', () => {
        sendChromeShellMenuOverlayThemePatch(context);
    });
    overlayView.webContents.on('blur', () => {
        dismissChromeShellMenuOverlayOnBlur(context);
    });
    overlayView.webContents.loadURL('app://localhost/chrome-overlay.html?shellMenu=1').catch((err) => {
        console.error('chrome-shell-menu-overlay load', err);
    });
    context.window.contentView.addChildView(overlayView);
    overlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    context.chromeShellMenuOverlayView = overlayView;
}

function createTooltipOverlay(context) {
    const tooltipView = new WebContentsView({
        webPreferences: buildSecureWebPreferences(),
    });

    applyIdentityToWebContents(tooltipView.webContents);
    tooltipView.setBackgroundColor('#00000000'); // Transparent background
    tooltipView.webContents.loadURL('app://localhost/tooltip.html');

    // Add it last so it's on top of all other views
    context.window.contentView.addChildView(tooltipView);
    tooltipView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); // Hide initially
    context.tooltipView = tooltipView;
}

function ensureChromeOverlayOnTop(context) {
    if (!context?.window?.contentView) return;
    const cv = context.window.contentView;
    const activeId = context.activeTabId;
    const tabView = activeId && !State.detachedTabWindows.has(activeId) ? context.tabs[activeId] : null;

    // Lazy loaded to avoid circular dependencies
    const { getLensSession } = require('./lensManager');
    const { layoutTabContentContainer, addTabContentChildView } = require('./tabManager');

    const lensSession = getLensSession(context, activeId, false);
    try {
        if (context.tabContentView) {
            layoutTabContentContainer(context);
            cv.addChildView(context.tabContentView);
        }
        if (tabView && !tabView.webContents.isDestroyed()) {
            const hideTabForLens = lensSession?.selectionActive && context.activeTabViewRemovedForShellOverlay;
            if (!hideTabForLens) {
                addTabContentChildView(context, tabView);
            }
        }
        if (context.chromeOverlayView && !context.chromeOverlayView.webContents.isDestroyed()) {
            cv.addChildView(context.chromeOverlayView);
        }
        if (context.chromeOmniboxOverlayView && !context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
            cv.addChildView(context.chromeOmniboxOverlayView);
        }
        if (context.chromeShellMenuOverlayView && !context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
            cv.addChildView(context.chromeShellMenuOverlayView);
        }
        if (lensSession?.selectionActive && lensSession.sidebarView && !lensSession.sidebarView.webContents.isDestroyed()) {
            addTabContentChildView(context, lensSession.sidebarHostView || lensSession.sidebarView);
        }
        if (context.tooltipView && !context.tooltipView.webContents.isDestroyed()) {
            cv.addChildView(context.tooltipView);
        }
    } catch (err) {
        console.error('ensureChromeOverlayOnTop', err?.message || err);
    }

}

function clampNumber(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function estimateMenuRowsHeight(items, rowHeight = 38, separatorHeight = 13, padding = 12) {
    if (!Array.isArray(items) || items.length === 0) return padding;
    return items.reduce((sum, item) => (
        sum + (item?.type === 'separator' ? separatorHeight : rowHeight)
    ), padding);
}

function menuOverlayBoundsFromPanel(context, panelRect, options = {}) {
    const pad = 8;
    const shadowMargin = Number.isFinite(Number(options.shadowMargin)) ? Number(options.shadowMargin) : 16;
    const { width: windowW, height: windowH } = context.window.getContentBounds();
    const panelLeft = clampNumber(Math.round(Number(panelRect.left) || 0), pad, windowW - pad);
    const panelTop = clampNumber(Math.round(Number(panelRect.top) || 0), pad, windowH - pad);
    const panelWidth = Math.max(1, Math.round(Number(panelRect.width) || 1));
    const panelHeight = Math.max(1, Math.round(Number(panelRect.height) || 1));
    const extraLeft = Math.max(0, Math.round(Number(options.extraLeft) || 0));
    const extraRight = Math.max(0, Math.round(Number(options.extraRight) || 0));
    const extraTop = Math.max(0, Math.round(Number(options.extraTop) || 0));
    const extraBottom = Math.max(0, Math.round(Number(options.extraBottom) || 0));

    const wantedLeft = panelLeft - extraLeft - shadowMargin;
    const wantedTop = panelTop - extraTop - shadowMargin;
    const wantedRight = panelLeft + panelWidth + extraRight + shadowMargin;
    const wantedBottom = panelTop + panelHeight + extraBottom + shadowMargin;
    const x = Math.max(0, Math.min(windowW - 1, wantedLeft));
    const y = Math.max(0, Math.min(windowH - 1, wantedTop));
    const right = Math.max(x + 1, Math.min(windowW, wantedRight));
    const bottom = Math.max(y + 1, Math.min(windowH, wantedBottom));

    return {
        x,
        y,
        width: Math.max(1, right - x),
        height: Math.max(1, bottom - y),
        viewportWidth: windowW,
        viewportHeight: windowH,
    };
}

function computeMenuOverlayBounds(context, patch) {
    const pad = 8;
    const { width: windowW, height: windowH } = context.window.getContentBounds();
    const kind = patch?.kind;

    if (kind === 'bookmarkContextMenu') {
        const menuWidth = 220;
        const fixedHeight = 290;
        const left = clampNumber(Math.round(Number(patch.clientX) || 0), pad, windowW - menuWidth - pad);
        const top = clampNumber(Math.round(Number(patch.clientY) || 0), pad, windowH - fixedHeight - pad);
        return menuOverlayBoundsFromPanel(context, { left, top, width: menuWidth, height: fixedHeight });
    }

    if (kind === 'bookmarkFolderMenu') {
        const ar = patch.anchorRect || {};
        const minW = 240;
        const maxW = 420;
        let width = Math.round(Number(ar.width) || 280);
        width = clampNumber(width, minW, maxW);
        const left = clampNumber(Math.round(Number(ar.left) || 0), pad, windowW - width - pad);
        const top = clampNumber(Math.round(Number(ar.top) || 0) + Math.round(Number(ar.height) || 0) + 4, pad, windowH - 80 - pad);
        const items = Array.isArray(patch.items) ? patch.items.slice(0, 400) : [];
        const maxH = Math.max(100, Math.min(windowH * 0.9, windowH - top - pad));
        const listHeight = items.length === 0 ? 56 : Math.min(items.length * 36 + 8, maxH - 40);
        const height = Math.min(maxH, 40 + Math.max(56, listHeight));
        return menuOverlayBoundsFromPanel(context, { left, top, width, height });
    }

    if (kind === 'bookmarkEditor') {
        const ar = patch.anchorRect || {};
        const panelWidth = Math.min(340, Math.max(280, windowW - 16));
        const left0 = Math.round(Number(ar.left) || 0);
        const top0 = Math.round(Number(ar.top) || 0);
        const w0 = Math.max(1, Math.round(Number(ar.width) || 32));
        const h0 = Math.max(1, Math.round(Number(ar.height) || 32));
        const left = clampNumber(left0 + w0 - panelWidth, pad, windowW - panelWidth - pad);
        const top = clampNumber(top0 + h0 + 6, pad, windowH - 280 - pad);
        const height = Math.min(480, windowH - top - pad);
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height });
    }

    if (kind === 'profileMenu') {
        const r = patch.menuRect || {};
        const width = Math.round(Number(r.width) || 260);
        const left = clampNumber(Math.round(Number(r.left) || 0), pad, windowW - width - pad);
        const top = clampNumber(Math.round(Number(r.top) || 0), pad, windowH - 80 - pad);
        const items = Array.isArray(patch.items) ? patch.items : [];
        const rows = items.length + 1 + (patch.showEdit ? 1 : 0);
        const separators = 1 + (patch.showEdit ? 1 : 0);
        const height = Math.min(windowH - top - pad, rows * 42 + separators * 13 + 16);
        return menuOverlayBoundsFromPanel(context, { left, top, width, height });
    }

    if (kind === 'siteInfo') {
        const ar = patch.anchorRect || {};
        const panelWidth = 340;
        const left0 = Math.round(Number(ar.left) || 0);
        const top0 = Math.round(Number(ar.top) || 0);
        const h0 = Math.max(1, Math.round(Number(ar.height) || 32));
        const left = clampNumber(left0, pad, windowW - panelWidth - pad);
        const top = clampNumber(top0 + h0 + 6, pad, windowH - 280 - pad);
        const height = Math.max(240, Math.min(windowH * 0.6, windowH - top - pad));
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height });
    }

    if (kind === 'cookieControls' || kind === 'downloadPanel') {
        const ar = patch.anchorRect || {};
        const panelWidth = kind === 'cookieControls' ? 340 : 300;
        const left0 = Math.round(Number(ar.left) || 0);
        const top0 = Math.round(Number(ar.top) || 0);
        const h0 = Math.max(1, Math.round(Number(ar.height) || 32));
        const left = clampNumber(left0, pad, windowW - panelWidth - pad);
        const top = clampNumber(top0 + h0 + 6, pad, windowH - 220 - pad);
        const height = Math.max(160, Math.min(windowH * 0.45, windowH - top - pad));
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height });
    }

    if (kind === 'appMenu') {
        const r = patch.menuRect || {};
        const width = Math.round(Number(r.width) || 320);
        const left = clampNumber(Math.round(Number(r.left) || 0), pad, windowW - width - pad);
        const top = clampNumber(Math.round(Number(r.top) || 0), pad, windowH - 80 - pad);
        const items = Array.isArray(patch.items) ? patch.items : [];
        const submenus = patch.submenus && typeof patch.submenus === 'object' ? patch.submenus : {};
        const submenuHeight = Object.values(submenus).reduce((maxHeight, submenuItems) => (
            Math.max(maxHeight, estimateMenuRowsHeight(submenuItems, 42, 13, 20))
        ), 0);
        const estimatedHeight = Math.max(240, estimateMenuRowsHeight(items, 42, 13, 20), Math.min(420, submenuHeight));
        const height = Math.min(windowH - top - pad, estimatedHeight);
        const submenuWidth = items.reduce((maxWidth, item) => {
            if (!item?.submenuKey || !Array.isArray(submenus[item.submenuKey])) return maxWidth;
            return Math.max(maxWidth, Math.round(Number(item.submenuWidth) || 320));
        }, 0);
        return menuOverlayBoundsFromPanel(context, { left, top, width, height }, {
            extraLeft: submenuWidth ? submenuWidth + 6 : 0,
            extraBottom: submenuWidth ? 16 : 0,
        });
    }

    return null;
}

function computeOmniboxOverlayBounds(context, patch) {
    const dr = patch?.dropdownRect || {};
    const pad = 8;
    const shadowMargin = 12;
    const { width: windowW, height: windowH } = context.window.getContentBounds();
    let w = Math.round(Number(dr.width) || 320);
    let inputH = Math.round(Number(dr.height) || 34);
    let left = Math.round(Number(dr.left) || 0);
    let top = Math.round(Number(dr.top) || 0);
    w = Math.max(200, Math.min(w, windowW - 2 * pad));
    left = Math.max(pad, Math.min(left, windowW - w - pad));
    top = Math.max(pad, Math.min(top, windowH - 120 - pad));

    const items = Array.isArray(patch?.items) ? patch.items.slice(0, 24) : [];
    const rowHeight = 50;
    const scrollPad = 6;
    const maxScrollH = Math.min(412, Math.floor(windowH * 0.7));
    let scrollH = 0;
    if (items.length > 0) {
        scrollH = Math.min(items.length * rowHeight, maxScrollH);
    } else if (String(patch?.query || '').trim()) {
        scrollH = 36;
    }
    const panelH = inputH + scrollPad + scrollH;
    const panelHeight = Math.min(panelH, windowH - top - pad);
    const x = Math.max(0, left - shadowMargin);
    const y = Math.max(0, top - shadowMargin);
    const width = Math.min(windowW - x, w + (left - x) + shadowMargin);
    const height = Math.min(windowH - y, panelHeight + (top - y) + shadowMargin);
    return {
        x,
        y,
        width,
        height: Math.max(inputH + (top - y), height),
    };
}

function layoutOmniboxOverlayBounds(context, patch) {
    if (!context?.chromeOmniboxOverlayView || context.chromeOmniboxOverlayView.webContents.isDestroyed()) return null;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return null;
    const bounds = computeOmniboxOverlayBounds(context, patch);
    try {
        context.chromeOmniboxOverlayView.setBounds(bounds);
        return bounds;
    } catch (err) {
        console.error('layoutOmniboxOverlayBounds', err?.message || err);
        return null;
    }
}

function notifyOmniboxOverlayDelivered(context) {
    if (!context?.window?.webContents || context.window.webContents.isDestroyed()) return;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
    try {
        context.window.webContents.send(C.IPC_EVENT.OMNIBOX_OVERLAY_DELIVERED);
    } catch (err) {
        console.error('omnibox-overlay:delivered send', err?.message || err);
    }
}

function replayOmniboxOverlayPatchIfNeeded(context) {
    if (!context?.chromeOmniboxOverlayReady) return;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
    const patch = context.lastOmniboxOverlayPatch;
    if (!patch || patch.kind !== 'omniboxSuggestions') return;
    if (!context.chromeOmniboxOverlayView || context.chromeOmniboxOverlayView.webContents.isDestroyed()) return;
    try {
        const replayPatch = { ...patch };
        const overlayBounds = layoutOmniboxOverlayBounds(context, replayPatch);
        if (overlayBounds) replayPatch.overlayBounds = overlayBounds;
        ensureChromeOverlayOnTop(context);
        context.chromeOmniboxOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, replayPatch);
        if (replayPatch.focusInput !== false) {
            setImmediate(() => {
                if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
                focusChromeOmniboxOverlayWebContents(context);
            });
        }
        notifyOmniboxOverlayDelivered(context);
    } catch (err) {
        console.error('replayOmniboxOverlayPatchIfNeeded', err?.message || err);
    }
}

function deliverOmniboxOverlayPatch(context, patch) {
    if (!context?.chromeOmniboxOverlayView || context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
        return { ok: false };
    }
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return { ok: false };
    try {
        context.chromeOverlayOmniboxMode = true;
        context.lastOmniboxOverlayPatch = patch;
        const deliverPatch = { ...patch };
        const overlayBounds = layoutOmniboxOverlayBounds(context, deliverPatch);
        if (overlayBounds) deliverPatch.overlayBounds = overlayBounds;
        ensureChromeOverlayOnTop(context);
        if (context.chromeOmniboxOverlayReady) {
            context.chromeOmniboxOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, deliverPatch);
            if (deliverPatch.focusInput !== false) {
                setImmediate(() => {
                    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
                    focusChromeOmniboxOverlayWebContents(context);
                });
            }
            notifyOmniboxOverlayDelivered(context);
        }
    } catch (err) {
        console.error('deliverOmniboxOverlayPatch', err?.message || err);
        return { ok: false };
    }
    return { ok: true, delivered: !!context.chromeOmniboxOverlayReady };
}

function focusChromeOmniboxOverlayWebContents(context) {
    if (context?.isInitialGhostSpawn) context.isInitialGhostSpawn = false;
    if (!context?.chromeOmniboxOverlayView || context.chromeOmniboxOverlayView.webContents.isDestroyed()) return;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
    try {
        if (context.window && !context.window.isDestroyed()) context.window.focus();
    } catch (_) { /* ignore */ }
    try {
        context.chromeOmniboxOverlayView.webContents.focus();
    } catch (err) {
        console.error('focusChromeOmniboxOverlayWebContents', err?.message || err);
    }
}

/** @deprecated use focusChromeOmniboxOverlayWebContents for omnibox input */
function focusChromeOverlayWebContents(context) {
    focusChromeOmniboxOverlayWebContents(context);
}

function dismissOmniboxChromeOverlayOnBlur(context) {
    if (!context?.chromeOverlayOmniboxMode) return;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
    if (context.chromeOverlayBlurDismissPending) return;
    if (!context.window?.webContents || context.window.webContents.isDestroyed()) return;
    context.chromeOverlayBlurDismissPending = true;
    setImmediate(() => {
        try {
            if (!context.chromeOverlayOmniboxMode) return;
            if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
            if (!context.window?.webContents || context.window.webContents.isDestroyed()) return;
            context.window.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_HOST, {
                type: 'dismiss',
                reason: 'blur',
            });
        } catch (err) {
            console.error('chrome-overlay:v1:blur-dismiss', err?.message || err);
        } finally {
            setTimeout(() => {
                context.chromeOverlayBlurDismissPending = false;
            }, 0);
        }
    });
}

function dismissChromeShellMenuOverlay(context, reason = 'outside') {
    if (!context?.window?.webContents || context.window.webContents.isDestroyed()) return;
    if ((context.chromeShellMenuOverlayAcquireCount || 0) <= 0) return;
    try {
        context.window.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_HOST, {
            type: 'dismiss',
            reason,
        });
    } catch (err) {
        console.error('chrome-shell-menu-overlay:v1:dismiss', err?.message || err);
    }
}

function dismissChromeShellMenuOverlayOnBlur(context) {
    if ((context?.chromeShellMenuOverlayAcquireCount || 0) <= 0) return;
    if (context.chromeShellMenuOverlayBlurDismissPending) return;
    context.chromeShellMenuOverlayBlurDismissPending = true;
    setImmediate(() => {
        try {
            dismissChromeShellMenuOverlay(context, 'blur');
        } finally {
            setTimeout(() => {
                context.chromeShellMenuOverlayBlurDismissPending = false;
            }, 0);
        }
    });
}

function focusChromeShellMenuOverlayWebContents(context) {
    if (context?.isInitialGhostSpawn) context.isInitialGhostSpawn = false;
    if (!context?.chromeShellMenuOverlayView || context.chromeShellMenuOverlayView.webContents.isDestroyed()) return;
    if ((context.chromeShellMenuOverlayAcquireCount || 0) <= 0) return;
    try {
        if (context.window && !context.window.isDestroyed()) context.window.focus();
    } catch (_) { /* ignore */ }
    try {
        context.chromeShellMenuOverlayView.webContents.focus();
    } catch (err) {
        console.error('focusChromeShellMenuOverlayWebContents', err?.message || err);
    }
}

function layoutChromeOverlayBounds(context, patch) {
    if (!context?.chromeOverlayView || context.chromeOverlayView.webContents.isDestroyed()) return null;
    if (context.chromeOverlayAcquireCount <= 0) return null;
    let bounds;

    const { getLensSession, computeLensChromeOverlayBounds } = require('./lensManager');

    if (patch?.kind === 'lensSelection') {
        bounds = context.chromeOverlayFullWindowMode
            ? (() => {
                const { width, height } = context.window.getContentBounds();
                return { x: 0, y: 0, width, height };
            })()
            : computeLensChromeOverlayBounds(context, context.activeTabId);
        context.lensOverlayBounds = bounds;
    } else if (getLensSession(context, context.activeTabId, false)?.selectionActive) {
        bounds = context.chromeOverlayFullWindowMode
            ? (() => {
                const { width, height } = context.window.getContentBounds();
                return { x: 0, y: 0, width, height };
            })()
            : computeLensChromeOverlayBounds(context, context.activeTabId);
        context.lensOverlayBounds = bounds;
    } else {
        context.chromeOverlayFullWindowMode = false;
        const { width, height } = context.window.getContentBounds();
        bounds = { x: 0, y: 0, width, height };
    }
    try {
        context.chromeOverlayView.setBounds(bounds);
        return bounds;
    } catch (err) {
        console.error('layoutChromeOverlayBounds', err?.message || err);
        return null;
    }
}

function layoutChromeOverlayFullWindowBounds(context) {
    if (!context?.chromeOverlayView || context.chromeOverlayView.webContents.isDestroyed()) return null;
    if ((context.chromeOverlayAcquireCount || 0) <= 0) return null;
    context.chromeOverlayFullWindowMode = true;
    const { width, height } = context.window.getContentBounds();
    const bounds = { x: 0, y: 0, width, height };
    try {
        context.chromeOverlayView.setBounds(bounds);
        return bounds;
    } catch (err) {
        console.error('layoutChromeOverlayFullWindowBounds', err?.message || err);
        return null;
    }
}

module.exports = {
    createChromeOverlayLayer,
    createChromeOmniboxOverlayLayer,
    createChromeShellMenuOverlayLayer,
    createTooltipOverlay,
    ensureChromeOverlayOnTop,
    clampNumber,
    estimateMenuRowsHeight,
    menuOverlayBoundsFromPanel,
    computeMenuOverlayBounds,
    computeOmniboxOverlayBounds,
    layoutOmniboxOverlayBounds,
    notifyOmniboxOverlayDelivered,
    replayOmniboxOverlayPatchIfNeeded,
    deliverOmniboxOverlayPatch,
    focusChromeOmniboxOverlayWebContents,
    focusChromeOverlayWebContents,
    dismissOmniboxChromeOverlayOnBlur,
    dismissChromeShellMenuOverlay,
    dismissChromeShellMenuOverlayOnBlur,
    focusChromeShellMenuOverlayWebContents,
    layoutChromeOverlayBounds,
    layoutChromeOverlayFullWindowBounds
};