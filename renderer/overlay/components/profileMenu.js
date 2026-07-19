import { DOM, hideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { appendMenuRows, isChromeStyleMenuRows, getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

export function renderProfileMenu(payload) {
    hideAll({ hideLens: false });
    if (!DOM.panel) return;

    const r = payload.menuRect || {};
    const width = Math.round(r.width != null ? r.width : 320);
    const metrics = getCompactMenuMetrics(payload);
    const left = Math.max(8, Math.min(Math.round(r.left != null ? r.left : 0), metrics.viewportWidth - width - 8));
    const top = Math.max(8, Math.min(Math.round(r.top != null ? r.top : 0), metrics.viewportHeight - 80 - 8));
    const panelPoint = toCompactMenuPoint(payload, left, top);

    DOM.panel.innerHTML = '';
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = width + 'px';
    DOM.panel.style.minWidth = width + 'px';
    DOM.panel.style.maxWidth = width + 'px';
    DOM.panel.style.maxHeight = Math.max(240, Math.min(metrics.viewportHeight - top - 8, window.innerHeight - panelPoint.top - 8)) + 'px';
    DOM.panel.style.overflowY = 'auto';
    DOM.panel.style.overflowX = 'hidden';

    const items = Array.isArray(payload.items) ? payload.items : [];

    if (isChromeStyleMenuRows(items)) {
        appendMenuRows(DOM.panel, items, function (it) {
            notifyHost({
                type: 'appMenuCommand',
                commandId: it.commandId || null,
                profileId: it.profileId || null,
            });
            hideAll({ hideLens: false });
        });
    } else {
        items.forEach(function (it) {
            if (!it) return;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'co-row';
            btn.setAttribute('role', 'menuitem');
            btn.textContent = it.label || it.profileId || '';
            btn.addEventListener('click', function () {
                notifyHost({ type: 'selectProfile', profileId: it.profileId });
            });
            DOM.panel.appendChild(btn);
        });

        if (payload.showEdit) {
            const div = document.createElement('div');
            div.className = 'co-divider';
            div.setAttribute('role', 'separator');
            DOM.panel.appendChild(div);

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'co-row';
            editBtn.setAttribute('role', 'menuitem');
            editBtn.textContent = 'Edit profile…';
            editBtn.addEventListener('click', function () {
                notifyHost({ type: 'editProfile' });
            });
            DOM.panel.appendChild(editBtn);
        }

        const div2 = document.createElement('div');
        div2.className = 'co-divider';
        div2.setAttribute('role', 'separator');
        DOM.panel.appendChild(div2);

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'co-row co-row--add';
        addBtn.setAttribute('role', 'menuitem');
        addBtn.textContent = '+  Add new profile';
        addBtn.addEventListener('click', function () {
            notifyHost({ type: 'addProfile' });
        });
        DOM.panel.appendChild(addBtn);
    }

    if (DOM.backdrop) DOM.backdrop.classList.add('co-visible');
    DOM.panel.classList.add('co-visible');
}