import { DOM, hideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { AssetMaskIcon, getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

/**
 * Maps permission name to SVG asset path
 */
function getPermissionIconPath(permName) {
    switch (permName) {
        case 'camera':
            return 'assets/images/camera.svg';
        case 'microphone':
            return 'assets/images/mic.svg';
        case 'geolocation':
            return 'assets/images/earth-americas.svg';
        case 'notifications':
            return 'assets/images/comment-info.svg';
        case 'clipboard-read':
        case 'clipboard-sanitized-write':
            return 'assets/images/clipboard.svg';
        case 'usb':
        case 'hid':
        case 'serial':
        case 'bluetooth':
            return 'assets/images/settings.svg';
        default:
            return 'assets/images/shield.svg';
    }
}

/**
 * Renders the interactive permission prompt dialog anchored below the address bar.
 * @param {Object} payload
 * @param {string} payload.promptId
 * @param {string} payload.origin
 * @param {string} payload.permission
 * @param {Object} payload.metadata
 * @param {Object} [payload.anchorRect]
 */
export function renderPermissionPrompt(payload) {
    hideAll({ hideLens: false });

    const promptId = payload.promptId;
    const origin = payload.origin || 'This site';
    const permission = payload.permission || 'unknown';
    const metadata = payload.metadata || {};
    const label = metadata.label || permission;
    const description = metadata.description || `Access your ${label.toLowerCase()}`;
    const iconPath = getPermissionIconPath(permission);

    const r = payload.anchorRect || { left: 160, top: 44, width: 34, height: 34 };
    const width = 360;
    const metrics = getCompactMenuMetrics(payload);
    const pad = 12;
    const left0 = Math.round(r.left != null ? r.left : 160);
    const top0 = Math.round(r.top != null ? r.top : 44);
    const h0 = Math.max(1, Math.round(r.height != null ? r.height : 34));

    const left = Math.max(pad, Math.min(left0, metrics.viewportWidth - width - pad));
    const top = Math.max(pad, Math.min(top0 + h0 + 6, metrics.viewportHeight - 240 - pad));
    const panelPoint = toCompactMenuPoint(payload, left, top);

    DOM.panel.innerHTML = '';
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = width + 'px';
    DOM.panel.style.minWidth = width + 'px';
    DOM.panel.style.maxWidth = width + 'px';
    DOM.panel.style.maxHeight = '300px';
    DOM.panel.style.display = 'flex';
    DOM.panel.style.flexDirection = 'column';
    DOM.panel.style.overflow = 'hidden';
    DOM.panel.classList.remove('co-panel--app-menu');

    // Header container
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'flex-start';
    header.style.justifyContent = 'space-between';
    header.style.padding = '16px 16px 12px';
    header.style.gap = '12px';

    const headerTextGroup = document.createElement('div');
    headerTextGroup.style.flex = '1';
    headerTextGroup.style.minWidth = '0';

    const originEl = document.createElement('div');
    originEl.style.fontSize = '14px';
    originEl.style.fontWeight = '600';
    originEl.style.color = 'var(--chrome-fg, #202124)';
    originEl.style.overflow = 'hidden';
    originEl.style.textOverflow = 'ellipsis';
    originEl.style.whiteSpace = 'nowrap';
    originEl.textContent = origin;
    originEl.title = origin;

    const wantsToEl = document.createElement('div');
    wantsToEl.style.fontSize = '13px';
    wantsToEl.style.color = 'var(--chrome-secondary-fg, #5f6368)';
    wantsToEl.style.marginTop = '2px';
    wantsToEl.textContent = 'wants to:';

    headerTextGroup.appendChild(originEl);
    headerTextGroup.appendChild(wantsToEl);

    // Close button (resolves with deny)
    const closeBtn = document.createElement('button');
    closeBtn.className = 'co-site-info-close-btn';
    closeBtn.style.flexShrink = '0';
    closeBtn.appendChild(AssetMaskIcon('assets/images/cross-small.svg', 16));
    closeBtn.onclick = () => {
        hideAll({ hideLens: false });
        notifyHost({
            type: 'permissionPromptResponse',
            promptId,
            decision: 'deny',
            persist: false,
        });
    };

    header.appendChild(headerTextGroup);
    header.appendChild(closeBtn);
    DOM.panel.appendChild(header);

    // Permission Details Row
    const detailRow = document.createElement('div');
    detailRow.style.display = 'flex';
    detailRow.style.alignItems = 'center';
    detailRow.style.padding = '8px 16px 16px';
    detailRow.style.gap = '12px';

    const iconBox = document.createElement('div');
    iconBox.style.width = '32px';
    iconBox.style.height = '32px';
    iconBox.style.borderRadius = '50%';
    iconBox.style.backgroundColor = 'var(--chrome-card-bg, #f1f3f4)';
    iconBox.style.display = 'flex';
    iconBox.style.alignItems = 'center';
    iconBox.style.justifyContent = 'center';
    iconBox.style.flexShrink = '0';
    iconBox.appendChild(AssetMaskIcon(iconPath, 18));

    const descText = document.createElement('div');
    descText.style.fontSize = '13px';
    descText.style.fontWeight = '500';
    descText.style.color = 'var(--chrome-fg, #202124)';
    descText.textContent = description;

    detailRow.appendChild(iconBox);
    detailRow.appendChild(descText);
    DOM.panel.appendChild(detailRow);

    // Action Buttons Footer
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.alignItems = 'center';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.style.padding = '12px 16px';
    footer.style.borderTop = '1px solid var(--chrome-tab-separator, #dadce0)';
    footer.style.backgroundColor = 'var(--chrome-card-bg, #f8f9fa)';
    footer.style.borderBottomLeftRadius = '8px';
    footer.style.borderBottomRightRadius = '8px';

    const createBtn = (text, isPrimary, onClick) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.style.padding = '6px 12px';
        btn.style.borderRadius = '6px';
        btn.style.fontSize = '12px';
        btn.style.fontWeight = '500';
        btn.style.cursor = 'pointer';
        btn.style.transition = 'background-color 0.15s ease';

        if (isPrimary) {
            btn.style.backgroundColor = 'var(--chrome-accent, #1a73e8)';
            btn.style.color = '#ffffff';
            btn.style.border = 'none';
            btn.onmouseenter = () => btn.style.filter = 'brightness(0.92)';
            btn.onmouseleave = () => btn.style.filter = 'none';
        } else {
            btn.style.backgroundColor = 'var(--chrome-bg, #ffffff)';
            btn.style.color = 'var(--chrome-fg, #3c4043)';
            btn.style.border = '1px solid var(--chrome-tab-separator, #dadce0)';
            btn.onmouseenter = () => btn.style.backgroundColor = 'var(--chrome-hover-bg, #f1f3f4)';
            btn.onmouseleave = () => btn.style.backgroundColor = 'var(--chrome-bg, #ffffff)';
        }

        btn.onclick = onClick;
        return btn;
    };

    const blockBtn = createBtn('Block', false, () => {
        hideAll({ hideLens: false });
        notifyHost({
            type: 'permissionPromptResponse',
            promptId,
            decision: 'deny',
            persist: true,
        });
    });

    const allowOnceBtn = createBtn('Allow this time', false, () => {
        hideAll({ hideLens: false });
        notifyHost({
            type: 'permissionPromptResponse',
            promptId,
            decision: 'allow-this-session',
            persist: false,
        });
    });

    const allowAlwaysBtn = createBtn('Always Allow', true, () => {
        hideAll({ hideLens: false });
        notifyHost({
            type: 'permissionPromptResponse',
            promptId,
            decision: 'allow',
            persist: true,
        });
    });

    footer.appendChild(blockBtn);
    footer.appendChild(allowOnceBtn);
    footer.appendChild(allowAlwaysBtn);
    DOM.panel.appendChild(footer);

    DOM.backdrop.classList.add('co-visible');
    DOM.panel.classList.add('co-visible');
}
