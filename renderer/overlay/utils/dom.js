export const OB_ICON_SVG = {
    history: 'assets/images/time-past.svg',
    search: 'assets/images/search.svg',
    bookmark: 'assets/images/bookmark.svg',
    keyword: 'assets/images/keyword.svg',
    url: 'assets/images/url.svg',
};

export const BOOKMARK_MENU_ACTION_IDS = {
    openBookmark: 1, removeBookmark: 1, openNewTab: 1, openNewWindow: 1,
    openStealth: 1, delete: 1, openManager: 1, toggleBar: 1
};

export function AssetMaskIcon(iconUrl, size = 16, className = '') {
    var icon = document.createElement('span');
    if (className) icon.className = className;
    icon.style.width = size + 'px';
    icon.style.height = size + 'px';
    icon.style.display = 'inline-block';
    icon.style.flex = '0 0 auto';
    icon.style.backgroundColor = 'currentColor';
    icon.style.verticalAlign = 'middle';
    var maskStyle = "url('" + iconUrl + "') center / contain no-repeat";
    icon.style.mask = maskStyle;
    icon.style.webkitMask = maskStyle;
    return icon;
}

export function makeRow(item, onClick, hasChevron) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'co-row' + (item.disabled ? ' co-row--disabled' : '') + (item.header ? ' co-row--header' : '') + (item.highlight ? ' co-row--highlight' : '');
    row.setAttribute('role', item.header ? 'presentation' : 'menuitem');
    if (item.avatar) {
        const avatarData = item.avatar || {};
        const avatar = document.createElement('span');
        avatar.className = 'co-row__avatar';
        avatar.style.background = String(avatarData.background || '#5f6368');
        if (avatarData.src) {
            const img = document.createElement('img');
            img.className = 'co-row__avatar-img' + (avatarData.preset ? ' co-row__avatar-img--preset' : '');
            img.src = String(avatarData.src);
            img.alt = '';
            avatar.appendChild(img);
        } else {
            avatar.textContent = String(avatarData.initials || '?').slice(0, 2);
        }
        row.appendChild(avatar);
    } else if (item.iconSrc) {
        const icon = document.createElement('span');
        icon.className = 'co-row__icon';
        const img = document.createElement('img');
        img.className = 'co-row__icon-img';
        img.src = String(item.iconSrc);
        img.alt = '';
        icon.appendChild(img);
        row.appendChild(icon);
    } else if (item.icon) {
        const icon = document.createElement('span');
        icon.className = 'co-row__icon';
        icon.textContent = item.icon;
        row.appendChild(icon);
    }
    const label = document.createElement('span');
    label.className = 'co-row__label';
    label.textContent = String(item.label || '');
    row.appendChild(label);
    if (item.shortcut || hasChevron) {
        const right = document.createElement('span');
        right.className = 'co-row__right';
        if (item.shortcut) right.textContent = String(item.shortcut);
        if (hasChevron) {
            const chev = document.createElement('span');
            chev.className = 'co-row__chevron';
            chev.textContent = '›';
            right.appendChild(chev);
        }
        row.appendChild(right);
    }
    if (!item.disabled && !item.header && typeof onClick === 'function') {
        row.addEventListener('click', onClick);
    }
    return row;
}

export function appendMenuRows(container, rows, onItemActivate) {
    const list = Array.isArray(rows) ? rows : [];
    list.forEach(function (it) {
        if (it && it.type === 'separator') {
            const div = document.createElement('div');
            div.className = 'co-divider';
            div.setAttribute('role', 'separator');
            container.appendChild(div);
            return;
        }
        const row = makeRow(it || {}, function () {
            if (typeof onItemActivate === 'function') onItemActivate(it);
        }, false);
        container.appendChild(row);
    });
}

export function isChromeStyleMenuRows(rows) {
    if (!Array.isArray(rows) || !rows.length) return false;
    return rows.some(it => it && (it.commandId || it.header || it.type === 'separator' || it.highlight));
}

export function getCompactMenuMetrics(payload) {
    var overlayBounds = payload && payload.overlayBounds ? payload.overlayBounds : null;
    var viewport = payload && payload.overlayViewport ? payload.overlayViewport : null;
    var offsetX = overlayBounds && Number.isFinite(Number(overlayBounds.x)) ? Number(overlayBounds.x) : 0;
    var offsetY = overlayBounds && Number.isFinite(Number(overlayBounds.y)) ? Number(overlayBounds.y) : 0;
    var viewportWidth = viewport && Number.isFinite(Number(viewport.width)) ? Number(viewport.width) : window.innerWidth;
    var viewportHeight = viewport && Number.isFinite(Number(viewport.height)) ? Number(viewport.height) : window.innerHeight;
    return { offsetX, offsetY, viewportWidth, viewportHeight };
}

export function toCompactMenuPoint(payload, left, top) {
    var metrics = getCompactMenuMetrics(payload);
    return {
        left: Math.round(left - metrics.offsetX),
        top: Math.round(top - metrics.offsetY),
    };
}