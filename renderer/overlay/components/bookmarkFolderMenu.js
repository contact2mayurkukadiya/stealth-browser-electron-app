import { DOM, hideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { AssetMaskIcon, getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

export function renderBookmarkFolderMenu(payload) {
    hideAll({ hideLens: false });
    var folderId = String(payload.folderId || '');
    if (!folderId) return;
    var ar = payload.anchorRect || {};
    var minW = 240;
    var maxW = 420;
    var w = Math.round(Number(ar.width) || 280);
    w = Math.max(minW, Math.min(maxW, w));
    var left = Math.round(Number(ar.left) || 0);
    var top = Math.round(Number(ar.top) || 0) + Math.round(Number(ar.height) || 0) + 4;
    var pad = 8;
    var metrics = getCompactMenuMetrics(payload);
    left = Math.max(pad, Math.min(left, metrics.viewportWidth - w - pad));
    top = Math.max(pad, Math.min(top, metrics.viewportHeight - 80 - pad));
    var maxH = Math.min(metrics.viewportHeight * 0.9, metrics.viewportHeight - top - pad);
    maxH = Math.max(100, maxH);
    var panelPoint = toCompactMenuPoint(payload, left, top);

    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = w + 'px';
    DOM.panel.style.minWidth = w + 'px';
    DOM.panel.style.maxWidth = w + 'px';
    DOM.panel.style.maxHeight = maxH + 'px';
    DOM.panel.classList.add('co-panel--folder-menu');

    var header = document.createElement('div');
    header.className = 'co-fm-header';
    var hIcon = document.createElement('span');
    hIcon.className = 'co-fm-header-icon';
    hIcon.appendChild(AssetMaskIcon('assets/images/folder.svg', 16));
    var hTitle = document.createElement('span');
    hTitle.className = 'co-fm-header-title';
    hTitle.textContent = String(payload.title || 'Folder').slice(0, 120);
    header.appendChild(hIcon);
    header.appendChild(hTitle);
    DOM.panel.appendChild(header);

    var scroll = document.createElement('div');
    scroll.className = 'co-fm-scroll';

    var raw = Array.isArray(payload.items) ? payload.items : [];
    var items = raw.slice(0, 400);
    if (items.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'co-fm-empty';
        empty.textContent = 'This folder is empty';
        scroll.appendChild(empty);
    } else {
        for (var i = 0; i < items.length; i++) {
            (function (index) {
                var it = items[index];
                if (!it || typeof it !== 'object') return;
                var typ = it.type === 'folder' ? 'folder' : 'bookmark';
                var row = document.createElement(typ === 'bookmark' ? 'button' : 'div');
                if (typ === 'bookmark') row.type = 'button';
                row.className = 'co-fm-row' + (typ === 'folder' ? ' co-fm-row--folder' : '');
                row.setAttribute('role', typ === 'bookmark' ? 'menuitem' : 'presentation');

                var iconWrap = document.createElement('span');
                iconWrap.className = 'co-fm-row__icon';
                if (typ === 'bookmark') {
                    var fav = it.favicon && String(it.favicon).trim();
                    if (fav && fav.indexOf('javascript:') !== 0 && fav.indexOf('data:') !== 0) {
                        var img = document.createElement('img');
                        img.className = 'co-fm-row__favicon';
                        img.alt = '';
                        img.src = fav;
                        img.onerror = function () {
                            img.style.display = 'none';
                            iconWrap.textContent = '🔖';
                        };
                        iconWrap.appendChild(img);
                    } else {
                        iconWrap.textContent = '🔖';
                    }
                } else {
                    iconWrap.appendChild(AssetMaskIcon('assets/images/folder.svg', 16));
                }
                row.appendChild(iconWrap);

                var lab = document.createElement('span');
                lab.className = 'co-fm-row__label';
                lab.textContent = String(it.title || '').slice(0, 200);
                row.appendChild(lab);

                if (typ === 'bookmark') {
                    row.addEventListener('click', function () {
                        notifyHost({
                            type: 'bookmarkFolderPick',
                            folderId: folderId,
                            itemId: String(it.id || ''),
                        });
                    });
                }
                scroll.appendChild(row);
            })(i);
        }
    }

    DOM.panel.appendChild(scroll);
    DOM.backdrop.classList.add('co-visible');
    DOM.panel.classList.add('co-visible');
}