const { BrowserWindow, screen, session } = require('electron');
const path = require('path');
const crypto = require('crypto');
const State = require('../state');
const C = require('../../src/constants/conditionStrings.cjs');
const chromeTheme = require('../../src/theme/chromeTheme.cjs');

const { ensureProfile } = require('../services/profileService');
const { loadSettings, getTitleBarOverlayOptionsForNativeTheme } = require('../services/settingsService');
const { pushRecentlyClosedEntry, captureClosedWindowSnapshot } = require('../services/sessionService');
const { registerAppProtocolForSession, installSessionNetworkGuards } = require('../services/networkService');
const { cleanupStealthCookiesForContext, cleanupSessionOnlyCookiesForProfile } = require('../services/cookieService');

const { applyIdentityToWebContents } = require('../../runtime/browserIdentity');
const { buildSecureWebPreferences } = require('../../runtime/webPreferences');
const { applyShellWindowSecurity, applyContentProtection, applyProfilePickerSecurity } = require('../../runtime/windowSecurity');

const {
    createChromeOverlayLayer,
    createChromeShellMenuOverlayLayer,
    createChromeOmniboxOverlayLayer,
    createTooltipOverlay,
    ensureChromeOverlayOnTop,
    layoutChromeOverlayBounds,
    layoutOmniboxOverlayBounds
} = require('./overlayManager');

/** Usable screen rectangle (excludes dock/taskbar); keeps custom title bar — not OS fullscreen. */
function getPrimaryWorkAreaBounds() {
    try {
        if (!screen || typeof screen.getPrimaryDisplay !== 'function') return null;
        const wa = screen.getPrimaryDisplay().workArea;
        if (!wa || wa.width < 320 || wa.height < 240) return null;
        return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
    } catch {
        return null;
    }
}

