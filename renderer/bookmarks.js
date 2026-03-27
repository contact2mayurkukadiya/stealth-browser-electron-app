/**
 * Bookmark Manager for StealthWindow Browser
 * Handles: star toggle, bookmark bar render, inline folder navigation, drag-to-reorder
 */

let bookmarksData = { bar: [] };
let currentFolderId = null; // null = root view, string = inside a folder
let dragSrcId = null;

const STAR_EMPTY = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
</svg>`;

const STAR_FILLED = `<svg width="18" height="18" viewBox="0 0 24 24" fill="#FFB430" stroke="#FFB430" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
</svg>`;

const FOLDER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 640 640"><path fill="white" d="M128 512L512 512C547.3 512 576 483.3 576 448L576 208C576 172.7 547.3 144 512 144L362.7 144C355.8 144 349 141.8 343.5 137.6L305.1 108.8C294 100.5 280.5 96 266.7 96L128 96C92.7 96 64 124.7 64 160L64 448C64 483.3 92.7 512 128 512z"/></svg>`;
const ADD_FOLDER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 640 640"><path fill="white" d="M576 448C576 483.3 547.3 512 512 512L128 512C92.7 512 64 483.3 64 448L64 160C64 124.7 92.7 96 128 96L266.7 96C280.5 96 294 100.5 305.1 108.8L343.5 137.6C349 141.8 355.8 144 362.7 144L512 144C547.3 144 576 172.7 576 208L576 448zM320 224C306.7 224 296 234.7 296 248L296 296L248 296C234.7 296 224 306.7 224 320C224 333.3 234.7 344 248 344L296 344L296 392C296 405.3 306.7 416 320 416C333.3 416 344 405.3 344 392L344 344L392 344C405.3 344 416 333.3 416 320C416 306.7 405.3 296 392 296L344 296L344 248C344 234.7 333.3 224 320 224z"/></svg>`;

const CHEVRON_RIGHT = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"/></svg>`;

