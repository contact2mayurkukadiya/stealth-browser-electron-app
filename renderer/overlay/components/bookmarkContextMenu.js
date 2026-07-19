import { DOM, hideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { getCompactMenuMetrics, toCompactMenuPoint, BOOKMARK_MENU_ACTION_IDS } from '../utils/dom.js';

export function renderBookmarkContextMenu(payload) {
    hideAll({ hideLens: false });
    const bookmarkItemId = payload.bookmarkItemId;
    if (!bookmarkItemId || typeof bookmarkItemId !== 'string') return;
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const x = Math.round(Number(payload.clientX) || 0);
    const y = Math.round(Number(payload.clientY) || 0);
    const menuWidth = 220;
    const pad = 8;
    const metrics = getCompactMenuMetrics(payload);

    const fixedHeight = 290;
    let left = x;
    let top = y;
    left = Math.max(pad, Math.min(left, metrics.viewportWidth - menuWidth - pad));
    top = Math.max(pad, Math.min(top, metrics.viewportHeight - fixedHeight - pad));

    const panelPoint = toCompactMenuPoint(payload, left, top);
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = menuWidth + 'px';
    DOM.panel.style.minWidth = menuWidth + 'px';
    DOM.panel.style.maxHeight = 'none';
    DOM.panel.style.height = 'auto';
    DOM.panel.style.overflow = 'hidden';

    let rowCount = 0;
    for (let i = 0; i < rawItems.length && rowCount < 20; i++) {
        const it = rawItems[i];
        if (!it || typeof it !== 'object') continue;
        if (it.type === 'separator') {
            const div = document.createElement('div');
            div.className = 'co-divider';
            div.setAttribute('role', 'separator');
            DOM.panel.appendChild(div);
            continue;
        }
        if (it.type !== 'item') continue;
        const actionId = it.id;
        if (!actionId || typeof actionId !== 'string' || !BOOKMARK_MENU_ACTION_IDS[actionId]) continue;
        const label = String(it.label || '').trim().slice(0, 80);
        if (!label) continue;
        const enabled = it.enabled !== false;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'co-row';
        if (it.danger) btn.style.color = '#ff6b6b';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = label;
        btn.disabled = !enabled;
        const capId = actionId;
        btn.addEventListener('click', function () {
            if (!enabled) return;
            notifyHost({ type: 'bookmarkMenu', bookmarkItemId: bookmarkItemId, id: capId });
        });
        DOM.panel.appendChild(btn);
        rowCount++;
    }
    if (rowCount === 0) return;
    DOM.backdrop.classList.add('co-visible');
    DOM.panel.classList.add('co-visible');
}