function createWindow({ profileId = null, windowId = null, fillWorkArea = true, stealthWindow = false, ghostWindow = false } = {}) {
    const resolvedProfileId = profileId || State.defaultProfileId || `profile-${crypto.randomUUID()}`;
    ensureProfile(resolvedProfileId);
    const partition = `persist:profile-${resolvedProfileId}`;
    const mappedSession = session.fromPartition(partition);
    registerAppProtocolForSession(mappedSession, partition);
    installSessionNetworkGuards(mappedSession, { profileId: resolvedProfileId, isStealthSession: false });

    /** One shared in-memory session per stealth window (all tabs incognito; discarded with the window). */
    let stealthTabsPartition = null;
    if (stealthWindow) {
        stealthTabsPartition = `in-memory:stealth-win-${crypto.randomUUID()}`;
        const stealthTabSession = session.fromPartition(stealthTabsPartition);
        registerAppProtocolForSession(stealthTabSession, stealthTabsPartition);
        installSessionNetworkGuards(stealthTabSession, { profileId: resolvedProfileId, isStealthSession: true });
    }

    const isMac = process.platform === C.PLATFORM.DARWIN;
    const isGhost = !!ghostWindow;
    const workArea = fillWorkArea ? getPrimaryWorkAreaBounds() : null;
    const stealthTitleBarOverlay =
        process.platform !== 'darwin'
            ? chromeTheme.getTitleBarOverlayFromSettings(
                { colorTheme: 'dark', accentTheme: 'default', accentCustomHex: null },
                true,
            )
            : null;

    const window = new BrowserWindow({
        ...(workArea
            ? {
                x: workArea.x,
                y: workArea.y,
                width: workArea.width,
                height: workArea.height,
            }
            : { width: 1200, height: 800 }),
        ...(isGhost
            ? {
                type: isMac ? 'panel' : undefined,
                frame: false,
                transparent: true,
                alwaysOnTop: true,
                acceptFirstMouse: true,
                fullscreenable: false,
                show: false,
            }
            : {
                titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
                ...(isMac
                    ? { trafficLightPosition: { x: 15, y: 15 } }
                    : {
                        titleBarOverlay: stealthWindow ? stealthTitleBarOverlay : getTitleBarOverlayOptionsForNativeTheme(),
                    }
                ),
            }
        ),
        webPreferences: buildSecureWebPreferences({ partition }),
    });

    applyIdentityToWebContents(window.webContents);
    applyShellWindowSecurity(window, { permissionFullscreen: C.PERMISSION.FULLSCREEN });
    applyContentProtection(window, loadSettings().contentProtection);

    const shellEntryUrl = 'app://dist/index.html';
    window.loadURL(shellEntryUrl).catch((error) => {
        console.error('Failed to load shell entry URL:', shellEntryUrl, error);
    });

    const menuUI = require('../ui/menu');
    menuUI.rebuildApplicationMenu();

    const { handleShortcuts } = require('../ui/shortcuts');
    window.webContents.on('before-input-event', handleShortcuts);

    if (!State.mainWindow || State.mainWindow.isDestroyed()) State.mainWindow = window;
    window.on('focus', () => {
        if (context.isInitialGhostSpawn) context.isInitialGhostSpawn = false;
        State.mainWindow = window;
        menuUI.rebuildApplicationMenu();
    });

    const context = {
        window,
        windowId: windowId || `window-${crypto.randomUUID()}`,
        profileId: resolvedProfileId,
        partition,
        stealthWindow: !!stealthWindow,
        ghostWindow: isGhost,
        isInitialGhostSpawn: isGhost,
        stealthTabsPartition,
        tabs: {},
        sleepingTabs: {},
        activeTabId: null,
        isActiveTabTemporarilyHidden: false,
        activeTabViewRemovedForShellOverlay: false,
        tabContentView: null,
        tooltipView: null,
        chromeOverlayView: null,
        chromeOmniboxOverlayView: null,
        chromeShellMenuOverlayView: null,
        chromeOverlayAcquireCount: 0,
        chromeOmniboxOverlayAcquireCount: 0,
        chromeShellMenuOverlayAcquireCount: 0,
        chromeShellMenuOverlayBlurDismissPending: false,
        chromeOverlayOmniboxMode: false,
        chromeOverlayBlurDismissPending: false,
        lastOmniboxOverlayPatch: null,
        chromeOmniboxOverlayReady: false,
        lensSessions: new Map(),
        lensOverlayBounds: null,
        chromeOverlayFullWindowMode: false,
    };
    State.windowContextsById.set(window.id, context);

    const { createTabContentContainer, layoutTabContentContainer, removeTabContentChildView, layoutActiveTabView } = require('./tabManager');
    const { getLensSession, postLensSelectionPatch } = require('./lensManager');

    createTabContentContainer(context);

    if (State.appLogger) {
        State.appLogger.info('window:create', {
            windowId: context.windowId,
            browserWindowId: window.id,
            profileId: context.profileId,
            stealthWindow: context.stealthWindow,
            partition,
        });
    }

    if (isGhost) {
        window.setTitle('InviSurf — Ghost');
        State.windowBootstrapById.set(context.windowId, {
            stealthWindow: !!stealthWindow,
            ghostWindow: true,
        });
        const { applyGhostMode } = require('../native');
        const showGhost = () => {
            try {
                applyGhostMode(window);
                window.showInactive();
            } catch (err) {
                console.error('[windowManager] Failed to show ghost window:', err);
                try { window.show(); } catch (_) { }
            }
        };
        if (window.isVisible()) {
            showGhost();
        } else {
            window.once('ready-to-show', showGhost);
            setTimeout(() => {
                if (!window.isDestroyed() && !window.isVisible()) {
                    showGhost();
                }
            }, 800);
        }
    } else if (stealthWindow) {
        window.setTitle('InviSurf — Stealth');
        State.windowBootstrapById.set(context.windowId, { stealthWindow: true });
    }

    window.on('resize', () => {
        layoutTabContentContainer(context);
        if (context.ghostWindow && process.platform === 'win32') {
            const { hookWindowChildren } = require('../native');
            hookWindowChildren(context.window);
        }
        if (!context.activeTabId || State.detachedTabWindows.has(context.activeTabId)) return;
        const view = context.tabs[context.activeTabId];
        if (!view) return;
        if (context.isActiveTabTemporarilyHidden) {
            if (!context.activeTabViewRemovedForShellOverlay) {
                view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            }
            return;
        }
        layoutActiveTabView(context, context.activeTabId);
        if (getLensSession(context, context.activeTabId, false)?.selectionActive) {
            postLensSelectionPatch(context);
        }
        if ((context.chromeOmniboxOverlayAcquireCount || 0) > 0 && context.lastOmniboxOverlayPatch) {
            layoutOmniboxOverlayBounds(context, context.lastOmniboxOverlayPatch);
        }
        ensureChromeOverlayOnTop(context);
    });

    window.on('close', () => {
        const windowSnapshot = captureClosedWindowSnapshot(context);
        if (State.appLogger) {
            State.appLogger.info('window:close', {
                windowId: context.windowId,
                profileId: context.profileId,
                stealthWindow: context.stealthWindow,
                tabCount: Object.keys(context.tabs).length + Object.keys(context.sleepingTabs).length,
                capturedRecentlyClosedTabs: windowSnapshot?.tabs?.length || 0,
            });
        }
        if (windowSnapshot) {
            pushRecentlyClosedEntry(context.profileId, windowSnapshot);
        }

        for (const tabId of Object.keys(context.tabs)) {
            const view = context.tabs[tabId];
            removeTabContentChildView(context, view);
            try { if (!view.webContents.isDestroyed()) view.webContents.destroy(); } catch (_) { }
        }
        context.tabs = {};
        context.activeTabId = null;

        if (context.tooltipView) {
            try { context.window.contentView.removeChildView(context.tooltipView); } catch (_) { }
            try { if (!context.tooltipView.webContents.isDestroyed()) context.tooltipView.webContents.destroy(); } catch (_) { }
            context.tooltipView = null;
        }
        if (context.chromeOverlayView) {
            try { context.window.contentView.removeChildView(context.chromeOverlayView); } catch (_) { }
            try {
                if (!context.chromeOverlayView.webContents.isDestroyed()) context.chromeOverlayView.webContents.destroy();
            } catch (_) { }
            context.chromeOverlayView = null;
        }
        if (context.chromeOmniboxOverlayView) {
            try { context.window.contentView.removeChildView(context.chromeOmniboxOverlayView); } catch (_) { }
            try {
                if (!context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
                    context.chromeOmniboxOverlayView.webContents.destroy();
                }
            } catch (_) { }
            context.chromeOmniboxOverlayView = null;
        }
        if (context.chromeShellMenuOverlayView) {
            try { context.window.contentView.removeChildView(context.chromeShellMenuOverlayView); } catch (_) { }
            try {
                if (!context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
                    context.chromeShellMenuOverlayView.webContents.destroy();
                }
            } catch (_) { }
            context.chromeShellMenuOverlayView = null;
        }
        if (context.lensSessions) {
            for (const sessionState of context.lensSessions.values()) {
                const sidebarView = sessionState?.sidebarView;
                if (!sidebarView) continue;
                removeTabContentChildView(context, sessionState.sidebarHostView || sidebarView);
                try {
                    if (sessionState.sidebarHostView) {
                        try { sessionState.sidebarHostView.removeChildView(sidebarView); } catch (_) { }
                    }
                    if (!sidebarView.webContents.isDestroyed()) sidebarView.webContents.destroy();
                } catch (_) { }
            }
            context.lensSessions.clear();
        }
        if (context.tabContentView) {
            try { context.window.contentView.removeChildView(context.tabContentView); } catch (_) { }
            context.tabContentView = null;
        }
        context.chromeOverlayAcquireCount = 0;
        context.chromeOmniboxOverlayAcquireCount = 0;
        context.chromeShellMenuOverlayAcquireCount = 0;
    });

    window.on('closed', () => {
        if (State.appLogger) {
            State.appLogger.info('window:closed', {
                windowId: context.windowId,
                profileId: context.profileId,
                browserWindowId: window.id,
            });
        }
        State.windowContextsById.delete(window.id);
        State.windowBootstrapById.delete(context.windowId);

        const profileStillOpen = Array.from(State.windowContextsById.values()).some(
            (ctx) => ctx?.profileId === context.profileId,
        );

        if (context.stealthWindow) {
            cleanupStealthCookiesForContext(context).catch((error) => {
                if (State.appLogger) {
                    State.appLogger.warn('cookies:stealth-cleanup-failed', {
                        profileId: context.profileId,
                        windowId: context.windowId,
                        error: State.appLogger.serializeError(error),
                    });
                }
            });
        }

        if (!profileStillOpen) {
            cleanupSessionOnlyCookiesForProfile(context.profileId).catch((error) => {
                if (State.appLogger) {
                    State.appLogger.warn('cookies:session-only-cleanup-failed', {
                        profileId: context.profileId,
                        error: State.appLogger.serializeError(error),
                    });
                }
            });
        }

        if (State.mainWindow === window) {
            State.mainWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) || null;
        }
    });

    createChromeOverlayLayer(context);
    createChromeShellMenuOverlayLayer(context);
    createChromeOmniboxOverlayLayer(context);
    createTooltipOverlay(context);
    ensureChromeOverlayOnTop(context);
    return context;
}

function createProfilePickerWindow() {
    if (State.profilePickerWindow && !State.profilePickerWindow.isDestroyed()) {
        State.profilePickerWindow.show();
        State.profilePickerWindow.focus();
        return;
    }
    const workArea = screen.getPrimaryDisplay().workArea;
    const picker = new BrowserWindow({
        x: workArea.x,
        y: workArea.y,
        width: workArea.width,
        height: workArea.height,
        minWidth: 360,
        minHeight: 400,
        title: 'Choose profile',
        titleBarStyle: 'default',
        fullscreen: false,
        webPreferences: buildSecureWebPreferences(),
    });

    applyProfilePickerSecurity(picker, loadSettings().contentProtection);
    applyIdentityToWebContents(picker.webContents);

    picker.loadURL('app://dist/profile-picker.html').catch((error) => {
        console.error('Failed to load profile picker:', error);
    });

    State.profilePickerWindow = picker;
    picker.on('closed', () => {
        State.profilePickerWindow = null;
        if (State.windowContextsById.size === 0 && process.platform !== C.PLATFORM.DARWIN) {
            const { app } = require('electron');
            app.quit();
        }
    });
}

module.exports = {
    getPrimaryWorkAreaBounds,
    createWindow,
    createProfilePickerWindow,
};