const BACK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>`;

// ─── Public API ──────────────────────────────────────────────────────────────

async function initBookmarks() {
    bookmarksData = await window.electronAPI.bookmarksGet();
    renderBar();
    setupGlobalClickDismiss();
}

function updateStarButton(url) {
    const btn = document.getElementById('bookmark-btn');
    if (!btn) return;
    const isBookmarked = findBookmarkByUrl(url, bookmarksData.bar) !== null;
    btn.innerHTML = isBookmarked ? STAR_FILLED : STAR_EMPTY;
    btn.classList.toggle('starred', isBookmarked);
    btn.title = isBookmarked ? 'Remove bookmark' : 'Bookmark this page';
}

async function toggleBookmark(url, title, favicon) {
    if (!url || url === '' || (url.startsWith('https://www.google.com/') && !url.includes('/search'))) return;

    const existing = findBookmarkByUrl(url, bookmarksData.bar);
    if (existing) {
        bookmarksData = await window.electronAPI.bookmarksRemove(existing.id);
    } else {
        const item = {
            id: 'bk-' + Date.now(),
            type: 'bookmark',
            title: title || url,
            url,
            favicon: favicon || null
        };
        bookmarksData = await window.electronAPI.bookmarksAdd(item);
    }
    renderBar();
    updateStarButton(url);
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderBar() {
    const bar = document.getElementById('bookmark-bar');
    if (!bar) return;

    bar.innerHTML = '';

    if (currentFolderId) {
        // ── Folder view: show breadcrumb + folder children ──
        const folder = bookmarksData.bar.find(b => b.id === currentFolderId);
        if (!folder) { currentFolderId = null; renderBar(); return; }

        // Back breadcrumb button
        const back = document.createElement('button');
        back.className = 'bk-breadcrumb';
        back.innerHTML = `${BACK_ICON}<span>${escapeHtml(folder.title)}</span>`;
        back.title = 'Back to bookmarks';
        back.onclick = () => { currentFolderId = null; renderBar(); };

        const delFolderBtn = document.createElement('button');
        delFolderBtn.className = 'bk-breadcrumb-del';
        delFolderBtn.title = 'Delete this folder';
        delFolderBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 640 640"><path fill="white" d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z"/></svg>';
        delFolderBtn.onclick = async () => {
            if (confirm(`Delete folder "${folder.title}" and all its bookmarks?`)) {
                bookmarksData = await window.electronAPI.bookmarksRemove(folder.id);
                currentFolderId = null;
                renderBar();
                const urlInput = document.getElementById('url-input');
                if (urlInput) updateStarButton(urlInput.value);
            }
        };

        const breadcrumbWrap = document.createElement('div');
        breadcrumbWrap.className = 'bk-breadcrumb-wrap';
        breadcrumbWrap.appendChild(back);
        breadcrumbWrap.appendChild(delFolderBtn);

        bar.appendChild(breadcrumbWrap);

        // Divider
        const sep = document.createElement('span');
        sep.className = 'bk-breadcrumb-sep';
        sep.textContent = '/';
        bar.appendChild(sep);

        // Folder children
        if (folder.children.length === 0) {
            const empty = document.createElement('span');
            empty.className = 'bk-empty-hint';
            empty.textContent = 'Empty folder';
            bar.appendChild(empty);
        } else {
            folder.children.forEach(child => {
                bar.appendChild(createBookmarkEl(child, currentFolderId));
            });
        }
    } else {
        // ── Root view: show all top-level items ──
        bookmarksData.bar.forEach(item => {
            if (item.type === 'folder') {
                bar.appendChild(createFolderEl(item));
            } else {
                bar.appendChild(createBookmarkEl(item));
            }
        });

        // Add folder button (only in root)
        const addFolderBtn = document.createElement('button');
        addFolderBtn.className = 'bk-add-folder btn';
        addFolderBtn.title = 'Add folder';
        addFolderBtn.innerHTML = `${ADD_FOLDER_ICON}`;
        addFolderBtn.onclick = promptAddFolder;
        bar.appendChild(addFolderBtn);
    }
}

function createBookmarkEl(item, parentFolderId = null) {
    const el = document.createElement('button');
    el.className = 'bk-item';
    el.id = 'bk-' + item.id;
    el.draggable = !parentFolderId; // only drag at root level
    el.title = item.title;
    el.dataset.id = item.id;

    const faviconHtml = item.favicon
        ? `<img src="${item.favicon}" class="bk-favicon" onerror="this.style.display='none'">`
        : `<span class="bk-favicon-placeholder">🔖</span>`;

    el.innerHTML = `${faviconHtml}<span class="bk-label">${escapeHtml(item.title)}</span><span class="bk-del-btn" title="Delete bookmark"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 640 640"><path fill="white" d="M232.7 69.9L224 96L128 96C110.3 96 96 110.3 96 128C96 145.7 110.3 160 128 160L512 160C529.7 160 544 145.7 544 128C544 110.3 529.7 96 512 96L416 96L407.3 69.9C402.9 56.8 390.7 48 376.9 48L263.1 48C249.3 48 237.1 56.8 232.7 69.9zM512 208L128 208L149.1 531.1C150.7 556.4 171.7 576 197 576L443 576C468.3 576 489.3 556.4 490.9 531.1L512 208z"/></svg></span>`;

    el.onclick = (e) => { e.stopPropagation(); navigateCurrentTab(item.url); };

    // Delete button logic
    const delBtn = el.querySelector('.bk-del-btn');
    if (delBtn) {
        delBtn.onclick = async (e) => {
            e.stopPropagation();
            bookmarksData = await window.electronAPI.bookmarksRemove(item.id);
            renderBar();
            const urlInput = document.getElementById('url-input');
            if (urlInput) updateStarButton(urlInput.value);
        };
    }

    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, item, parentFolderId);
    });

    if (!parentFolderId) {
        setupDragSource(el, item.id);
        setupDropTarget(el, item.id);
    }
    return el;
}

function createFolderEl(item) {
    const el = document.createElement('button');
    el.className = 'bk-folder';
    el.id = 'bk-' + item.id;
    el.draggable = true;
    el.dataset.id = item.id;
    el.title = item.title;

    el.innerHTML = `${FOLDER_ICON}<span class="bk-label">${escapeHtml(item.title)}</span>${CHEVRON_RIGHT}`;

    // Click: navigate into the folder inline
    el.onclick = (e) => {
        e.stopPropagation();
        currentFolderId = item.id;
        renderBar();
    };

    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, item);
    });

    setupDragSource(el, item.id);
    setupDropTarget(el, item.id);
    return el;
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

function showContextMenu(e, item, parentFolderId = null) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'bk-context-menu';
    menu.id = 'bk-context-menu';

    const actions = [];

    if (item.type === 'bookmark') {
        actions.push({ label: 'Open', action: () => navigateCurrentTab(item.url) });
    }

    if (item.type !== 'folder') {
        const folders = bookmarksData.bar.filter(b => b.type === 'folder');
        if (folders.length > 0 && !parentFolderId) {
            folders.forEach(folder => {
                actions.push({
                    label: `Move to "${folder.title}"`,
                    action: async () => {
                        bookmarksData = await window.electronAPI.bookmarksRemove(item.id);
                        bookmarksData = await window.electronAPI.bookmarksAddToFolder(folder.id, item);
                        renderBar();
                    }
                });
            });
        }
    }

    actions.push({
        label: item.type === 'folder' ? 'Delete folder' : 'Remove bookmark',
        action: async () => {
            bookmarksData = await window.electronAPI.bookmarksRemove(item.id);
            if (currentFolderId === item.id) currentFolderId = null;
            renderBar();
            const urlInput = document.getElementById('url-input');
            if (urlInput) updateStarButton(urlInput.value);
        },
        danger: true
    });

    actions.forEach(({ label, action, danger }) => {
        const btn = document.createElement('button');
        btn.className = 'bk-context-item' + (danger ? ' danger' : '');
        btn.textContent = label;
        btn.onclick = (ev) => { ev.stopPropagation(); closeContextMenu(); action(); };
        menu.appendChild(btn);
    });

    // Position — clamp to viewport
    document.body.appendChild(menu);
    const mRect = menu.getBoundingClientRect();
    const x = Math.min(e.clientX, window.innerWidth - mRect.width - 4);
    const y = Math.min(e.clientY, window.innerHeight - mRect.height - 4);
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
}

