/**
 * Ghost window controller — native non-activating window setup for BrowserWindows.
 *
 * When nonActivatingInteraction is enabled, windows receive mouse events without
 * activating the Electron application or stealing OS keyboard focus.
 */
const { BrowserWindow, screen } = require('electron');
const State = require('../state');

const SUPPORTED = process.platform === 'darwin' || process.platform === 'win32';

let nativeModule = null;
let loadAttempted = false;
let loadError = null;

const hookedWindows = new WeakSet();

function getNativeModule() {
    if (loadAttempted) return nativeModule;
    loadAttempted = true;

    if (!SUPPORTED) return null;

    try {
        nativeModule = require('../../build/Release/invisurf_non_activating.node');
    } catch (primaryError) {
        try {
            nativeModule = require('../../build/Debug/invisurf_non_activating.node');
        } catch (fallbackError) {
            loadError = primaryError;
            if (State.appLogger) {
                State.appLogger.warn('ghostWindow:native-load-failed', {
                    error: State.appLogger.serializeError(primaryError),
                });
            } else {
                console.warn('[ghostWindow] Native module not loaded:', primaryError?.message || primaryError);
            }
        }
    }

    return nativeModule;
}

function isNonActivatingInteractionEnabled() {
    const { loadSettings } = require('../services/settingsService');
    return loadSettings().nonActivatingInteraction === true;
}

function getGhostBrowserWindowOptions() {
    if (!isNonActivatingInteractionEnabled()) return {};
    if (process.platform !== 'darwin') return {};
    return {
        type: 'panel',
        acceptFirstMouse: true,
    };
}

function setupGhostWindow(win) {
    if (!SUPPORTED || !win || win.isDestroyed()) return false;
    if (!isNonActivatingInteractionEnabled()) return false;

    const native = getNativeModule();
    if (!native || typeof native.setupNonActivatingWindow !== 'function') {
        return false;
    }

    try {
        const handle = win.getNativeWindowHandle();
        return !!native.setupNonActivatingWindow(handle);
    } catch (error) {
        if (State.appLogger) {
            State.appLogger.warn('ghostWindow:setup-failed', {
                browserWindowId: win.id,
                error: State.appLogger.serializeError(error),
            });
        }
        return false;
    }
}

function teardownGhostWindow(win) {
    if (!SUPPORTED || !win || win.isDestroyed()) return false;

    const native = getNativeModule();
    if (!native || typeof native.teardownNonActivatingWindow !== 'function') {
        return false;
    }

    try {
        const handle = win.getNativeWindowHandle();
        return !!native.teardownNonActivatingWindow(handle);
    } catch (error) {
        if (State.appLogger) {
            State.appLogger.warn('ghostWindow:teardown-failed', {
                browserWindowId: win.id,
                error: State.appLogger.serializeError(error),
            });
        }
        return false;
    }
}

function enableGhostWindow(win) {
    if (!win || win.isDestroyed()) return;
    syncGhostApplicationMode();
    setupGhostWindow(win);
}

function disableGhostWindow(win) {
    if (!win || win.isDestroyed()) return;
    teardownGhostWindow(win);
    if (!isNonActivatingInteractionEnabled()) {
        syncGhostApplicationMode();
    }
}

function syncGhostApplicationMode() {
    if (!SUPPORTED) return;

    const native = getNativeModule();
    if (!native || typeof native.setGhostApplicationModeEnabled !== 'function') {
        return;
    }

    try {
        native.setGhostApplicationModeEnabled(isNonActivatingInteractionEnabled());
    } catch (error) {
        if (State.appLogger) {
            State.appLogger.warn('ghostWindow:app-mode-sync-failed', {
                error: State.appLogger.serializeError(error),
            });
        }
    }
}

function applyGhostModeFromSettings() {
    syncGhostApplicationMode();
    const enabled = isNonActivatingInteractionEnabled();
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win || win.isDestroyed()) continue;
        if (enabled) {
            enableGhostWindow(win);
        } else {
            disableGhostWindow(win);
        }
    }
}

function showBrowserWindow(win) {
    if (!win || win.isDestroyed()) return;

    if (isNonActivatingInteractionEnabled()) {
        win.showInactive();
        setupGhostWindow(win);
        return;
    }

    win.show();
    try {
        win.focus();
    } catch (_) { /* ignore */ }
}

function reassertGhostWindow(win) {
    if (!win || win.isDestroyed()) return;
    if (!isNonActivatingInteractionEnabled()) return;
    setupGhostWindow(win);
}

function attachGhostWindowLifecycle(win) {
    if (!win || win.isDestroyed() || hookedWindows.has(win)) return;
    hookedWindows.add(win);

    const reapply = () => {
        reassertGhostWindow(win);
    };

    win.on('ready-to-show', reapply);
    win.on('show', reapply);
    win.on('focus', reapply);

    const onDisplayMetricsChanged = () => {
        if (!win.isDestroyed()) reapply();
    };
    screen.on('display-metrics-changed', onDisplayMetricsChanged);

    win.once('closed', () => {
        screen.removeListener('display-metrics-changed', onDisplayMetricsChanged);
    });
}

function isGhostWindowSupported() {
    return SUPPORTED && !!getNativeModule();
}

function getGhostWindowLoadError() {
    return loadError;
}

/** Skip OS-activating focus calls when ghost mode is active. */
function shouldSkipOsFocus() {
    return isNonActivatingInteractionEnabled();
}

module.exports = {
    getNativeModule,
    isNonActivatingInteractionEnabled,
    getGhostBrowserWindowOptions,
    setupGhostWindow,
    teardownGhostWindow,
    enableGhostWindow,
    disableGhostWindow,
    applyGhostModeFromSettings,
    syncGhostApplicationMode,
    showBrowserWindow,
    attachGhostWindowLifecycle,
    reassertGhostWindow,
    isGhostWindowSupported,
    getGhostWindowLoadError,
    shouldSkipOsFocus,
};
