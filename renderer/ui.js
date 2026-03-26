let currentTabId = null;
const tabsContainer = document.getElementById('tab-bar');
const urlInput = document.getElementById('url-input');

let tabsData = {}; // Track title, favicon, loading

let sessionSaveTimeout = null;
function requestSessionSave() {
    clearTimeout(sessionSaveTimeout);
    sessionSaveTimeout = setTimeout(() => {
        const tabs = Array.from(tabsContainer.querySelectorAll('.tab'))
            .filter(t => !t.classList.contains('stealth-tab') && t.id !== 'add-tab')
            .map(t => ({ id: t.id, url: tabsData[t.id]?.url || 'https://www.google.com/' }));
        
        if (tabs.length > 0 && window.electronAPI.sessionSave) {
            // Exclude stealth tabs from session completely
            let active = currentTabId;
            const activeEl = document.getElementById(active);
            if (activeEl && activeEl.classList.contains('stealth-tab')) {
                active = tabs[tabs.length - 1]?.id || null;
            }
            window.electronAPI.sessionSave({ tabs, activeTabId: active });
        }
    }, 700);
}

const STEALTH_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="15" height="15"><path fill="white" d="M320 128C96 128 32 224 32 336C32 448 112 512 208 512L216.4 512C240.6 512 262.8 498.3 273.6 476.6L296.8 430.3C301.2 421.5 310.1 416 320 416C329.9 416 338.8 421.5 343.2 430.3L366.4 476.6C377.2 498.3 399.4 512 423.6 512L432 512C528 512 608 448 608 336C608 224 544 128 320 128zM128 320C128 284.7 156.7 256 192 256C227.3 256 256 284.7 256 320C256 355.3 227.3 384 192 384C156.7 384 128 355.3 128 320zM448 256C483.3 256 512 284.7 512 320C512 355.3 483.3 384 448 384C412.7 384 384 355.3 384 320C384 284.7 412.7 256 448 256z"/></svg>&nbsp;';

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Expose navigation hook for bookmarks.js ──────────────────────────────
window.__navigateCurrentTab = (url) => {
    if (currentTabId) window.electronAPI.navigate(currentTabId, url);
};

// ─── Tab update listener ──────────────────────────────────────────────────
window.electronAPI.onTabUpdate((data) => {
    const { id, title, favicon, isLoading, url } = data;
    const tabEl = document.getElementById(id);
    if (!tabEl) return;

    if (!tabsData[id]) tabsData[id] = { isNewTab: true };
    if (url) tabsData[id].url = url;
    if (favicon) tabsData[id].favicon = favicon;

    if (title) {
        const currentUrl = url || (tabsData[id] && tabsData[id].url) || '';
        const isGoogleHome = currentUrl.startsWith('https://www.google.com/') && !currentUrl.includes('/search');
        if (tabsData[id].isNewTab && isGoogleHome) {
            tabsData[id].title = "New Tab";
        } else {
            tabsData[id].title = title;
        }
    }

    if (tabsData[id].title) {
        const titleHtml = escapeHtml(tabsData[id].title);
        tabEl.querySelector('.tab-title').innerHTML = (tabEl.classList.contains('stealth-tab') ? STEALTH_ICON_SVG : '') + titleHtml;
    }

    const iconContainer = tabEl.querySelector('.icon-container');
    if (isLoading) {
        iconContainer.innerHTML = '<div class="spinner"></div>';
    } else {
        let iconUrl = favicon;
        const currentUrl = url || (tabsData[id] && tabsData[id].url);

        if (!iconUrl && currentUrl && currentUrl.includes('google.com')) {
            iconUrl = 'https://www.google.com/favicon.ico';
        }

        if (iconUrl) {
            iconContainer.innerHTML = `<img src="${iconUrl}" class="tab-icon">`;
        } else {
            const defaultFavicon = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMThjLTQuNDEgMC04LTMuNTktOC04czMuNTktOCA4LTggOCAzLjU5IDggOC0zLjU5IDgtOCA4eiIvPjwvc3ZnPg==';
            iconContainer.innerHTML = `<img src="${defaultFavicon}" class="tab-icon">`;
        }
    }
});

// ─── Tab management ───────────────────────────────────────────────────────
function createTab(isStealth = false) {
    const id = 'tab-' + Date.now();
    createTabUI(id, isStealth);
}