function closeContextMenu() {
    const el = document.getElementById('bk-context-menu');
    if (el) el.remove();
}

function setupGlobalClickDismiss() {
    document.addEventListener('click', () => closeContextMenu());
}

// ─── Drag-to-Reorder ─────────────────────────────────────────────────────────

function setupDragSource(el, id) {
    el.addEventListener('dragstart', (e) => {
        dragSrcId = id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        setTimeout(() => el.classList.add('dragging'), 0);
    });
    el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        document.querySelectorAll('.bk-drag-over').forEach(e => e.classList.remove('bk-drag-over'));
    });
}

function setupDropTarget(el, id) {
    el.addEventListener('dragover', (e) => {
        if (dragSrcId === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.bk-drag-over').forEach(e => e.classList.remove('bk-drag-over'));
        el.classList.add('bk-drag-over');
    });

    el.addEventListener('dragleave', () => el.classList.remove('bk-drag-over'));

    el.addEventListener('drop', async (e) => {
        e.preventDefault();
        el.classList.remove('bk-drag-over');
        if (!dragSrcId || dragSrcId === id) return;

        const targetItem = bookmarksData.bar.find(b => b.id === id);
        const srcItemIdx = bookmarksData.bar.findIndex(b => b.id === dragSrcId);

        if (targetItem && targetItem.type === 'folder' && srcItemIdx !== -1) {
            const [srcItem] = bookmarksData.bar.splice(srcItemIdx, 1);
            bookmarksData = await window.electronAPI.bookmarksRemove(srcItem.id);
            bookmarksData = await window.electronAPI.bookmarksAddToFolder(id, srcItem);
        } else {
            const newBar = [...bookmarksData.bar];
            const fromIdx = newBar.findIndex(b => b.id === dragSrcId);
            const toIdx = newBar.findIndex(b => b.id === id);
            if (fromIdx === -1 || toIdx === -1) return;
            const [moved] = newBar.splice(fromIdx, 1);
            newBar.splice(toIdx, 0, moved);
            await window.electronAPI.bookmarksReorder(newBar);
            bookmarksData.bar = newBar;
        }

        dragSrcId = null;
        renderBar();
    });
}

// ─── Add Folder Prompt ──────────────────────────────────────────────────────

function promptAddFolder() {
    const bar = document.getElementById('bookmark-bar');
    if (document.getElementById('bk-folder-prompt')) return;

    const prompt = document.createElement('div');
    prompt.className = 'bk-folder-prompt';
    prompt.id = 'bk-folder-prompt';
    prompt.innerHTML = `
        <input type="text" id="bk-folder-name" placeholder="Folder name" maxlength="40">
        <button id="bk-folder-ok">OK</button>
        <button id="bk-folder-cancel">Cancel</button>
    `;
    bar.insertBefore(prompt, bar.lastChild);

    const input = prompt.querySelector('#bk-folder-name');
    input.focus();

    const create = async () => {
        const name = input.value.trim();
        if (name) {
            bookmarksData = await window.electronAPI.bookmarksAddFolder(name);
            renderBar();
        } else {
            prompt.remove();
        }
    };

    prompt.querySelector('#bk-folder-ok').onclick = create;
    prompt.querySelector('#bk-folder-cancel').onclick = () => prompt.remove();
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') create();
        if (e.key === 'Escape') prompt.remove();
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    prompt.addEventListener('click', (e) => e.stopPropagation());
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findBookmarkByUrl(url, list) {
    if (!url) return null;
    for (const item of list) {
        if (item.type === 'bookmark' && item.url === url) return item;
        if (item.type === 'folder' && item.children) {
            const found = findBookmarkByUrl(url, item.children);
            if (found) return found;
        }
    }
    return null;
}

function navigateCurrentTab(url) {
    if (window.__navigateCurrentTab) window.__navigateCurrentTab(url);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

window.bookmarkSystem = { initBookmarks, updateStarButton, toggleBookmark };
