/**
 * Explicit state machine for non-activating interaction mode.
 *
 * States:
 * - disabled: feature off, normal Electron behavior
 * - enabledIdle: ghost window on, no virtual keyboard target
 * - enabledFocused: ghost window on, virtual keyboard target active
 */

const State = {
    DISABLED: 'disabled',
    ENABLED_IDLE: 'enabledIdle',
    ENABLED_FOCUSED: 'enabledFocused',
};

let currentState = State.DISABLED;
/** @type {{ kind: 'shell' | 'tab', webContentsId?: number, tabId?: string, targetId?: string } | null} */
let virtualTarget = null;
let secureInputPaused = false;

function getState() {
    return currentState;
}

function getVirtualTarget() {
    return virtualTarget;
}

function isEnabled() {
    return currentState !== State.DISABLED;
}

function isVirtualFocusActive() {
    return currentState === State.ENABLED_FOCUSED && virtualTarget != null;
}

function setSecureInputPaused(paused) {
    secureInputPaused = !!paused;
}

function isSecureInputPaused() {
    return secureInputPaused;
}

function enable() {
    if (virtualTarget) {
        currentState = State.ENABLED_FOCUSED;
    } else {
        currentState = State.ENABLED_IDLE;
    }
}

function disable() {
    currentState = State.DISABLED;
    virtualTarget = null;
    secureInputPaused = false;
}

function setVirtualFocus(target) {
    virtualTarget = target || null;
    if (currentState === State.DISABLED) return;
    currentState = virtualTarget ? State.ENABLED_FOCUSED : State.ENABLED_IDLE;
}

function clearVirtualFocus() {
    virtualTarget = null;
    if (currentState !== State.DISABLED) {
        currentState = State.ENABLED_IDLE;
    }
}

function getDiagnosticsSnapshot() {
    return {
        state: currentState,
        virtualTarget,
        secureInputPaused,
    };
}

module.exports = {
    State,
    getState,
    getVirtualTarget,
    isEnabled,
    isVirtualFocusActive,
    setSecureInputPaused,
    isSecureInputPaused,
    enable,
    disable,
    setVirtualFocus,
    clearVirtualFocus,
    getDiagnosticsSnapshot,
};
