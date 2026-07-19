import { hideAll, onHideAll } from '../state.js';
import { notifyHost } from '../api.js';

let lensLayer = null;
let lensPointerId = null;

onHideAll((options) => {
    if (options && options.hideLens === false) return;
    hideLensSelection();
});

export function hideLensSelection() {
    lensPointerId = null;
    if (lensLayer && lensLayer.parentNode) {
        lensLayer.parentNode.removeChild(lensLayer);
    }
    lensLayer = null;
}

export function renderLensSelection(patch) {
    // Synchronously clean up existing layers/menus before creating the new one
    hideAll({ hideLens: true });

    lensLayer = document.createElement('div');
    lensLayer.className = 'co-lens-layer';
    lensLayer.setAttribute('role', 'application');
    lensLayer.setAttribute('aria-label', 'Search with Google Lens selection area');

    const siteRect = patch.siteBounds || {};
    const site = {
        x: Math.round(Number(siteRect.x) || 0),
        y: Math.round(Number(siteRect.y) || 0),
        width: Math.round(Number(siteRect.width) || window.innerWidth),
        height: Math.round(Number(siteRect.height) || window.innerHeight),
    };
    const leftPanelRect = patch.leftPanelBounds || site;
    const leftPanel = {
        x: Math.round(Number(leftPanelRect.x) || site.x),
        y: Math.round(Number(leftPanelRect.y) || site.y),
        width: Math.round(Number(leftPanelRect.width) || site.width),
        height: Math.round(Number(leftPanelRect.height) || site.height),
    };
    const sidebarRect = patch.sidebarBounds || {};
    const sidebar = {
        x: Math.round(Number(sidebarRect.x) || ((Number(patch.windowWidth) || window.innerWidth) - Number(patch.sidebarWidth || 0))),
        y: Math.round(Number(sidebarRect.y) || 0),
        width: Math.round(Number(sidebarRect.width) || Number(patch.sidebarWidth || 0)),
        height: Math.round(Number(sidebarRect.height) || window.innerHeight),
    };
    const panelGap = Math.max(14, Math.round(Number(patch.panelGap) || 14));
    const panelRadius = Math.max(12, Math.round(Number(patch.panelRadius) || 24));
    const windowWidth = Math.max(1, Number(patch.windowWidth) || window.innerWidth);
    const contentHeight = Math.max(1, Number(patch.contentHeight) || window.innerHeight);
    const backdropTop = Math.max(0, Math.round(Number(patch.backdropTop) || 0));
    const sourceWidth = Math.max(1, Number(patch.sourceWidth) || windowWidth);
    const sourceHeight = Math.max(1, Number(patch.sourceHeight) || contentHeight);

    const backdropPieces = [];
    const addBackdropPiece = function (x, y, width, height) {
        if (width <= 1 || height <= 1) return;
        const piece = document.createElement('div');
        piece.className = 'co-lens-panel-backdrop';
        piece.style.left = Math.round(x) + 'px';
        piece.style.top = Math.round(y) + 'px';
        piece.style.width = Math.round(width) + 'px';
        piece.style.height = Math.round(height) + 'px';
        lensLayer.appendChild(piece);
        backdropPieces.push(piece);
    };

    const renderPanelBackdrops = function () {
        while (backdropPieces.length) {
            const piece = backdropPieces.pop();
            if (piece && piece.parentNode) piece.parentNode.removeChild(piece);
        }
        addBackdropPiece(0, backdropTop, windowWidth, Math.max(0, Math.max(leftPanel.y, sidebar.y) - backdropTop));
        addBackdropPiece(0, Math.max(leftPanel.y + leftPanel.height, sidebar.y + sidebar.height), windowWidth, Math.max(0, contentHeight - Math.max(leftPanel.y + leftPanel.height, sidebar.y + sidebar.height)));
        addBackdropPiece(0, Math.min(leftPanel.y, sidebar.y), Math.max(0, leftPanel.x), Math.max(leftPanel.height, sidebar.height));
        addBackdropPiece(leftPanel.x + leftPanel.width, Math.min(leftPanel.y, sidebar.y), Math.max(0, sidebar.x - (leftPanel.x + leftPanel.width)), Math.max(leftPanel.height, sidebar.height));
        addBackdropPiece(sidebar.x + sidebar.width, Math.min(leftPanel.y, sidebar.y), Math.max(0, windowWidth - (sidebar.x + sidebar.width)), Math.max(leftPanel.height, sidebar.height));
    };
    renderPanelBackdrops();

    const bgBlur = document.createElement('div');
    bgBlur.className = 'co-lens-bg-blur';
    bgBlur.style.left = leftPanel.x + 'px';
    bgBlur.style.top = leftPanel.y + 'px';
    bgBlur.style.width = leftPanel.width + 'px';
    bgBlur.style.height = leftPanel.height + 'px';
    bgBlur.style.borderRadius = panelRadius + 'px';

    if (patch.snapshotDataUrl) {
        const bgImg = document.createElement('img');
        bgImg.className = 'co-lens-bg-image';
        bgImg.src = patch.snapshotDataUrl;
        bgImg.alt = '';
        bgBlur.appendChild(bgImg);
        const bgOverlay = document.createElement('div');
        bgOverlay.className = 'co-lens-bg-overlay';
        bgBlur.appendChild(bgOverlay);
    }
    lensLayer.appendChild(bgBlur);

    const siteFrame = document.createElement('div');
    siteFrame.className = 'co-lens-site-frame';
    siteFrame.style.left = site.x + 'px';
    siteFrame.style.top = site.y + 'px';
    siteFrame.style.width = site.width + 'px';
    siteFrame.style.height = site.height + 'px';

    if (patch.snapshotDataUrl) {
        const sharpImg = document.createElement('img');
        sharpImg.className = 'co-lens-sharp-image';
        sharpImg.src = patch.snapshotDataUrl;
        sharpImg.alt = '';
        siteFrame.appendChild(sharpImg);
    }
    lensLayer.appendChild(siteFrame);

    const leftClose = document.createElement('button');
    leftClose.type = 'button';
    leftClose.className = 'co-lens-close';
    leftClose.textContent = '×';
    leftClose.title = 'Close Google Lens';
    leftClose.style.left = Math.max(8, site.x + site.width - 14) + 'px';
    leftClose.style.top = Math.max(8, site.y - 14) + 'px';
    lensLayer.appendChild(leftClose);

    const chip = document.createElement('div');
    chip.className = 'co-lens-chip';
    if (patch.hasSelection) chip.classList.add('co-hidden');
    chip.textContent = patch.hint || 'Select any text or image to search with Google Lens';
    lensLayer.appendChild(chip);

    const magnifier = document.createElement('div');
    magnifier.className = 'co-lens-magnifier';
    const magnifierImage = typeof patch.snapshotDataUrl === 'string' ? patch.snapshotDataUrl : '';
    if (magnifierImage) {
        magnifier.style.backgroundImage = 'url("' + magnifierImage.replace(/"/g, '\\"') + '")';
    }
    lensLayer.appendChild(magnifier);

    const selectionMask = document.createElement('div');
    selectionMask.className = 'co-lens-selection-mask';
    selectionMask.style.left = leftPanel.x + 'px';
    selectionMask.style.top = leftPanel.y + 'px';
    selectionMask.style.width = leftPanel.width + 'px';
    selectionMask.style.height = leftPanel.height + 'px';
    selectionMask.style.borderRadius = panelRadius + 'px';
    lensLayer.appendChild(selectionMask);

    const selection = document.createElement('div');
    selection.className = 'co-lens-selection';
    ['tl', 'tr', 'bl', 'br'].forEach(function (corner) {
        const cornerEl = document.createElement('div');
        cornerEl.className = 'co-lens-selection-corner co-lens-selection-corner--' + corner;
        selection.appendChild(cornerEl);
    });
    selectionMask.appendChild(selection);

    const actions = document.createElement('div');
    actions.className = 'co-lens-actions';
    const copyTextIcon = 'assets/images/poll-h.svg';
    const copyImageIcon = 'assets/images/picture.svg';
    actions.innerHTML = (patch.hasSelectionText
        ? '<button class="co-lens-action" type="button" data-action="copyText"><img class="co-lens-action-icon" src="' + copyTextIcon + '" alt="">Copy text</button>'
        : '') + '<button class="co-lens-action" type="button" data-action="copyImage"><img class="co-lens-action-icon" src="' + copyImageIcon + '" alt="">Copy as image</button>';
    lensLayer.appendChild(actions);

    const copyToast = document.createElement('div');
    copyToast.className = 'co-lens-copy-toast';
    copyToast.textContent = 'Copied';
    lensLayer.appendChild(copyToast);
    let copyToastTimer = null;

    const resizer = document.createElement('div');
    resizer.className = 'co-lens-resizer';
    resizer.setAttribute('title', 'Resize Lens sidebar');
    lensLayer.appendChild(resizer);

    const cursorTooltip = document.createElement('div');
    cursorTooltip.className = 'co-lens-cursor-tooltip';
    cursorTooltip.textContent = 'Drag to search';
    lensLayer.appendChild(cursorTooltip);

    let startX = 0; let startY = 0; let currentRect = null;
    let resizePointerId = null; let resizeStartX = 0;
    let resizeStartWidth = Number(patch.sidebarWidth) || 0;
    let selectionStarted = !!patch.hasSelection;
    let selectedRatio = patch.selectionRatio && typeof patch.selectionRatio === 'object'
        ? {
            x: Math.max(0, Number(patch.selectionRatio.x) || 0),
            y: Math.max(0, Number(patch.selectionRatio.y) || 0),
            width: Math.max(0, Number(patch.selectionRatio.width) || 0),
            height: Math.max(0, Number(patch.selectionRatio.height) || 0),
        } : null;

    const positionResizer = function () {
        resizer.style.left = Math.max(0, sidebar.x - Math.floor(panelGap / 2)) + 'px';
        resizer.style.top = Math.round(sidebar.y + (sidebar.height / 2)) + 'px';
        resizer.style.width = Math.max(12, panelGap) + 'px';
        resizer.style.height = Math.max(96, sidebar.height) + 'px';
    };
    positionResizer();

    const rectFromSelectionRatio = function () {
        if (!selectedRatio) return null;
        return {
            x: site.x + (selectedRatio.x * site.width),
            y: site.y + (selectedRatio.y * site.height),
            width: Math.max(8, selectedRatio.width * site.width),
            height: Math.max(8, selectedRatio.height * site.height),
        };
    };

    const applyResizePreview = function (nextWidth) {
        sidebar.width = nextWidth;
        sidebar.x = Math.max(panelGap, windowWidth - nextWidth - panelGap);
        leftPanel.width = Math.max(0, sidebar.x - (panelGap * 2));
        const maxContainerWidth = Math.max(1, leftPanel.width - 16);
        const maxContainerHeight = Math.max(1, leftPanel.height - 16);
        const scale = Math.max(0.05, Math.min(1, maxContainerWidth / sourceWidth, maxContainerHeight / sourceHeight));
        site.width = Math.min(Math.max(1, Math.floor(sourceWidth * scale)), maxContainerWidth);
        site.height = Math.min(Math.max(1, Math.floor(sourceHeight * scale)), maxContainerHeight);
        site.x = leftPanel.x + Math.max(8, Math.floor((leftPanel.width - site.width) / 2));
        site.y = leftPanel.y + Math.max(8, Math.floor((leftPanel.height - site.height) / 2));

        bgBlur.style.left = leftPanel.x + 'px'; bgBlur.style.top = leftPanel.y + 'px';
        bgBlur.style.width = leftPanel.width + 'px'; bgBlur.style.height = leftPanel.height + 'px';
        selectionMask.style.left = leftPanel.x + 'px'; selectionMask.style.top = leftPanel.y + 'px';
        selectionMask.style.width = leftPanel.width + 'px'; selectionMask.style.height = leftPanel.height + 'px';
        siteFrame.style.left = site.x + 'px'; siteFrame.style.top = site.y + 'px';
        siteFrame.style.width = site.width + 'px'; siteFrame.style.height = site.height + 'px';
        leftClose.style.left = Math.max(8, site.x + site.width - 14) + 'px';
        leftClose.style.top = Math.max(8, site.y - 14) + 'px';
        renderPanelBackdrops(); positionResizer();

        const scaledSelection = rectFromSelectionRatio();
        if (scaledSelection) {
            currentRect = scaledSelection; showSelection(scaledSelection, true, false);
        } else {
            selection.classList.remove('co-visible', 'co-lens-selection--complete', 'co-lens-selection--animate');
            actions.classList.remove('co-visible');
        }
    };

    const positionActions = function (rect) {
        const actionWidth = 132;
        const left = Math.max(site.x + 6, Math.min(site.x + site.width - actionWidth - 6, rect.x));
        const below = rect.y + rect.height + 8;
        const top = below + 78 < site.y + site.height ? below : Math.max(site.y + 6, rect.y - 82);
        actions.style.left = left + 'px'; actions.style.top = top + 'px'; actions.classList.add('co-visible');
    };

    const showCopyToast = function () {
        const actionsLeft = Number.parseFloat(actions.style.left) || site.x;
        const actionsTop = Number.parseFloat(actions.style.top) || site.y;
        copyToast.style.left = Math.max(site.x + 6, actionsLeft) + 'px';
        copyToast.style.top = Math.max(site.y + 6, actionsTop - 36) + 'px';
        copyToast.classList.add('co-visible');
        if (copyToastTimer) clearTimeout(copyToastTimer);
        copyToastTimer = setTimeout(function () { copyToast.classList.remove('co-visible'); copyToastTimer = null; }, 1600);
    };

    const showSelection = function (rect, complete, animate) {
        selection.style.left = (rect.x - leftPanel.x) + 'px'; selection.style.top = (rect.y - leftPanel.y) + 'px';
        selection.style.width = rect.width + 'px'; selection.style.height = rect.height + 'px';
        selection.classList.toggle('co-lens-selection--complete', complete === true);
        selection.classList.toggle('co-lens-selection--animate', complete === true && animate === true);
        selection.classList.add('co-visible'); positionActions(rect);
    };

    const resizeSidebar = function (event) {
        const windowWidth = Math.max(1, Number(patch.windowWidth) || window.innerWidth);
        const minSidebarWidth = Math.max(1, Number(patch.minSidebarWidth) || 220);
        const maxSidebarWidth = Math.max(minSidebarWidth, Number(patch.maxSidebarWidth) || Math.floor(windowWidth * 0.3));
        const deltaX = event.clientX - resizeStartX;
        const nextWidth = Math.max(minSidebarWidth, Math.min(maxSidebarWidth, Math.round(resizeStartWidth - deltaX)));
        applyResizePreview(nextWidth); notifyHost({ type: 'lensSidebarResize', width: nextWidth }); return nextWidth;
    };

    const hideLensCursorAids = function () { cursorTooltip.classList.remove('co-visible'); magnifier.classList.remove('co-visible'); };

    const moveCursorTooltip = function (x, y) {
        if (resizePointerId !== null) { hideLensCursorAids(); return; }
        const tooltipWidth = 112; const tooltipHeight = 28;
        const left = Math.min(window.innerWidth - tooltipWidth, Math.max(8, x + 12));
        const top = y - tooltipHeight - 12 >= 8 ? y - tooltipHeight - 12 : Math.min(window.innerHeight - tooltipHeight, Math.max(8, y + 12));
        cursorTooltip.style.left = left + 'px'; cursorTooltip.style.top = top + 'px';
        const magLeft = Math.min(site.x + site.width - 116, Math.max(site.x, x + 18));
        const magTop = Math.min(site.y + site.height - 116, Math.max(site.y, y + 18));
        magnifier.style.left = magLeft + 'px'; magnifier.style.top = magTop + 'px';
        if (magnifierImage) {
            const zoom = 2.15;
            magnifier.style.backgroundSize = (site.width * zoom) + 'px ' + (site.height * zoom) + 'px';
            magnifier.style.backgroundPosition = (58 - ((x - site.x) * zoom)) + 'px ' + (58 - ((y - site.y) * zoom)) + 'px';
            magnifier.classList.add('co-visible');
        }
        if (!selectionStarted) cursorTooltip.classList.add('co-visible');
        else cursorTooltip.classList.remove('co-visible');
    };

    const updateSelection = function (x, y) {
        const left = Math.max(0, Math.min(startX, x)); const top = Math.max(0, Math.min(startY, y));
        const right = Math.min(site.x + site.width, Math.max(startX, x)); const bottom = Math.min(site.y + site.height, Math.max(startY, y));
        const width = Math.max(0, right - left); const height = Math.max(0, bottom - top);
        currentRect = { x: left, y: top, width, height }; selectedRatio = null;
        showSelection(currentRect, false); actions.classList.remove('co-visible');
    };

    lensLayer.addEventListener('pointerdown', function (event) {
        if (event.button !== 0) return; if (resizePointerId !== null) return;
        if (event.target === leftClose || event.target.closest?.('.co-lens-actions')) return;
        selectionStarted = true; chip.classList.add('co-hidden'); cursorTooltip.classList.remove('co-visible');
        lensPointerId = event.pointerId; lensLayer.setPointerCapture(lensPointerId);
        startX = Math.max(site.x, Math.min(site.x + site.width, event.clientX)); startY = Math.max(site.y, Math.min(site.y + site.height, event.clientY));
        currentRect = null; actions.classList.remove('co-visible'); selection.classList.remove('co-visible', 'co-lens-selection--complete', 'co-lens-selection--animate');
        lensLayer.classList.add('co-lens-layer--dragging'); moveCursorTooltip(event.clientX, event.clientY); updateSelection(startX, startY);
    });

    lensLayer.addEventListener('pointermove', function (event) {
        if (resizePointerId === null) moveCursorTooltip(event.clientX, event.clientY);
        if (lensPointerId !== event.pointerId) return;
        const x = Math.max(site.x, Math.min(site.x + site.width, event.clientX));
        const y = Math.max(site.y, Math.min(site.y + site.height, event.clientY)); updateSelection(x, y);
    });

    lensLayer.addEventListener('pointerup', function (event) {
        if (lensPointerId !== event.pointerId) return;
        try { lensLayer.releasePointerCapture(lensPointerId); } catch (_) { }
        lensPointerId = null; lensLayer.classList.remove('co-lens-layer--dragging');
        if (currentRect && currentRect.width >= 8 && currentRect.height >= 8) {
            selectedRatio = {
                x: Math.max(0, (currentRect.x - site.x) / site.width), y: Math.max(0, (currentRect.y - site.y) / site.height),
                width: Math.max(0, currentRect.width / site.width), height: Math.max(0, currentRect.height / site.height),
            };
            showSelection(currentRect, true, true);
            notifyHost({ type: 'lensSelectionCapture', rect: { x: Math.max(0, currentRect.x - site.x), y: Math.max(0, currentRect.y - site.y), width: currentRect.width, height: currentRect.height } });
        }
    });

    lensLayer.addEventListener('pointerenter', function (event) { moveCursorTooltip(event.clientX, event.clientY); });
    lensLayer.addEventListener('pointerleave', function () { hideLensCursorAids(); });
    lensLayer.addEventListener('pointercancel', function (event) {
        if (lensPointerId !== event.pointerId) return;
        lensPointerId = null; lensLayer.classList.remove('co-lens-layer--dragging');
        selection.classList.remove('co-visible', 'co-lens-selection--complete', 'co-lens-selection--animate'); currentRect = null;
    });

    resizer.addEventListener('pointerdown', function (event) {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation(); resizePointerId = event.pointerId; hideLensCursorAids();
        resizeStartX = event.clientX; resizeStartWidth = Number(patch.sidebarWidth) || resizeStartWidth;
        resizer.setPointerCapture(resizePointerId); resizeSidebar(event);
    });
    resizer.addEventListener('pointermove', function (event) {
        if (resizePointerId !== event.pointerId) return; event.preventDefault(); event.stopPropagation(); hideLensCursorAids(); resizeSidebar(event);
    });
    resizer.addEventListener('pointerup', function (event) {
        if (resizePointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation(); try { resizer.releasePointerCapture(resizePointerId); } catch (_) { }
        resizePointerId = null; hideLensCursorAids();
        const nextWidth = resizeSidebar(event); notifyHost({ type: 'lensSidebarResizeCommit', width: nextWidth || sidebar.width || resizeStartWidth });
    });
    resizer.addEventListener('pointercancel', function (event) { if (resizePointerId !== event.pointerId) return; resizePointerId = null; hideLensCursorAids(); });

    actions.addEventListener('click', function (event) {
        const btn = event.target.closest('[data-action]'); if (!btn) return; event.preventDefault(); event.stopPropagation();
        if (btn.dataset.action === 'copyImage') { notifyHost({ type: 'lensCopyImage' }); showCopyToast(); }
        if (btn.dataset.action === 'copyText') { notifyHost({ type: 'lensCopyText' }); showCopyToast(); }
    });

    leftClose.addEventListener('click', function (event) {
        event.preventDefault(); event.stopPropagation(); notifyHost({ type: 'lensSelectionCancel', closeSidebar: true });
    });

    if (patch.selectionRect && patch.hasSelection) {
        showSelection({
            x: site.x + Math.max(0, Number(patch.selectionRect.x) || 0), y: site.y + Math.max(0, Number(patch.selectionRect.y) || 0),
            width: Math.max(8, Number(patch.selectionRect.width) || 8), height: Math.max(8, Number(patch.selectionRect.height) || 8),
        }, true, false);
    }

    document.body.appendChild(lensLayer);
}