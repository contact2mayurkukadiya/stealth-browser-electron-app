import { DOM, hideAll } from '../state.js';
import { notifyHost } from '../api.js';
import { getCompactMenuMetrics, toCompactMenuPoint } from '../utils/dom.js';

export function renderBookmarkEditor(payload) {
    hideAll({ hideLens: false });
    const ar = payload.anchorRect || {};
    const panelWidth = Math.min(340, Math.max(280, window.innerWidth - 16));
    const left0 = Math.round(Number(ar.left) || 0);
    const top0 = Math.round(Number(ar.top) || 0);
    const w0 = Math.max(1, Math.round(Number(ar.width) || 32));
    const h0 = Math.max(1, Math.round(Number(ar.height) || 32));
    const metrics = getCompactMenuMetrics(payload);
    let left = left0 + w0 - panelWidth;
    left = Math.max(8, Math.min(left, metrics.viewportWidth - panelWidth - 8));
    let top = top0 + h0 + 6;
    const estH = 280;
    top = Math.max(8, Math.min(top, metrics.viewportHeight - estH - 8));
    const panelPoint = toCompactMenuPoint(payload, left, top);
    DOM.panel.style.left = panelPoint.left + 'px';
    DOM.panel.style.top = panelPoint.top + 'px';
    DOM.panel.style.width = panelWidth + 'px';
    DOM.panel.style.minWidth = panelWidth + 'px';
    DOM.panel.style.maxWidth = panelWidth + 'px';
    DOM.panel.classList.add('co-panel--editor');

    const mode = payload.mode === 'edit' ? 'edit' : 'add';
    const pageUrl = String(payload.url || '');
    const bookmarkId = payload.bookmarkId && typeof payload.bookmarkId === 'string' ? payload.bookmarkId : null;

    const scroll = document.createElement('div');
    scroll.className = 'co-bk-editor-scroll';

    if (pageUrl) {
        const urlEl = document.createElement('div');
        urlEl.className = 'co-bk-url';
        urlEl.textContent = pageUrl.length > 180 ? pageUrl.slice(0, 177) + '…' : pageUrl;
        scroll.appendChild(urlEl);
    }

    const nameField = document.createElement('div');
    nameField.className = 'co-bk-field';
    const nameLab = document.createElement('span');
    nameLab.className = 'co-bk-field-label';
    nameLab.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'co-bk-input';
    nameInput.setAttribute('autocomplete', 'off');
    nameInput.value = String(payload.initialTitle || '').slice(0, 500);
    nameField.appendChild(nameLab);
    nameField.appendChild(nameInput);
    scroll.appendChild(nameField);

    const folderField = document.createElement('div');
    folderField.className = 'co-bk-field';
    const folderLab = document.createElement('span');
    folderLab.className = 'co-bk-field-label';
    folderLab.textContent = 'Folder';
    const sel = document.createElement('select');
    sel.className = 'co-bk-select';
    const optRoot = document.createElement('option');
    optRoot.value = 'root';
    optRoot.textContent = 'Bookmarks bar';
    sel.appendChild(optRoot);
    const folderIds = { root: 1 };
    const rawFolders = Array.isArray(payload.folders) ? payload.folders : [];
    for (let i = 0; i < rawFolders.length; i++) {
        const f = rawFolders[i];
        if (!f || typeof f.id !== 'string' || !f.id) continue;
        folderIds[f.id] = 1;
        const o = document.createElement('option');
        o.value = f.id;
        o.textContent = String(f.label || f.id).slice(0, 200);
        sel.appendChild(o);
    }
    let want = payload.initialFolderId === 'root' || !payload.initialFolderId ? 'root' : String(payload.initialFolderId);
    if (!folderIds[want]) want = 'root';
    sel.value = want;
    folderField.appendChild(folderLab);
    folderField.appendChild(sel);
    scroll.appendChild(folderField);

    const newFolderToggle = document.createElement('button');
    newFolderToggle.type = 'button';
    newFolderToggle.className = 'co-bk-link';
    const newFolderIcon = document.createElement('span');
    newFolderIcon.className = 'co-bk-link__icon';
    newFolderIcon.setAttribute('aria-hidden', 'true');
    const newFolderText = document.createElement('span');
    newFolderText.textContent = 'New folder';
    newFolderToggle.appendChild(newFolderIcon);
    newFolderToggle.appendChild(newFolderText);
    scroll.appendChild(newFolderToggle);

    const nfBlock = document.createElement('div');
    nfBlock.className = 'co-bk-new-folder';
    const nfInput = document.createElement('input');
    nfInput.type = 'text';
    nfInput.className = 'co-bk-input';
    nfInput.placeholder = 'Folder name';
    nfInput.setAttribute('maxlength', '80');
    const nfRow = document.createElement('div');
    nfRow.className = 'co-bk-actions co-bk-new-folder__actions';
    const nfCancel = document.createElement('button');
    nfCancel.type = 'button';
    nfCancel.className = 'co-bk-btn co-bk-btn--secondary';
    nfCancel.textContent = 'Cancel';
    const nfCreate = document.createElement('button');
    nfCreate.type = 'button';
    nfCreate.className = 'co-bk-btn co-bk-btn--primary';
    nfCreate.textContent = 'Create';
    nfRow.appendChild(nfCancel);
    nfRow.appendChild(nfCreate);
    nfBlock.appendChild(nfInput);
    nfBlock.appendChild(nfRow);
    scroll.appendChild(nfBlock);

    newFolderToggle.addEventListener('click', function () {
        const on = nfBlock.classList.toggle('co-bk-visible');
        if (on) {
            setTimeout(function () {
                nfInput.focus();
            }, 0);
        } else {
            nfInput.value = '';
        }
    });
    nfCancel.addEventListener('click', function () {
        nfBlock.classList.remove('co-bk-visible');
        nfInput.value = '';
    });
    nfCreate.addEventListener('click', function () {
        const name = nfInput.value.trim();
        if (!name) return;
        notifyHost({
            type: 'bookmarkEditorCreateFolder',
            name: name.slice(0, 80),
            draftTitle: nameInput.value,
            draftFolderId: sel.value,
        });
    });

    const actions = document.createElement('div');
    actions.className = 'co-bk-actions co-bk-footer-actions';
    if (mode === 'edit') {
        const rem = document.createElement('button');
        rem.type = 'button';
        rem.className = 'co-bk-btn co-bk-btn--danger';
        rem.textContent = 'Remove';
        rem.addEventListener('click', function () {
            if (bookmarkId) notifyHost({ type: 'bookmarkEditorRemove', bookmarkId: bookmarkId });
        });
        actions.appendChild(rem);
    }
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'co-bk-btn co-bk-btn--primary';
    done.textContent = 'Done';
    done.addEventListener('click', function () {
        notifyHost({
            type: 'bookmarkEditorDone',
            title: nameInput.value,
            folderId: sel.value,
            url: pageUrl,
            bookmarkId: bookmarkId,
        });
    });
    actions.appendChild(done);
    scroll.appendChild(actions);
    DOM.panel.appendChild(scroll);

    nameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); done.click(); }
    });
    nfInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); nfCreate.click(); }
        if (e.key === 'Escape') { e.stopPropagation(); nfCancel.click(); }
    });

    setTimeout(function () {
        nameInput.focus();
        nameInput.select();
    }, 0);

    DOM.backdrop.classList.add('co-visible');
    DOM.panel.classList.add('co-visible');
}