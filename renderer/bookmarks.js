const { BOOKMARK, KEYBOARD } = require('../src/constants/conditionStrings.cjs');
/**
 * Bookmark Manager for InviSurf
 * Handles: star toggle, bookmark bar render, overlay folder navigation, drag-to-reorder
 */

let bookmarksData = { bar: [] };
let dragSrcId = null;

const STAR_EMPTY = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
</svg>`;

const STAR_FILLED = '<img src="app://localhost/assets/images/bookmark-star-filled.svg" width="18" height="18" alt="">';

const FOLDER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 640 640"><path fill="currentColor" opacity="0.7" d="M128 512L512 512C547.3 512 576 483.3 576 448L576 208C576 172.7 547.3 144 512 144L362.7 144C355.8 144 349 141.8 343.5 137.6L305.1 108.8C294 100.5 280.5 96 266.7 96L128 96C92.7 96 64 124.7 64 160L64 448C64 483.3 92.7 512 128 512z"/></svg>`;
const ADD_FOLDER_ICON = '<img src="app://localhost/assets/images/add-folder.svg" width="30" height="30" alt="">';

const CHEVRON_RIGHT = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"/></svg>`;
const DELETE_ICON = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

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
}

async function toggleBookmark(url, title, favicon) {
    if (!url || url === '' || (url.startsWith('https://www.google.com/') && !url.includes('/search'))) return;

    const existing = findBookmarkByUrl(url, bookmarksData.bar);
    const btn = document.getElementById('bookmark-btn');
    const rect = btn.getBoundingClientRect();

    // Show the "Edit Bookmark" overlay same as Chrome
    window.electronAPI.bookmarkPopupShow({
        type: 'edit',
        data: existing || { title: title || url, url, favicon, folderId: 'root' },
        x: rect.right - 350, // Popup width is 350
        y: rect.bottom + 10,
        width: 350,
        height: 250
    });
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderBar() {
    const bar = document.getElementById('bookmark-bar');
    if (!bar) return;

    bar.innerHTML = '';

    // ── Root view: show all top-level items ──
    bookmarksData.bar.forEach(item => {
        if (item.type === C.BOOKMARK.TYPE_FOLDER) {
            bar.appendChild(createFolderEl(item));
        } else {
            bar.appendChild(createBookmarkEl(item));
        }
    });

    // Add folder button
    const addFolderBtn = document.createElement('button');
    addFolderBtn.className = 'bk-add-folder btn';
    addFolderBtn.title = 'Add folder';
    addFolderBtn.innerHTML = `${ADD_FOLDER_ICON}`;
    addFolderBtn.onclick = promptAddFolder;
    bar.appendChild(addFolderBtn);
}

function createBookmarkEl(item) {
    const wrap = document.createElement('div');
    wrap.className = 'bk-item-wrap';
    wrap.dataset.id = item.id;

    const el = document.createElement('button');
    el.className = 'bk-item';
    el.id = 'bk-' + item.id;
    el.draggable = true;
    el.title = item.title;

    const faviconHtml = item.favicon
        ? `<img src="${item.favicon}" class="bk-favicon" onerror="this.style.display='none'">`
        : `<span class="bk-favicon-placeholder">🔖</span>`;

    el.innerHTML = `${faviconHtml}<span class="bk-label">${escapeHtml(item.title)}</span>`;

    el.onclick = (e) => {
        e.stopPropagation();
        navigateCurrentTab(item.url);
        window.electronAPI.bookmarkPopupHide();
    };

    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, item);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'bk-del-btn';
    delBtn.title = 'Remove bookmark';
    delBtn.innerHTML = DELETE_ICON;
    delBtn.onclick = (e) => {
        e.stopPropagation();
        window.electronAPI.bookmarksRemove(item.id);
    };

    wrap.appendChild(el);
    wrap.appendChild(delBtn);

    setupDragSource(el, item.id);
    setupDropTarget(el, item.id);
    return wrap;
}

function createFolderEl(item) {
    const wrap = document.createElement('div');
    wrap.className = 'bk-item-wrap';
    wrap.dataset.id = item.id;

    const el = document.createElement('button');
    el.className = 'bk-folder';
    el.id = 'bk-' + item.id;
    el.draggable = true;
    el.title = item.title;

    el.innerHTML = `${FOLDER_ICON}<span class="bk-label">${escapeHtml(item.title)}</span>${CHEVRON_RIGHT}`;

    // Click: Show popup overlay for folder contents
    el.onclick = (e) => {
        e.stopPropagation();
        const rect = el.getBoundingClientRect();
        window.electronAPI.bookmarkPopupShow({
            type: 'folder',
            data: item,
            x: rect.left,
            y: rect.bottom + 8,
            width: 280,
            height: 400
        });
    };

    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, item);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'bk-del-btn';
    delBtn.title = 'Delete folder';
    delBtn.innerHTML = DELETE_ICON;
    delBtn.onclick = (e) => {
        e.stopPropagation();
        window.electronAPI.bookmarksRemove(item.id);
    };

    wrap.appendChild(el);
    wrap.appendChild(delBtn);

    setupDragSource(el, item.id);
    setupDropTarget(el, item.id);
    return wrap;
}

// ─── Drag-to-Reorder ─────────────────────────────────────────────────────────

function setupDragSource(el, id) {
    el.addEventListener('dragstart', (e) => {
        dragSrcId = id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        setTimeout(() => el.classList.add('dragging'), 0);
        window.electronAPI.bookmarkPopupHide();
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

        if (targetItem && targetItem.type === C.BOOKMARK.TYPE_FOLDER && srcItemIdx !== -1) {
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

// ─── Context Menu ─────────────────────────────────────────────────────────────

function showContextMenu(e, item) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'bk-context-menu';
    menu.id = 'bk-context-menu';

    const actions = [];
    if (item.type === C.BOOKMARK.TYPE_BOOKMARK) {
        actions.push({ label: 'Open', action: () => navigateCurrentTab(item.url) });
    }

    actions.push({
        label: item.type === C.BOOKMARK.TYPE_FOLDER ? 'Delete folder' : 'Remove bookmark',
        action: async () => {
            bookmarksData = await window.electronAPI.bookmarksRemove(item.id);
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
    document.addEventListener('mousedown', (e) => {
        closeContextMenu();
        // Hide native popup if clicking outside relevant parts
        if (!e.target.closest('.bk-folder') && !e.target.closest('#bookmark-btn')) {
            window.electronAPI.bookmarkPopupHide();
        }
    });

}
// ─── Add Folder Prompt (Simplified for Root) ───────────────────────────────

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
        if (e.key === C.KEYBOARD.ENTER) create();
        if (e.key === C.KEYBOARD.ESCAPE) prompt.remove();
    });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findBookmarkByUrl(url, list) {
    if (!url) return null;
    const norm = (u) => u.toLowerCase().replace(/\/$/, '');
    const target = norm(url);

    for (const item of list) {
        if (item.type === C.BOOKMARK.TYPE_BOOKMARK && norm(item.url || '') === target) return item;
        if (item.type === C.BOOKMARK.TYPE_FOLDER && item.children) {
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
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.bookmarkSystem = { initBookmarks, updateStarButton, toggleBookmark };
