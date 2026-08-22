import {
    clearVirtualFocus,
    getVirtualFocusedElement,
    getVirtualFocusId,
    hasVirtualKeyboardFocus,
    setVirtualFocus,
} from './VirtualFocusManager.js';
import { applyVirtualKeyboardEvent } from './TextInputController.js';

let installed = false;
let unsubscribeIpc = null;
let ghostModeActive = false;

async function refreshGhostModeFlag() {
    const api = window.electronAPI;
    if (!api?.settingsGet) return;
    try {
        const settings = await api.settingsGet();
        ghostModeActive = settings?.nonActivatingInteraction === true;
    } catch (_) {
        ghostModeActive = false;
    }
}

async function notifyMainVirtualFocus(active, target) {
    const api = window.electronAPI;
    if (!api?.setVirtualKeyboardFocus) return;
    try {
        await api.setVirtualKeyboardFocus({
            active,
            kind: 'shell',
            targetId: target ? getVirtualFocusId(target) : null,
        });
    } catch (_) { /* ignore */ }
}

function resolveVirtualTargetFromEvent(event) {
    let node = event.target;
    while (node && node !== document.body) {
        if (node.matches?.('input:not([type="hidden"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), [contenteditable="true"], [data-virtual-input="on"]')) {
            return node;
        }
        if (node.matches?.('[data-virtual-input="off"]')) return null;
        node = node.parentElement;
    }
    return null;
}

function onDocumentMouseDown(event) {
    if (!ghostModeActive) return;

    const target = resolveVirtualTargetFromEvent(event);
    if (!target) {
        if (hasVirtualKeyboardFocus()) {
            clearVirtualFocus();
            void notifyMainVirtualFocus(false);
        }
        return;
    }

    try {
        target.focus({ preventScroll: true });
    } catch (_) { /* adapter-only */ }

    setVirtualFocus(target);
    void notifyMainVirtualFocus(true, target);
}

function onVirtualKeyboardEvent(event) {
    const el = getVirtualFocusedElement();
    if (!el) return;
    applyVirtualKeyboardEvent(el, event);
}

export function isGhostInputMode() {
    return ghostModeActive;
}

/** Focus an editable without OS activation when ghost mode is active. */
export function focusEditableVirtually(element, { selectAll = false } = {}) {
    if (!element) return;
    setVirtualFocus(element);
    void notifyMainVirtualFocus(true, element);
    if (selectAll && typeof element.select === 'function') {
        try {
            element.select();
        } catch (_) { /* ignore */ }
    }
}

export function installVirtualInput() {
    if (installed) return;
    installed = true;

    void refreshGhostModeFlag();
    const api = window.electronAPI;
    if (api?.settingsUpdated) {
        api.settingsUpdated((payload) => {
            ghostModeActive = payload?.settings?.nonActivatingInteraction === true;
        });
    }

    document.addEventListener('mousedown', onDocumentMouseDown, true);

    if (api?.onVirtualKeyboardEvent) {
        unsubscribeIpc = api.onVirtualKeyboardEvent(onVirtualKeyboardEvent);
    }
}

export function uninstallVirtualInput() {
    if (!installed) return;
    installed = false;
    document.removeEventListener('mousedown', onDocumentMouseDown, true);
    if (typeof unsubscribeIpc === 'function') unsubscribeIpc();
    unsubscribeIpc = null;
    clearVirtualFocus();
    void notifyMainVirtualFocus(false);
}

export { getVirtualFocusedElement, hasVirtualKeyboardFocus, setVirtualFocus, clearVirtualFocus };