function createTabUI(id, isStealth = false, initialUrl = null) {
    if (!tabsData[id]) tabsData[id] = {};
    tabsData[id].isNewTab = !initialUrl || initialUrl === 'https://www.google.com/';
    tabsData[id].url = initialUrl || 'https://www.google.com/';

    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (isStealth ? ' stealth-tab' : '');
    tabEl.id = id;
    tabEl.draggable = true;
    const defaultFavicon = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMThjLTQuNDEgMC04LTMuNTktOC04czMuNTktOCA4LTggOCAzLjU5IDggOC0zLjU5IDgtOCA4eiIvPjwvc3ZnPg==';

    const titlePrefix = isStealth ? STEALTH_ICON_SVG : '';

    tabEl.innerHTML = `
        <div class="icon-container"><img src="${defaultFavicon}" class="tab-icon"></div>
        <div class="tab-title" style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none;">${titlePrefix}New Tab</div>
        <div class="close-btn" onclick="event.stopPropagation(); closeTab('${id}')">
        <svg width=20 height=20 viewBox="0 0 640 640"><path fill="white" d="M183.1 137.4C170.6 124.9 150.3 124.9 137.8 137.4C125.3 149.9 125.3 170.2 137.8 182.7L275.2 320L137.9 457.4C125.4 469.9 125.4 490.2 137.9 502.7C150.4 515.2 170.7 515.2 183.2 502.7L320.5 365.3L457.9 502.6C470.4 515.1 490.7 515.1 503.2 502.6C515.7 490.1 515.7 469.8 503.2 457.3L365.8 320L503.1 182.6C515.6 170.1 515.6 149.8 503.1 137.3C490.6 124.8 470.3 124.8 457.8 137.3L320.5 274.7L183.1 137.4z"/></svg>
        </div>
    `;

    // --- Drag and Drop for tabs ---
    tabEl.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', id);
        tabEl.style.opacity = '0.4';
    });
    tabEl.addEventListener('dragend', () => tabEl.style.opacity = '1');
    tabEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        const draggingId = e.dataTransfer.getData('text/plain');
        if (draggingId !== id) {
            const children = Array.from(tabsContainer.children);
            const draggedIndex = children.indexOf(document.getElementById(draggingId));
            const targetIndex = children.indexOf(tabEl);
            if (draggedIndex < targetIndex) {
                tabsContainer.insertBefore(document.getElementById(draggingId), tabEl.nextSibling);
            } else {
                tabsContainer.insertBefore(document.getElementById(draggingId), tabEl);
            }
            requestSessionSave();
        }
    });

    tabEl.onclick = () => switchTab(id);
    tabEl.addEventListener('mousedown', (e) => {
        if (e.button === 1) { e.preventDefault(); closeTab(id); }
    });

    tabsContainer.insertBefore(tabEl, document.getElementById('add-tab'));

    window.electronAPI.newTab(id, isStealth, initialUrl);
    switchTab(id);

    urlInput.value = tabsData[id].isNewTab ? '' : initialUrl;
    if (tabsData[id].isNewTab) urlInput.focus();
    
    requestSessionSave();
}

function switchTab(id) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    currentTabId = id;

    const tabUrl = tabsData[id]?.url || '';
    const isNewTab = tabsData[id]?.isNewTab;
    
    if (isNewTab) {
        urlInput.value = '';
    } else {
        urlInput.value = tabUrl;
    }

    window.electronAPI.switchTab(id);

    // Update star for the switched tab
    if (window.bookmarkSystem) {
        window.bookmarkSystem.updateStarButton(isNewTab ? '' : tabUrl);
    }

    requestSessionSave();
}

function closeTab(id) {
    const tabEl = document.getElementById(id);
    if (!tabEl) return;

    const isActive = tabEl.classList.contains('active');
    let nextTabToFocus = null;
    if (isActive) {
        nextTabToFocus = tabEl.nextElementSibling;
        if (!nextTabToFocus || nextTabToFocus.id === 'add-tab') {
            nextTabToFocus = tabEl.previousElementSibling;
        }
    }

    tabEl.remove();
    delete tabsData[id];
    window.electronAPI.closeTab(id);

    if (isActive) {
        if (nextTabToFocus && nextTabToFocus.id !== 'add-tab') {
            switchTab(nextTabToFocus.id);
        } else {
            currentTabId = null;
            createTab();
        }
    }
    
    requestSessionSave();
}

