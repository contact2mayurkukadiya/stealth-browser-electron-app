/**
 * Tracks which element holds virtual keyboard focus (independent of OS focus).
 */

let virtualFocusedElement = null;
let virtualFocusIdCounter = 0;
const idByElement = new WeakMap();

const VIRTUAL_FOCUS_CLASS = 'invisurf-virtual-focus';

export function isVirtualInputElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest?.('[data-virtual-input="off"]')) return false;
    if (el.matches?.('input:not([type="hidden"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), [contenteditable="true"]')) {
        return true;
    }
    return !!el.closest?.('[data-virtual-input="on"]');
}

export function getVirtualFocusedElement() {
    return virtualFocusedElement;
}

export function getVirtualFocusId(element) {
    if (!element) return null;
    if (!idByElement.has(element)) {
        virtualFocusIdCounter += 1;
        idByElement.set(element, `vf-${virtualFocusIdCounter}`);
    }
    return idByElement.get(element);
}

export function setVirtualFocus(element) {
    if (virtualFocusedElement === element) return element;

    if (virtualFocusedElement) {
        virtualFocusedElement.classList?.remove(VIRTUAL_FOCUS_CLASS);
    }

    virtualFocusedElement = element || null;

    if (virtualFocusedElement) {
        virtualFocusedElement.classList?.add(VIRTUAL_FOCUS_CLASS);
    }

    return virtualFocusedElement;
}

export function clearVirtualFocus() {
    setVirtualFocus(null);
}

export function hasVirtualKeyboardFocus() {
    return virtualFocusedElement != null;
}

export function getVirtualFocusState() {
    return {
        osActive: false,
        mouseInside: true,
        virtualKeyboardFocus: hasVirtualKeyboardFocus(),
        targetId: virtualFocusedElement ? getVirtualFocusId(virtualFocusedElement) : null,
        tagName: virtualFocusedElement?.tagName?.toLowerCase?.() || null,
    };
}
