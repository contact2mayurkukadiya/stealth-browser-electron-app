import { DOM, hideAll, onHideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { makeRow, appendMenuRows, getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

let submenuHideTimer = null;

onHideAll(() => {
    if (submenuHideTimer) {
        clearTimeout(submenuHideTimer);
        submenuHideTimer = null;
    }
});

export function renderSubmenuAt(anchorRect, items, submenuWidth) {
    const rows = Array.isArray(items) ? items : [];
    const width = Math.round(Number(submenuWidth) || 300);
    if (!DOM.submenu) return;

    DOM.submenu.innerHTML = '';

    appendMenuRows(DOM.submenu, rows, function (it) {
        notifyHost({
            type: 'appMenuCommand',
            commandId: it.commandId || null,
            closedAt: it.closedAt || null,
            profileId: it.profileId || null,
            url: it.url || null,
        });
        hideAll({ hideLens: false });
    });

    const anchorLeft = Number(anchorRect?.left) || 0;
    const anchorTop = Number(anchorRect?.top) || 0;

    const left = Math.max(8, Math.round(anchorLeft - width - 6));
    const top = Math.max(8, Math.min(window.innerHeight - 8, Math.round(anchorTop - 4)));

    DOM.submenu.style.left = left + 'px';
    DOM.submenu.style.top = top + 'px';
    DOM.submenu.style.width = width + 'px';
    DOM.submenu.classList.add('co-visible');
}

export function renderAppMenu(payload) {
    hideAll({ hideLens: false });
    if (!DOM.panel) return;

    const r = payload.menuRect || {};
    const width = Math.round(r.width != null ? r.width : 320);
    const metrics = getCompactMenuMetrics(payload);
    const left = Math.max(8, Math.min(Math.round(r.left != null ? r.left : 0), metrics.viewportWidth - width - 8));
    const top = Math.max(8, Math.min(Math.round(r.top != null ? r.top : 0), metrics.viewportHeight - 80 - 8));
    const panelPoint = toCompactMenuPoint(payload, left, top);
    const submenus = payload.submenus && typeof payload.submenus === 'object' ? payload.submenus : {};

    DOM.panel.innerHTML = '';
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = width + 'px';
    DOM.panel.style.minWidth = width + 'px';
    DOM.panel.style.maxWidth = width + 'px';
    DOM.panel.style.maxHeight = Math.max(240, Math.min(metrics.viewportHeight - top - 8, window.innerHeight - panelPoint.top - 8)) + 'px';
    DOM.panel.style.overflow = 'visible';
    DOM.panel.classList.add('co-panel--app-menu');

    const items = Array.isArray(payload.items) ? payload.items : [];

    items.forEach(function (it) {
        if (!it) return;

        if (it.type === 'separator') {
            const div = document.createElement('div');
            div.className = 'co-divider';
            div.setAttribute('role', 'separator');
            DOM.panel.appendChild(div);
            return;
        }

        const submenuItems = it.submenuKey ? submenus[it.submenuKey] : null;
        const hasSubmenu = Array.isArray(submenuItems) && submenuItems.length > 0;

        const row = makeRow(it, function () {
            if (hasSubmenu) return;
            notifyHost({
                type: 'appMenuCommand',
                commandId: it.commandId || null,
                closedAt: it.closedAt || null,
                profileId: it.profileId || null,
                url: it.url || null,
            });
            hideAll({ hideLens: false });
        }, hasSubmenu);

        if (hasSubmenu) {
            const openSub = function () {
                if (submenuHideTimer) {
                    clearTimeout(submenuHideTimer);
                    submenuHideTimer = null;
                }
                const br = row.getBoundingClientRect();
                renderSubmenuAt(br, submenuItems, it.submenuWidth || 320);
            };
            row.addEventListener('mouseenter', openSub);
            row.addEventListener('focus', openSub);
        } else {
            row.addEventListener('mouseenter', function () {
                if (submenuHideTimer) {
                    clearTimeout(submenuHideTimer);
                    submenuHideTimer = null;
                }
                if (DOM.submenu) {
                    DOM.submenu.classList.remove('co-visible');
                    DOM.submenu.innerHTML = '';
                }
            });
        }

        DOM.panel.appendChild(row);
    });

    DOM.panel.onmouseleave = function () {
        submenuHideTimer = setTimeout(function () {
            if (DOM.submenu) DOM.submenu.classList.remove('co-visible');
        }, 120);
    };

    if (DOM.submenu) {
        DOM.submenu.onmouseenter = function () {
            if (submenuHideTimer) {
                clearTimeout(submenuHideTimer);
                submenuHideTimer = null;
            }
        };
        DOM.submenu.onmouseleave = function () {
            submenuHideTimer = setTimeout(function () {
                DOM.submenu.classList.remove('co-visible');
            }, 120);
        };
    }

    if (DOM.backdrop) DOM.backdrop.classList.add('co-visible');
    DOM.panel.classList.add('co-visible');
}