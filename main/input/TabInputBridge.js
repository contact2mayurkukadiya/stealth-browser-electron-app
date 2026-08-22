/**
 * Tab web content keyboard bridge — execCommand for text, CDP for control keys.
 */
const nonActivatingMode = require('./nonActivatingMode');
const State = require('../state');

/** @type {Map<number, { attached: boolean }>} */
const cdpSessions = new Map();

const CONTROL_KEYS = new Set([
    'Tab', 'Enter', 'Backspace', 'Delete',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Home', 'End', 'Escape',
]);

const KEY_CODE_WIN = {
    Enter: 13, Tab: 9, Backspace: 8, Delete: 46,
    ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40,
    Home: 36, End: 35, Escape: 27,
};

const KEY_CODE_DARWIN = {
    Enter: 36, Tab: 48, Backspace: 51, Delete: 117,
    ArrowLeft: 123, ArrowRight: 124, ArrowUp: 126, ArrowDown: 125,
    Home: 115, End: 119, Escape: 53,
};

function findTabWebContents(tabId) {
    for (const ctx of State.windowContextsById.values()) {
        const view = ctx.tabs?.[tabId];
        if (view?.webContents && !view.webContents.isDestroyed()) {
            return view.webContents;
        }
    }
    return null;
}

function getNativeKeyCode(keyName) {
    const map = process.platform === 'darwin' ? KEY_CODE_DARWIN : KEY_CODE_WIN;
    return map[keyName] || 0;
}

async function ensureCdpAttached(webContents) {
    if (!webContents || webContents.isDestroyed()) return false;
    const id = webContents.id;
    if (cdpSessions.get(id)?.attached) return true;
    if (webContents.isDevToolsOpened()) return false;

    try {
        if (!webContents.debugger.isAttached()) {
            webContents.debugger.attach('1.3');
        }
        cdpSessions.set(id, { attached: true });
        return true;
    } catch (_) {
        return false;
    }
}

function detachCdp(webContents) {
    if (!webContents || webContents.isDestroyed()) return;
    const id = webContents.id;
    try {
        if (webContents.debugger.isAttached()) {
            webContents.debugger.detach();
        }
    } catch (_) { /* ignore */ }
    cdpSessions.delete(id);
}

async function dispatchCdpKeyEvent(webContents, event) {
    if (!await ensureCdpAttached(webContents)) return false;

    const keyName = event.key || '';
    const keyCode = event.keyCode || getNativeKeyCode(keyName);
    const mods = event.modifiers || {};

    const params = {
        type: event.type === 'keyUp' ? 'keyUp' : 'keyDown',
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        modifiers: (mods.shift ? 8 : 0) | (mods.ctrl ? 2 : 0) | (mods.alt ? 1 : 0) | (mods.meta ? 4 : 0),
    };

    if (keyName.length === 1) {
        params.text = keyName;
    }

    try {
        await webContents.debugger.sendCommand('Input.dispatchKeyEvent', params);
        return true;
    } catch (_) {
        return false;
    }
}

async function dispatchExecCommandText(webContents, text) {
    if (!webContents || webContents.isDestroyed() || !text) return false;
    const escaped = JSON.stringify(text);
    const script = `(function() {
        const el = document.activeElement;
        if (!el) return false;
        if (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            return document.execCommand('insertText', false, ${escaped});
        }
        return false;
    })()`;
    try {
        return !!await webContents.executeJavaScript(script, true);
    } catch (_) {
        return false;
    }
}

async function dispatchExecCommandShortcut(webContents, command) {
    if (!webContents || webContents.isDestroyed()) return false;
    const script = `(function() {
        const el = document.activeElement;
        if (!el) return false;
        return document.execCommand(${JSON.stringify(command)}, false, null);
    })()`;
    try {
        return !!await webContents.executeJavaScript(script, true);
    } catch (_) {
        return false;
    }
}

async function routeTabKeyboardEvent(event) {
    const target = nonActivatingMode.getVirtualTarget();
    if (!target || target.kind !== 'tab' || !target.tabId) return false;

    const webContents = findTabWebContents(target.tabId);
    if (!webContents) return false;

    const keyName = event.key || '';
    const mods = event.modifiers || {};

    if ((mods.meta || mods.ctrl) && keyName.toLowerCase() === 'a') {
        return dispatchExecCommandShortcut(webContents, 'selectAll');
    }
    if ((mods.meta || mods.ctrl) && keyName.toLowerCase() === 'c') {
        return dispatchExecCommandShortcut(webContents, 'copy');
    }
    if ((mods.meta || mods.ctrl) && keyName.toLowerCase() === 'x') {
        return dispatchExecCommandShortcut(webContents, 'cut');
    }
    if ((mods.meta || mods.ctrl) && keyName.toLowerCase() === 'v') {
        return dispatchExecCommandShortcut(webContents, 'paste');
    }

    if (keyName.length === 1 && !mods.meta && !mods.ctrl && !mods.alt) {
        return dispatchExecCommandText(webContents, keyName);
    }

    if (CONTROL_KEYS.has(keyName)) {
        return dispatchCdpKeyEvent(webContents, event);
    }

    return false;
}

function clearTabCdpForTab(tabId) {
    for (const ctx of State.windowContextsById.values()) {
        const view = ctx.tabs?.[tabId];
        if (view?.webContents) {
            detachCdp(view.webContents);
        }
    }
}

function shutdownTabInputBridge() {
    for (const wcId of [...cdpSessions.keys()]) {
        for (const ctx of State.windowContextsById.values()) {
            for (const view of Object.values(ctx.tabs || {})) {
                if (view?.webContents?.id === wcId) {
                    detachCdp(view.webContents);
                }
            }
        }
    }
    cdpSessions.clear();
}

module.exports = {
    routeTabKeyboardEvent,
    clearTabCdpForTab,
    shutdownTabInputBridge,
    detachCdp,
};