// ─── Nav controls ─────────────────────────────────────────────────────────
document.getElementById('add-tab').onclick = () => createTab();
document.getElementById('back-btn').onclick = () => window.electronAPI.goBack(currentTabId);
document.getElementById('forward-btn').onclick = () => window.electronAPI.goForward(currentTabId);
document.getElementById('reload-btn').onclick = () => window.electronAPI.reload(currentTabId);

urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        if (tabsData[currentTabId]) tabsData[currentTabId].isNewTab = false;
        window.electronAPI.navigate(currentTabId, urlInput.value);
    }
});
urlInput.addEventListener('focus', () => urlInput.select());
urlInput.addEventListener('click', () => urlInput.select());

// ─── Star / Bookmark button ───────────────────────────────────────────────
document.getElementById('bookmark-btn').onclick = () => {
    if (!currentTabId) return;
    const url = tabsData[currentTabId]?.url || '';
    const title = tabsData[currentTabId]?.title || url;
    const favicon = tabsData[currentTabId]?.favicon || null;
    if (!url || url === 'https://www.google.com/') return;

    // Pop animation
    const btn = document.getElementById('bookmark-btn');
    btn.classList.remove('pop');
    void btn.offsetWidth; // reflow to restart animation
    btn.classList.add('pop');
    btn.addEventListener('animationend', () => btn.classList.remove('pop'), { once: true });

    if (window.bookmarkSystem) {
        window.bookmarkSystem.toggleBookmark(url, title, favicon);
    }
};

// ─── URL change listener ──────────────────────────────────────────────────
window.electronAPI.onUrlChanged(({ id, url }) => {
    if (!tabsData[id]) tabsData[id] = { isNewTab: true };
    tabsData[id].url = url;

    // A fresh New Tab loads Google. As long as it's on Google's homepage, treat it as empty.
    const isGoogleHome = url.startsWith('https://www.google.com/') && !url.includes('/search');

    if (!isGoogleHome) {
        tabsData[id].isNewTab = false;
    }

    if (id === currentTabId) {
        urlInput.value = tabsData[id].isNewTab ? '' : url;
        // Update star state for the new URL
        if (window.bookmarkSystem) {
            window.bookmarkSystem.updateStarButton(tabsData[id].isNewTab ? '' : url);
        }
    }

    requestSessionSave();
});

// ─── Keyboard shortcuts ───────────────────────────────────────────────────
window.electronAPI.onShortcutNewTab(() => createTab(false));
window.electronAPI.onShortcutNewStealthTab(() => createTab(true));
window.electronAPI.onShortcutHistory(() => {
    // Open history page in a new tab
    const id = 'tab-' + Date.now();
    createTabUI(id, false);
    setTimeout(() => {
        window.electronAPI.navigate(id, 'stealth://History');
    }, 50);
});

window.electronAPI.onShortcutCloseTab(() => { if (currentTabId) closeTab(currentTabId); });
window.electronAPI.onShortcutReload(() => { if (currentTabId) window.electronAPI.reload(currentTabId); });
window.electronAPI.onShortcutSwitchTab(({ direction }) => {
    const tabs = Array.from(tabsContainer.querySelectorAll('.tab'));
    if (tabs.length <= 1) return;
    const currentIndex = tabs.findIndex(t => t.id === currentTabId);
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    switchTab(tabs[nextIndex].id);
});

// ─── Init ─────────────────────────────────────────────────────────────────
async function initSessionAndTabs() {
    let session = null;
    if (window.electronAPI.sessionLoad) {
        session = await window.electronAPI.sessionLoad();
    }

    if (session && session.tabs && session.tabs.length > 0) {
        for (const t of session.tabs) {
            createTabUI(t.id, false, t.url);
        }
        if (session.activeTabId && document.getElementById(session.activeTabId)) {
            switchTab(session.activeTabId);
        } else {
            switchTab(session.tabs[session.tabs.length - 1].id);
        }
    } else {
        createTab(); // fallback
    }
}

if (window.bookmarkSystem) {
    window.bookmarkSystem.initBookmarks().then(initSessionAndTabs);
} else {
    initSessionAndTabs();
}