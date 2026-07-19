import { DOM, hideAll, onHideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { AssetMaskIcon, OB_ICON_SVG } from '../utils/dom.js';

let omniboxOverlayInput = null;
let omniboxOverlayScroll = null;
let omniboxOverlayState = { query: '', selectedIndex: -1, items: [] };
let omniboxEscapeCapture = null;
let omniboxDismissPending = false;
let omniboxPanelGuardsBound = false;
let omniboxFocusGen = 0;

onHideAll(() => {
    omniboxFocusGen += 1;
    disableOmniboxEscapeDismiss();
    omniboxDismissPending = false;
    omniboxPanelGuardsBound = false;
    omniboxOverlayInput = null;
    omniboxOverlayScroll = null;
});

function appendHighlightedOmnibox(parent, text, query) {
    text = String(text || '');
    query = String(query || '');
    if (!query) { parent.appendChild(document.createTextNode(text)); return; }
    var lowerText = text.toLowerCase();
    var lowerQuery = query.toLowerCase();
    var lastIndex = 0;
    var searchFrom = 0;
    while (searchFrom < lowerText.length) {
        var matchIdx = lowerText.indexOf(lowerQuery, searchFrom);
        if (matchIdx === -1) break;
        if (matchIdx > lastIndex) {
            parent.appendChild(document.createTextNode(text.slice(lastIndex, matchIdx)));
        }
        var strong = document.createElement('strong');
        strong.textContent = text.slice(matchIdx, matchIdx + lowerQuery.length);
        parent.appendChild(strong);
        lastIndex = matchIdx + lowerQuery.length;
        searchFrom = lastIndex;
    }
    if (lastIndex < text.length) { parent.appendChild(document.createTextNode(text.slice(lastIndex))); }
}

function isOmniboxPanelVisible() {
    return DOM.panel.classList.contains('co-panel--omnibox') && DOM.panel.classList.contains('co-visible');
}

function dismissOmniboxOnEscape(e) {
    if (e.key !== 'Escape') return;
    if (!isOmniboxPanelVisible()) return;
    e.preventDefault(); e.stopPropagation();
    if (omniboxDismissPending) return;
    omniboxDismissPending = true;
    notifyHost({ type: 'dismiss', reason: 'escape' });
    setTimeout(function () { omniboxDismissPending = false; }, 0);
}

function enableOmniboxEscapeDismiss() {
    if (!omniboxEscapeCapture) {
        omniboxEscapeCapture = function (e) { dismissOmniboxOnEscape(e); };
        document.addEventListener('keydown', omniboxEscapeCapture, true);
    }
}

function disableOmniboxEscapeDismiss() {
    if (omniboxEscapeCapture) {
        document.removeEventListener('keydown', omniboxEscapeCapture, true);
        omniboxEscapeCapture = null;
    }
}

function dismissOmniboxOnBlur() {
    if (!isOmniboxPanelVisible()) return;
    if (omniboxDismissPending) return;
    var active = document.activeElement;
    if (active && DOM.panel.contains(active)) return;
    omniboxDismissPending = true;
    notifyHost({ type: 'dismiss', reason: 'blur' });
    setTimeout(function () { omniboxDismissPending = false; }, 0);
}

function bindOmniboxInputBlurDismiss(input) {
    if (!input || input.dataset.coBlurBound === '1') return;
    input.dataset.coBlurBound = '1';
    input.addEventListener('focusout', function () { setTimeout(dismissOmniboxOnBlur, 0); });
}

function bindOmniboxPanelGuards() {
    if (omniboxPanelGuardsBound) return;
    omniboxPanelGuardsBound = true;
    DOM.panel.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    DOM.panel.addEventListener('mousedown', function (e) { e.stopPropagation(); });
}

function focusOmniboxInput(input, selStart, selEnd, selectAll) {
    if (!input) return;
    var gen = ++omniboxFocusGen;
    var attemptsLeft = 8;
    function applyFocus() {
        try {
            if (typeof window.focus === 'function') window.focus();
            input.focus({ preventScroll: true });
            if (Number.isFinite(selStart) && Number.isFinite(selEnd)) { input.setSelectionRange(selStart, selEnd); }
            else if (selectAll) { input.select(); }
        } catch (_) {
            try { input.focus({ preventScroll: true }); } catch (_) { }
        }
    }
    function scheduleFocusAttempt() {
        if (gen !== omniboxFocusGen) return;
        if (!isOmniboxPanelVisible() || !DOM.panel.contains(input)) return;
        requestAnimationFrame(function () {
            if (gen !== omniboxFocusGen) return;
            if (!isOmniboxPanelVisible() || !DOM.panel.contains(input)) return;
            applyFocus();
            if (document.activeElement === input) return;
            attemptsLeft -= 1;
            if (attemptsLeft > 0) scheduleFocusAttempt();
        });
    }
    scheduleFocusAttempt();
}

function renderOmniboxSuggestionRows(scroll, items, query, sel) {
    scroll.innerHTML = '';
    if (!items.length) {
        if (!String(query || '').trim()) return;
        var empty = document.createElement('div');
        empty.className = 'co-ob-empty';
        empty.textContent = 'No Suggestions';
        scroll.appendChild(empty);
        return;
    }
    for (var i = 0; i < items.length; i++) {
        (function (index) {
            var it = items[index];
            if (!it || typeof it !== 'object') return;
            var typRaw0 = String(it.type || 'url').toLowerCase().replace(/[^a-z]/g, '') || 'url';
            var typ = ['history', 'search', 'bookmark', 'keyword', 'url'].indexOf(typRaw0) >= 0 ? typRaw0 : 'url';
            var row = document.createElement('button');
            row.type = 'button';
            row.className = 'co-ob-row' + (index === sel ? ' co-ob-row--selected' : '');
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', index === sel ? 'true' : 'false');
            var iconWrap = document.createElement('div');
            iconWrap.className = 'co-ob-row__icon';
            var fav = it.favicon && typeof it.favicon === 'string' ? it.favicon.trim() : '';
            if (fav && fav.indexOf('javascript:') !== 0 && fav.indexOf('data:') !== 0) {
                var img = document.createElement('img');
                img.className = 'co-ob-row__favicon';
                img.alt = '';
                img.src = fav;
                img.onerror = function () {
                    img.style.display = 'none';
                    iconWrap.appendChild(AssetMaskIcon(OB_ICON_SVG[typ] || OB_ICON_SVG.url, 14));
                };
                iconWrap.appendChild(img);
            } else {
                iconWrap.appendChild(AssetMaskIcon(OB_ICON_SVG[typ] || OB_ICON_SVG.url, 14));
            }
            row.appendChild(iconWrap);
            var content = document.createElement('div');
            content.className = 'co-ob-row__content';
            var textEl = document.createElement('span');
            textEl.className = 'co-ob-row__text';
            appendHighlightedOmnibox(textEl, String(it.text || ''), query);
            content.appendChild(textEl);
            var urlStr = String(it.url || '');
            var desc = it.description && String(it.description);
            if (desc && desc !== urlStr) {
                var descEl = document.createElement('span');
                descEl.className = 'co-ob-row__description';
                descEl.textContent = desc.slice(0, 240);
                content.appendChild(descEl);
            }
            row.appendChild(content);
            var badge = document.createElement('span');
            badge.className = 'co-ob-badge co-ob-badge--' + typ;
            badge.textContent = typ;
            row.appendChild(badge);
            row.addEventListener('mousedown', function (e) { e.preventDefault(); });
            row.addEventListener('click', function () { notifyHost({ type: 'omniboxSuggestPick', index: index }); });
            scroll.appendChild(row);
        })(i);
    }
}

function updateOmniboxGhost(inputWrap, query, ghostSuffix) {
    var existing = inputWrap.querySelector('.co-ob-ghost');
    if (existing) existing.remove();
    if (!ghostSuffix) return;
    var ghost = document.createElement('div');
    ghost.className = 'co-ob-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    var ghostTyped = document.createElement('span');
    ghostTyped.style.color = 'transparent';
    ghostTyped.textContent = query;
    ghost.appendChild(ghostTyped);
    var ghostRest = document.createElement('span');
    ghostRest.className = 'co-ob-ghost__suffix';
    ghostRest.textContent = ghostSuffix;
    ghost.appendChild(ghostRest);
    var inputEl = inputWrap.querySelector('.co-ob-input');
    if (inputEl) inputWrap.insertBefore(ghost, inputEl);
    else inputWrap.appendChild(ghost);
}

function getOmniboxPanelGeometry(payload) {
    var dr = payload.dropdownRect || {};
    var w = Math.round(Number(dr.width) || 320);
    var h = Math.round(Number(dr.height) || 34);
    var left = Math.round(Number(dr.left) || 0);
    var top = Math.round(Number(dr.top) || 0);
    var pad = 8;
    w = Math.max(200, Math.min(w, window.innerWidth - 2 * pad));
    var overlayBounds = payload.overlayBounds || null;
    if (overlayBounds && Number.isFinite(Number(overlayBounds.x)) && Number.isFinite(Number(overlayBounds.y))) {
        left = Math.round(left - Number(overlayBounds.x));
        top = Math.round(top - Number(overlayBounds.y));
        left = Math.max(0, Math.min(left, Math.max(0, window.innerWidth - w)));
        top = Math.max(0, Math.min(top, Math.max(0, window.innerHeight - h)));
    } else {
        left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
        top = Math.max(pad, Math.min(top, window.innerHeight - 120 - pad));
    }
    return { left: left, top: top, width: w, inputHeight: h, maxPanelHeight: Math.max(h, window.innerHeight - top) };
}

function positionOmniboxPanel(payload) {
    var geom = getOmniboxPanelGeometry(payload);
    DOM.panel.style.left = geom.left + 'px';
    DOM.panel.style.top = geom.top + 'px';
    DOM.panel.style.width = geom.width + 'px';
    DOM.panel.style.minWidth = geom.width + 'px';
    DOM.panel.style.maxHeight = geom.maxPanelHeight + 'px';
    if (omniboxOverlayScroll) {
        omniboxOverlayScroll.style.maxHeight = Math.max(36, geom.maxPanelHeight - geom.inputHeight) + 'px';
    }
    return geom;
}

export function updateOmniboxSuggestionsInPlace(payload) {
    var geom = positionOmniboxPanel(payload);
    var query = String(payload.query || '');
    var ghostSuffix = String(payload.ghostSuffix || '');
    var isSecure = !!payload.isSecure;
    var selectedIndex = Math.round(Number(payload.selectedIndex));
    if (!Number.isFinite(selectedIndex)) selectedIndex = -1;
    var rawItems = Array.isArray(payload.items) ? payload.items : [];
    var items = rawItems.slice(0, 24);
    omniboxOverlayState.query = query;
    omniboxOverlayState.selectedIndex = selectedIndex;
    omniboxOverlayState.items = items;

    var inputWrap = DOM.panel.querySelector('.co-ob-input-wrap');
    var input = omniboxOverlayInput;
    if (inputWrap) inputWrap.style.height = geom.inputHeight + 'px';

    var iconEl = inputWrap && inputWrap.querySelector('.co-ob-input-icon');
    if (iconEl) {
        iconEl.innerHTML = '';
        iconEl.appendChild(isSecure ? AssetMaskIcon('assets/images/lock.svg', 16) : AssetMaskIcon('assets/images/unlock.svg', 16));
    }
    if (inputWrap) updateOmniboxGhost(inputWrap, query, ghostSuffix);

    var selStart = Number(payload.selectionStart);
    var selEnd = Number(payload.selectionEnd);
    var preserveSelection = input && document.activeElement === input && input.value === query;
    var preservedStart = preserveSelection ? input.selectionStart : null;
    var preservedEnd = preserveSelection ? input.selectionEnd : null;

    if (input) {
        if (!preserveSelection) {
            input.value = query;
            if (Number.isFinite(selStart) && Number.isFinite(selEnd)) {
                try { input.setSelectionRange(selStart, selEnd); } catch (_) { }
            }
        }
        bindOmniboxInputBlurDismiss(input);
    }

    if (omniboxOverlayScroll) {
        renderOmniboxSuggestionRows(omniboxOverlayScroll, items, query, selectedIndex);
    }

    DOM.panel.classList.add('co-visible', 'co-panel--omnibox');
    enableOmniboxEscapeDismiss();
    if (input) bindOmniboxInputBlurDismiss(input);

    if (payload.focusInput !== false) {
        var focusStart = preserveSelection && preservedStart != null ? preservedStart : selStart;
        var focusEnd = preserveSelection && preservedEnd != null ? preservedEnd : selEnd;
        if (!preserveSelection && !(Number.isFinite(focusStart) && Number.isFinite(focusEnd))) {
            focusStart = query.length; focusEnd = query.length;
        }
        focusOmniboxInput(input, focusStart, focusEnd, false);
    }
}

export function canUpdateOmniboxInPlace() {
    return DOM.panel.classList.contains('co-panel--omnibox') && DOM.panel.classList.contains('co-visible')
        && omniboxOverlayInput && DOM.panel.contains(omniboxOverlayInput)
        && omniboxOverlayScroll && DOM.panel.contains(omniboxOverlayScroll);
}

export function renderOmniboxSuggestions(payload) {
    if (canUpdateOmniboxInPlace()) { updateOmniboxSuggestionsInPlace(payload); return; }

    // Synchronously clean up existing layers/menus before creating the new one
    hideAll({ hideLens: true });

    omniboxDismissPending = false;
    omniboxPanelGuardsBound = false;
    DOM.panel.classList.add('co-panel--omnibox');
    var geom = positionOmniboxPanel(payload);

    var query = String(payload.query || '');
    var ghostSuffix = String(payload.ghostSuffix || '');
    var isSecure = !!payload.isSecure;
    var selectedIndex = Math.round(Number(payload.selectedIndex));
    if (!Number.isFinite(selectedIndex)) selectedIndex = -1;
    omniboxOverlayState.query = query;
    omniboxOverlayState.selectedIndex = selectedIndex;

    var inputWrap = document.createElement('div');
    inputWrap.className = 'co-ob-input-wrap';
    inputWrap.style.height = geom.inputHeight + 'px';
    var icon = document.createElement('div');
    icon.className = 'co-ob-input-icon';
    icon.appendChild(isSecure ? AssetMaskIcon('assets/images/lock.svg', 16) : AssetMaskIcon('assets/images/unlock.svg', 16));
    inputWrap.appendChild(icon);

    if (ghostSuffix) {
        var ghost = document.createElement('div');
        ghost.className = 'co-ob-ghost';
        ghost.setAttribute('aria-hidden', 'true');
        var ghostTyped = document.createElement('span');
        ghostTyped.style.color = 'transparent';
        ghostTyped.textContent = query;
        ghost.appendChild(ghostTyped);
        var ghostRest = document.createElement('span');
        ghostRest.className = 'co-ob-ghost__suffix';
        ghostRest.textContent = ghostSuffix;
        ghost.appendChild(ghostRest);
        inputWrap.appendChild(ghost);
    }

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'co-ob-input';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('aria-autocomplete', 'list');
    input.placeholder = 'Search or enter address';

    var previousInput = omniboxOverlayInput;
    var preserveSelection = previousInput && document.activeElement === previousInput && previousInput.value === query;
    var preservedStart = preserveSelection ? previousInput.selectionStart : null;
    var preservedEnd = preserveSelection ? previousInput.selectionEnd : null;
    input.value = query;
    omniboxOverlayInput = input;

    var selStart = Number(payload.selectionStart);
    var selEnd = Number(payload.selectionEnd);
    if (preserveSelection && preservedStart != null && preservedEnd != null) {
        try { input.setSelectionRange(preservedStart, preservedEnd); } catch (_) { }
    } else if (Number.isFinite(selStart) && Number.isFinite(selEnd)) {
        try { input.setSelectionRange(selStart, selEnd); } catch (_) { }
    }

    function notifyInputChange() {
        notifyHost({ type: 'omniboxInputChange', value: input.value, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd });
    }
    input.addEventListener('input', notifyInputChange);

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); notifyHost({ type: 'dismiss', reason: 'escape' }); return; }
        if (e.key === 'Enter') { e.preventDefault(); notifyHost({ type: 'omniboxInputCommit', value: input.value, selectedIndex: omniboxOverlayState.selectedIndex }); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') {
            e.preventDefault();
            notifyHost({ type: 'omniboxKeyDown', key: e.key, value: input.value, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd, selectedIndex: omniboxOverlayState.selectedIndex });
        }
    });

    inputWrap.appendChild(input);
    DOM.panel.appendChild(inputWrap);

    var scroll = document.createElement('div');
    scroll.className = 'co-ob-scroll';
    scroll.style.maxHeight = Math.max(36, geom.maxPanelHeight - geom.inputHeight) + 'px';
    omniboxOverlayScroll = scroll;
    var rawItems = Array.isArray(payload.items) ? payload.items : [];
    var items = rawItems.slice(0, 24);
    omniboxOverlayState.items = items;

    renderOmniboxSuggestionRows(scroll, items, query, selectedIndex);
    DOM.panel.appendChild(scroll);

    bindOmniboxPanelGuards();
    DOM.panel.classList.add('co-visible');
    enableOmniboxEscapeDismiss();
    bindOmniboxInputBlurDismiss(input);

    if (payload.focusInput !== false) {
        var focusStart = preserveSelection && preservedStart != null ? preservedStart : selStart;
        var focusEnd = preserveSelection && preservedEnd != null ? preservedEnd : selEnd;
        if (!preserveSelection && !(Number.isFinite(focusStart) && Number.isFinite(focusEnd))) {
            focusStart = query.length; focusEnd = query.length;
        }
        focusOmniboxInput(input, focusStart, focusEnd, false);
    }
}