/**
 * Applies normalized keyboard events to input/textarea virtual targets.
 */

function isTextControl(el) {
    if (!el) return false;
    const tag = el.tagName?.toLowerCase?.();
    return tag === 'input' || tag === 'textarea';
}

function getSelection(el) {
    if (!isTextControl(el)) return { start: 0, end: 0 };
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    return { start, end };
}

function setSelection(el, start, end = start) {
    if (!isTextControl(el)) return;
    try {
        el.setSelectionRange(start, end);
    } catch (_) { /* ignore */ }
}

function dispatchInputEvent(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

function insertText(el, text) {
    if (!isTextControl(el) || !text) return;
    const { start, end } = getSelection(el);
    const value = el.value ?? '';
    el.value = value.slice(0, start) + text + value.slice(end);
    const caret = start + text.length;
    setSelection(el, caret, caret);
    dispatchInputEvent(el);
}

function deleteBackward(el) {
    if (!isTextControl(el)) return;
    const { start, end } = getSelection(el);
    const value = el.value ?? '';
    if (start !== end) {
        el.value = value.slice(0, start) + value.slice(end);
        setSelection(el, start, start);
    } else if (start > 0) {
        el.value = value.slice(0, start - 1) + value.slice(start);
        setSelection(el, start - 1, start - 1);
    }
    dispatchInputEvent(el);
}

function deleteForward(el) {
    if (!isTextControl(el)) return;
    const { start, end } = getSelection(el);
    const value = el.value ?? '';
    if (start !== end) {
        el.value = value.slice(0, start) + value.slice(end);
        setSelection(el, start, start);
    } else if (start < value.length) {
        el.value = value.slice(0, start) + value.slice(start + 1);
        setSelection(el, start, start);
    }
    dispatchInputEvent(el);
}

function moveCaret(el, delta, extend = false) {
    if (!isTextControl(el)) return;
    const { start, end } = getSelection(el);
    const len = (el.value ?? '').length;
    const next = Math.max(0, Math.min(len, start + delta));
    if (extend) setSelection(el, start, next);
    else setSelection(el, next, next);
}

function moveCaretVertical(el, direction) {
    if (!isTextControl(el) || el.tagName?.toLowerCase() !== 'textarea') {
        moveCaret(el, direction > 0 ? 1 : -1);
        return;
    }
    const value = el.value ?? '';
    const { start } = getSelection(el);
    const before = value.slice(0, start);
    const lineStart = before.lastIndexOf('\n') + 1;
    const col = start - lineStart;
    const lines = value.split('\n');
    let lineIndex = 0;
    let acc = 0;
    for (let i = 0; i < lines.length; i += 1) {
        if (acc + lines[i].length >= start - i) {
            lineIndex = i;
            break;
        }
        acc += lines[i].length + 1;
    }
    const targetLine = Math.max(0, Math.min(lines.length - 1, lineIndex + direction));
    let pos = 0;
    for (let i = 0; i < targetLine; i += 1) pos += lines[i].length + 1;
    pos += Math.min(col, lines[targetLine].length);
    setSelection(el, pos, pos);
}

function selectAll(el) {
    if (!isTextControl(el)) return;
    setSelection(el, 0, (el.value ?? '').length);
}

async function copySelection(el) {
    if (!isTextControl(el)) return;
    const { start, end } = getSelection(el);
    const text = (el.value ?? '').slice(start, end);
    if (!text) return;
    if (window.electronAPI?.clipboardWriteText) {
        await window.electronAPI.clipboardWriteText(text);
    } else if (window.electronAPI?.clipboardWrite) {
        await window.electronAPI.clipboardWrite(text);
    } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
    }
}

async function cutSelection(el) {
    if (!isTextControl(el)) return;
    const { start, end } = getSelection(el);
    const text = (el.value ?? '').slice(start, end);
    if (!text) return;
    if (window.electronAPI?.clipboardWriteText) {
        await window.electronAPI.clipboardWriteText(text);
    } else if (window.electronAPI?.clipboardWrite) {
        await window.electronAPI.clipboardWrite(text);
    } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
    }
    el.value = (el.value ?? '').slice(0, start) + (el.value ?? '').slice(end);
    setSelection(el, start, start);
    dispatchInputEvent(el);
}

async function pasteClipboard(el) {
    if (!isTextControl(el)) return;
    let text = '';
    if (window.electronAPI?.clipboardReadText) {
        text = await window.electronAPI.clipboardReadText();
    } else if (window.electronAPI?.clipboardRead) {
        text = await window.electronAPI.clipboardRead();
    } else if (navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
    }
    if (text) insertText(el, text);
}

const MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '');

function hasMod(event, name) {
    const m = event?.modifiers || {};
    if (name === 'meta') return !!(m.meta || m.ctrl && !MAC);
    if (name === 'ctrl') return !!m.ctrl;
    if (name === 'shift') return !!m.shift;
    if (name === 'alt') return !!m.alt;
    return false;
}

export function applyVirtualKeyboardEvent(el, event) {
    if (!el || !event || event.type !== 'keyDown') return false;

    const key = event.key || '';
    const meta = hasMod(event, 'meta');

    if (meta && (key === 'a' || key === 'A')) {
        selectAll(el);
        return true;
    }
    if (meta && (key === 'c' || key === 'C')) {
        void copySelection(el);
        return true;
    }
    if (meta && (key === 'x' || key === 'X')) {
        void cutSelection(el);
        return true;
    }
    if (meta && (key === 'v' || key === 'V')) {
        void pasteClipboard(el);
        return true;
    }

    if (key === 'Backspace') {
        deleteBackward(el);
        return true;
    }
    if (key === 'Delete') {
        deleteForward(el);
        return true;
    }
    if (key === 'ArrowLeft') {
        moveCaret(el, -1, hasMod(event, 'shift'));
        return true;
    }
    if (key === 'ArrowRight') {
        moveCaret(el, 1, hasMod(event, 'shift'));
        return true;
    }
    if (key === 'ArrowUp') {
        moveCaretVertical(el, -1);
        return true;
    }
    if (key === 'ArrowDown') {
        moveCaretVertical(el, 1);
        return true;
    }
    if (key === 'Home') {
        setSelection(el, 0, hasMod(event, 'shift') ? getSelection(el).end : 0);
        return true;
    }
    if (key === 'End') {
        const len = (el.value ?? '').length;
        setSelection(el, hasMod(event, 'shift') ? getSelection(el).start : len, len);
        return true;
    }
    if (key === 'Enter') {
        if (el.tagName?.toLowerCase() === 'textarea') {
            insertText(el, '\n');
            return true;
        }
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
    }
    if (key === 'Tab') {
        insertText(el, '\t');
        return true;
    }

    if (key && key.length === 1 && !meta && !hasMod(event, 'ctrl') && !hasMod(event, 'alt')) {
        insertText(el, key);
        return true;
    }

    return false;
}

export function ensureVirtualCaretVisible(el) {
    if (!el?.classList) return;
    el.classList.add('invisurf-virtual-focus');
}
