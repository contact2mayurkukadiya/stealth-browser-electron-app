import { DOM, hideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { AssetMaskIcon, getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

export function renderCompactMenuPanel(payload, options) {
    hideAll({ hideLens: false });
    const r = payload.anchorRect || {};
    const width = options.width || 320;
    const metrics = getCompactMenuMetrics(payload);
    const pad = 8;
    const left0 = Math.round(r.left != null ? r.left : 0);
    const top0 = Math.round(r.top != null ? r.top : 0);
    const h0 = Math.max(1, Math.round(r.height != null ? r.height : 32));
    const left = Math.max(pad, Math.min(left0, metrics.viewportWidth - width - pad));
    const top = Math.max(pad, Math.min(top0 + h0 + 6, metrics.viewportHeight - 280 - pad));
    const panelPoint = toCompactMenuPoint(payload, left, top);
    DOM.panel.innerHTML = '';
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = width + 'px';
    DOM.panel.style.minWidth = width + 'px';
    DOM.panel.style.maxWidth = width + 'px';
    DOM.panel.style.maxHeight = Math.max(180, Math.min(metrics.viewportHeight * 0.5, metrics.viewportHeight - top - pad)) + 'px';
    DOM.panel.style.overflowY = 'auto';

    const header = document.createElement('div');
    header.className = 'co-site-info-header';
    const title = document.createElement('span');
    title.className = 'co-site-info-domain';
    title.textContent = options.title || '';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'co-site-info-close-btn';
    closeBtn.appendChild(AssetMaskIcon('assets/images/cross-small.svg', 16));
    closeBtn.onclick = function () { notifyHost({ type: 'dismiss', reason: 'close' }); };
    header.appendChild(title);
    header.appendChild(closeBtn);
    DOM.panel.appendChild(header);

    const content = document.createElement('div');
    content.className = 'co-site-info-content';
    const body = document.createElement('p');
    body.className = 'co-site-info-text';
    body.style.padding = '12px 16px';
    body.style.margin = '0';
    body.textContent = options.body || '';
    content.appendChild(body);
    DOM.panel.appendChild(content);

    DOM.backdrop.classList.add('co-visible');
    DOM.panel.classList.add('co-visible');
}

export function renderCookieControls(payload) {
    const domain = payload.domain || '';
    renderCompactMenuPanel(payload, {
        width: 340,
        title: 'Cookies and site data',
        body: domain
            ? ('Cookie controls for ' + domain + ' will appear here. Open Site information for full cookie management.')
            : 'Cookie controls for this site will appear here.',
    });
}

export function renderDownloadPanel(payload) {
    renderCompactMenuPanel(payload, {
        width: 300,
        title: 'Downloads',
        body: 'No active downloads. Completed files open from the browser menu.',
    });
}