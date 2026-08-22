/**
 * Normalizes native/global keyboard payloads and routes to TextInputController.
 */
import { getVirtualFocusedElement } from './VirtualFocusManager.js';
import { applyVirtualKeyboardEvent } from './TextInputController.js';

const KEY_CODE_MAP_DARWIN = {
    36: 'Enter',
    48: 'Tab',
    51: 'Backspace',
    117: 'Delete',
    123: 'ArrowLeft',
    124: 'ArrowRight',
    125: 'ArrowDown',
    126: 'ArrowUp',
    115: 'Home',
    119: 'End',
};

const KEY_CODE_MAP_WIN = {
    13: 'Enter',
    9: 'Tab',
    8: 'Backspace',
    46: 'Delete',
    37: 'ArrowLeft',
    39: 'ArrowRight',
    40: 'ArrowDown',
    38: 'ArrowUp',
    36: 'Home',
    35: 'End',
};

function resolveKeyName(event) {
    if (event.key) return event.key;
    const map = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '')
        ? KEY_CODE_MAP_DARWIN
        : KEY_CODE_MAP_WIN;
    return map[event.keyCode] || (event.keyChar || '');
}

export function handleVirtualKeyboardEvent(event) {
    const el = getVirtualFocusedElement();
    if (!el || !event) return false;

    const normalized = {
        ...event,
        type: event.type || 'keyDown',
        key: resolveKeyName(event),
    };

    return applyVirtualKeyboardEvent(el, normalized);
}

export function routeVirtualKeyboardEvent(event) {
    if (!event || event.type !== 'keyDown') return;
    handleVirtualKeyboardEvent(event);
}
