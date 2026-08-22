/**
 * Global keyboard monitor controller — wires native hook to KeyboardRouter.
 */
const { BrowserWindow } = require('electron');
const State = require('../state');
const C = require('../../src/constants/conditionStrings.cjs');
const { getNativeModule, isNonActivatingInteractionEnabled } = require('../ghostWindow/GhostWindowController');
const nonActivatingMode = require('./nonActivatingMode');
const keyboardRouter = require('./KeyboardRouter');
const tabInputBridge = require('./TabInputBridge');
const permissionManager = require('./PermissionManager');

let monitorStarted = false;
let modeEnabled = false;

function broadcastToShellWebContents(payload) {
    const target = nonActivatingMode.getVirtualTarget();
    const targetWcId = target?.webContentsId;

    for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;

        const sendIfMatch = (wc) => {
            if (!wc || wc.isDestroyed()) return;
            if (targetWcId != null && wc.id !== targetWcId) return;
            try {
                wc.send(C.IPC_EVENT.VIRTUAL_KEYBOARD_EVENT, payload);
            } catch (_) { /* tearing down */ }
        };

        sendIfMatch(win.webContents);

        const ctx = State.windowContextsById.get(win.id);
        if (!ctx) continue;

        for (const view of [
            ctx.chromeOverlayView,
            ctx.chromeOmniboxOverlayView,
            ctx.chromeShellMenuOverlayView,
        ]) {
            sendIfMatch(view?.webContents);
        }
    }
}

function broadcastDiagnostics() {
    const snapshot = {
        ghostEnabled: isNonActivatingInteractionEnabled(),
        monitorRunning: monitorStarted,
        permission: permissionManager.getPermissionStatus(),
        secureInputPaused: nonActivatingMode.isSecureInputPaused(),
        virtualTarget: nonActivatingMode.getVirtualTarget(),
        lastRouting: keyboardRouter.getLastRouting(),
        modeState: nonActivatingMode.getState(),
    };

    for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        try {
            win.webContents.send(C.IPC_EVENT.VIRTUAL_KEYBOARD_STATE, snapshot);
        } catch (_) { /* ignore */ }
    }
}

async function onNativeKeyboardEvent(event) {
    if (!modeEnabled || !nonActivatingMode.isEnabled()) return;

    const decision = keyboardRouter.classifyKeyboardEvent(event);

    if (decision.route === 'tab') {
        await tabInputBridge.routeTabKeyboardEvent(event);
    } else if (decision.route === 'shell' || decision.route === 'invisurf') {
        broadcastToShellWebContents(event);
    }

    broadcastDiagnostics();
}

function startMonitor() {
    const native = getNativeModule();
    if (!native || monitorStarted) return monitorStarted;

    const perm = permissionManager.getPermissionStatus();
    if (process.platform === 'darwin' && !perm.granted) {
        if (State.appLogger) {
            State.appLogger.warn('globalInput:permission-not-granted');
        }
        return false;
    }

    try {
        monitorStarted = !!native.startGlobalKeyboardMonitor(onNativeKeyboardEvent);
        if (monitorStarted && typeof native.onSecureInputChanged === 'function') {
            native.onSecureInputChanged((enabled) => {
                nonActivatingMode.setSecureInputPaused(!!enabled);
                if (enabled) {
                    native.setKeyboardInterceptEnabled?.(false);
                }
                broadcastDiagnostics();
            });
        }
    } catch (error) {
        monitorStarted = false;
        if (State.appLogger) {
            State.appLogger.warn('globalInput:monitor-start-failed', {
                error: State.appLogger.serializeError(error),
            });
        }
    }

    return monitorStarted;
}

function stopMonitor() {
    const native = getNativeModule();
    if (!native || !monitorStarted) return;

    try {
        native.setKeyboardInterceptEnabled?.(false);
        native.stopGlobalKeyboardMonitor?.();
    } catch (_) { /* ignore */ }

    monitorStarted = false;
}

function enableNonActivatingMode() {
    modeEnabled = true;
    nonActivatingMode.enable();
    startMonitor();
    broadcastDiagnostics();
}

function disableNonActivatingMode() {
    modeEnabled = false;
    nonActivatingMode.disable();
    stopMonitor();
    tabInputBridge.shutdownTabInputBridge();
    broadcastDiagnostics();
}

function setVirtualKeyboardFocus(payload) {
    if (!modeEnabled) return { ok: false, reason: 'disabled' };

    if (payload?.active) {
        nonActivatingMode.setVirtualFocus({
            kind: payload.kind || 'shell',
            webContentsId: payload.webContentsId,
            tabId: payload.tabId || null,
            targetId: payload.targetId || null,
        });

        const native = getNativeModule();
        if (native && nonActivatingMode.isVirtualFocusActive() && !nonActivatingMode.isSecureInputPaused()) {
            native.setKeyboardInterceptEnabled?.(true);
        }
    } else {
        const prev = nonActivatingMode.getVirtualTarget();
        if (prev?.kind === 'tab' && prev.tabId) {
            tabInputBridge.clearTabCdpForTab(prev.tabId);
        }
        nonActivatingMode.clearVirtualFocus();
        getNativeModule()?.setKeyboardInterceptEnabled?.(false);
    }

    broadcastDiagnostics();
    return { ok: true, monitoring: monitorStarted };
}

function shutdownGlobalInput() {
    disableNonActivatingMode();
}

module.exports = {
    startMonitor,
    stopMonitor,
    enableNonActivatingMode,
    disableNonActivatingMode,
    setVirtualKeyboardFocus,
    shutdownGlobalInput,
    isMonitorRunning: () => monitorStarted,
    broadcastDiagnostics,
};
