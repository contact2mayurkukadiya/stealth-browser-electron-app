/**
 * Central keyboard routing policy for shadow input.
 *
 * Classification order:
 * 1. System-critical shortcut → OS
 * 2. InviSurf shortcut → shell IPC
 * 3. Virtual text/editing → InviSurf target
 * 4. Otherwise → OS
 */
const C = require('../../src/constants/conditionStrings.cjs');
const nonActivatingMode = require('./nonActivatingMode');
const { focusedShellWebContents, getWindowContextForShellFallback } = require('../windows/windowContextUtils');

const KEY_CODE_MAP = {
    darwin: {
        36: 'Enter', 48: 'Tab', 51: 'Backspace', 117: 'Delete',
        123: 'ArrowLeft', 124: 'ArrowRight', 125: 'ArrowDown', 126: 'ArrowUp',
        115: 'Home', 119: 'End', 49: 'Space',
    },
    win32: {
        13: 'Enter', 9: 'Tab', 8: 'Backspace', 46: 'Delete',
        37: 'ArrowLeft', 39: 'ArrowRight', 40: 'ArrowDown', 38: 'ArrowUp',
        36: 'Home', 35: 'End', 32: 'Space',
    },
};

let lastRouting = { keyId: null, target: 'os', consumed: false };

function resolveKeyId(event) {
    if (event.key) return event.key.length === 1 ? `Key${event.key.toUpperCase()}` : event.key;
    const map = process.platform === 'darwin' ? KEY_CODE_MAP.darwin : KEY_CODE_MAP.win32;
    const name = map[event.keyCode];
    if (name) return name;
    return `KeyCode${event.keyCode}`;
}

function isSystemCriticalShortcut(event) {
    if (event.type !== 'keyDown') return false;
    const mods = event.modifiers || {};
    const keyCode = event.keyCode;
    const map = process.platform === 'darwin' ? KEY_CODE_MAP.darwin : KEY_CODE_MAP.win32;
    const keyName = event.key || map[keyCode] || '';

    if (mods.meta || mods.ctrl) {
        if (keyName === 'Tab' || keyCode === 48 || keyCode === 9) return true;
        if (keyName === 'Space' || keyCode === 49 || keyCode === 32) return true;
    }
    if (mods.alt) {
        if (keyName === 'Tab' || keyCode === 48 || keyCode === 9) return true;
    }
    if (process.platform === 'win32' && mods.meta) {
        if (keyName === 'l' || keyName === 'L' || keyCode === 76) return true;
    }
    return false;
}

function isInviSurfShortcut(event) {
    if (event.type !== 'keyDown') return false;
    const mods = event.modifiers || {};
    const key = (event.key || '').toLowerCase();
    if ((mods.meta || mods.ctrl) && key === 'k') return true;
    return false;
}

function isTextEditingKey(event) {
    if (event.type !== 'keyDown') return false;
    const key = event.key || '';
    const map = process.platform === 'darwin' ? KEY_CODE_MAP.darwin : KEY_CODE_MAP.win32;
    const keyName = key || map[event.keyCode] || '';

    if (keyName === 'Backspace' || keyName === 'Delete') return true;
    if (keyName.startsWith('Arrow') || keyName === 'Home' || keyName === 'End') return true;
    if (keyName === 'Enter' || keyName === 'Tab') return true;
    if (key && key.length === 1) return true;
    return false;
}

function isClipboardShortcut(event) {
    if (event.type !== 'keyDown') return false;
    const mods = event.modifiers || {};
    if (!mods.meta && !mods.ctrl) return false;
    const key = (event.key || '').toLowerCase();
    return key === 'a' || key === 'c' || key === 'x' || key === 'v';
}

function dispatchInviSurfShortcut(event) {
    const key = (event.key || '').toLowerCase();
    const wc = focusedShellWebContents();
    if (!wc || wc.isDestroyed()) return;
    if (key === 'k') {
        wc.send(C.IPC_EVENT.SHORTCUT_TAB_SEARCH);
    }
}

/**
 * @returns {{ route: 'os' | 'invisurf' | 'shell' | 'tab', consume: boolean, keyId: string }}
 */
function classifyKeyboardEvent(event) {
    const keyId = resolveKeyId(event);

    if (nonActivatingMode.isSecureInputPaused()) {
        lastRouting = { keyId, target: 'os', consumed: false };
        return { route: 'os', consume: false, keyId };
    }

    if (!nonActivatingMode.isVirtualFocusActive()) {
        lastRouting = { keyId, target: 'os', consumed: false };
        return { route: 'os', consume: false, keyId };
    }

    if (isSystemCriticalShortcut(event)) {
        lastRouting = { keyId, target: 'os', consumed: false };
        return { route: 'os', consume: false, keyId };
    }

    if (isInviSurfShortcut(event)) {
        dispatchInviSurfShortcut(event);
        lastRouting = { keyId, target: 'invisurf', consumed: true };
        return { route: 'invisurf', consume: true, keyId };
    }

    const target = nonActivatingMode.getVirtualTarget();
    if (target?.kind === 'tab') {
        if (isTextEditingKey(event) || isClipboardShortcut(event)) {
            lastRouting = { keyId, target: 'tab', consumed: true };
            return { route: 'tab', consume: true, keyId };
        }
    }

    if (target?.kind === 'shell' || !target?.kind) {
        if (isTextEditingKey(event) || isClipboardShortcut(event)) {
            lastRouting = { keyId, target: 'shell', consumed: true };
            return { route: 'shell', consume: true, keyId };
        }
    }

    lastRouting = { keyId, target: 'os', consumed: false };
    return { route: 'os', consume: false, keyId };
}

function getLastRouting() {
    return { ...lastRouting };
}

module.exports = {
    classifyKeyboardEvent,
    resolveKeyId,
    getLastRouting,
};
