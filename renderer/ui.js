let currentTabId = null;
const tabsContainer = document.getElementById('tab-bar');
const urlInput = document.getElementById('url-input');

let tabsData = {}; // Track title, favicon, loading
let draggingTabId = null; // Active drag source for tab reordering

let hoverTimeout = null;

function hideTabTooltip() {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    window.electronAPI.tooltipHide();
}

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

const STEALTH_ICON_SVG = '<img src="app://localhost/assets/images/tab-stealth.svg" width="15" height="15" alt="" style="vertical-align:middle;margin-right:4px"/>&nbsp;';

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Drop indicators removed in favor of placeholder reordering

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
    const isGoogleHome = initialUrl && initialUrl.startsWith('https://www.google.com/') && !initialUrl.includes('/search');
    tabsData[id].isNewTab = !initialUrl || isGoogleHome;
    tabsData[id].url = initialUrl || 'https://www.google.com/';

    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (isStealth ? ' stealth-tab' : '');
    tabEl.id = id;
    tabEl.draggable = false; // pointer events handle drag instead
    const defaultFavicon = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMThjLTQuNDEgMC04LTMuNTktOC04czMuNTktOCA4LTggOCAzLjU5IDggOC0zLjU5IDgtOCA4eiIvPjwvc3ZnPg==';

    const titlePrefix = isStealth ? STEALTH_ICON_SVG : '';

    tabEl.innerHTML = `
        <div class="icon-container"><img src="${defaultFavicon}" class="tab-icon"></div>
        <div class="tab-title">${titlePrefix}New Tab</div>
        <div class="close-btn">
        <img src="app://localhost/assets/images/tab-close.svg" width="12" height="12" alt="">
        </div>
    `;

    tabEl.querySelector('.close-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(id);
    });

    tabEl.addEventListener('mouseenter', () => {
        if (draggingTabId) return;
        if (hoverTimeout) clearTimeout(hoverTimeout);
        hoverTimeout = setTimeout(async () => {
            const info = await window.electronAPI.getTabInfo(id);
            if (!info || draggingTabId) return;

            const rect = tabEl.getBoundingClientRect();
            // Estimating tooltip size for positioning the overlay view
            const tooltipWidth = 280;
            const tooltipHeight = 140;
            let left = rect.left + rect.width / 2 - tooltipWidth / 2;
            left = Math.max(10, Math.min(window.innerWidth - tooltipWidth - 10, left));
            const top = rect.bottom + 8;

            window.electronAPI.tooltipShow({
                title: info.title || 'New Tab',
                url: info.url,
                memory: info.memory,
                x: left,
                y: top,
                width: tooltipWidth,
                height: tooltipHeight
            });
        }, 500);
    });
    tabEl.addEventListener('mouseleave', hideTabTooltip);

    // ── Pointer-based tab drag with animated ghost ────────────────────────────
    tabEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;                         // left-click only
        if (e.target.closest('.close-btn')) return;        // don't hijack close btn

        switchTab(id);
        hideTabTooltip();

        let dragStarted = false;
        const startX   = e.clientX;
        let   offsetX  = 0;

        let originalTabs = [];
        let originalRects = [];
        let draggingIndex = -1;
        let finalTargetIndex = -1;

        const onMove = (me) => {
            if (!dragStarted) {
                if (Math.abs(me.clientX - startX) < 6) return; // 6px dead-zone
                dragStarted   = true;
                draggingTabId = id;

                originalTabs = Array.from(tabsContainer.querySelectorAll('.tab:not(#add-tab)'));
                originalRects = originalTabs.map(t => t.getBoundingClientRect());
                draggingIndex = originalTabs.indexOf(tabEl);
                finalTargetIndex = draggingIndex;

                const rect = originalRects[draggingIndex];
                offsetX = me.clientX - rect.left;

                tabEl.classList.add('tab-dragging');
            }

            // ── Track dragged tab horizontally within tab bar ──────────────
            const barRect = tabsContainer.getBoundingClientRect();
            const tabW  = originalRects[draggingIndex].width;
            const newX    = Math.max(barRect.left,
                                Math.min(me.clientX - offsetX, barRect.right - tabW));
            const dragDx = newX - originalRects[draggingIndex].left;

            // ── Target Index Calculation (using original rects) ────────────
            let targetIndex = draggingIndex;
            for (let i = 0; i < originalTabs.length; i++) {
                if (i === draggingIndex) continue;
                const center = originalRects[i].left + originalRects[i].width / 2;
                if (i < draggingIndex && me.clientX < center) {
                    targetIndex = i;
                    break;
                }
                if (i > draggingIndex && me.clientX > center) {
                    targetIndex = i;
                }
            }
            finalTargetIndex = targetIndex;

            // ── Dynamic Transfrom Positioning (without moving DOM) ────────
            const draggedWidthWithGap = originalRects[draggingIndex].width + 5; // 5px gap
            
            originalTabs.forEach((t, i) => {
                if (i === draggingIndex) {
                    t.style.transform = `translateX(${dragDx}px)`;
                    t.style.zIndex = '9999';
                    return;
                }

                if (targetIndex < draggingIndex && i >= targetIndex && i < draggingIndex) {
                    t.style.transform = `translateX(${draggedWidthWithGap}px)`;
                } else if (targetIndex > draggingIndex && i > draggingIndex && i <= targetIndex) {
                    t.style.transform = `translateX(-${draggedWidthWithGap}px)`;
                } else {
                    t.style.transform = '';
                }
            });
        };

        const onUp = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup',   onUp);

            if (dragStarted && draggingTabId) {
                // Clear all inline transforms before actual DOM swap
                originalTabs.forEach(t => {
                    t.style.transform = '';
                    t.style.zIndex = '';
                });

                if (finalTargetIndex !== -1 && finalTargetIndex !== draggingIndex) {
                    const referenceNode = originalTabs[finalTargetIndex];
                    if (finalTargetIndex < draggingIndex) {
                        tabsContainer.insertBefore(tabEl, referenceNode);
                    } else {
                        tabsContainer.insertBefore(tabEl, referenceNode.nextSibling);
                    }
                }
                requestSessionSave();
            }

            tabEl.classList.remove('tab-dragging');
            draggingTabId = null;
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup',   onUp);
    });

    tabEl.addEventListener('mousedown', (e) => {
        if (e.button === 1) { e.preventDefault(); closeTab(id); }
    });

    tabsContainer.insertBefore(tabEl, document.getElementById('add-tab'));

    window.electronAPI.newTab(id, isStealth, initialUrl);
    switchTab(id);

    urlInput.value = tabsData[id].isNewTab ? '' : initialUrl;
    if (tabsData[id].isNewTab) {
        setTimeout(() => urlInput.focus(), 50);
    }
    
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
    updateUrlDisplay(isNewTab ? '' : tabUrl);

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
urlInput.addEventListener('focus', () => {
    // Select all text on focus so user can immediately type a new URL
    setTimeout(() => urlInput.select(), 0);
});

// ─── Star / Bookmark button ───────────────────────────────────────────────
document.getElementById('bookmark-btn').onclick = () => {
    if (!currentTabId) return;
    const url = tabsData[currentTabId]?.url || '';
    const title = tabsData[currentTabId]?.title || url;
    const favicon = tabsData[currentTabId]?.favicon || null;
    if (!url || (url.startsWith('https://www.google.com/') && !url.includes('/search'))) return;

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

// ─── URL Display Highlighting ──────────────────────────────────────────
function updateUrlDisplay(url) {
    const displayEl = document.getElementById('url-display');
    if (!displayEl) return;

    if (!url || url.startsWith('app://') || url === 'New Tab') {
        displayEl.innerHTML = '';
        return;
    }

    try {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol + '//';
        let displayUrl = url.replace(protocol, '');
        
        // Remove trailing slash if it's just the domain
        if (displayUrl.endsWith('/') && displayUrl.split('/').length === 2) {
            displayUrl = displayUrl.slice(0, -1);
        }

        const domain = urlObj.hostname;
        const index = displayUrl.indexOf(domain);
        
        if (index !== -1) {
            const prefix = displayUrl.substring(0, index);
            const suffix = displayUrl.substring(index + domain.length);
            displayEl.innerHTML = `${escapeHtml(prefix)}<span class="domain">${escapeHtml(domain)}</span>${escapeHtml(suffix)}`;
        } else {
            displayEl.innerText = displayUrl;
        }
    } catch (e) {
        displayEl.innerText = url;
    }
}

urlInput.addEventListener('blur', () => {
    // Restore original URL if navigation didn't happen (blur without enter)
    if (currentTabId && tabsData[currentTabId]) {
        const actualUrl = tabsData[currentTabId].isNewTab ? '' : tabsData[currentTabId].url;
        urlInput.value = actualUrl;
    }
    updateUrlDisplay(urlInput.value);
    urlInput.setSelectionRange(0, 0);
});

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
        updateUrlDisplay(tabsData[id].isNewTab ? '' : url);
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

window.electronAPI.onBookmarksUpdated(async () => {
    // Refresh the bookmark data/bar and then the star button state
    if (window.bookmarkSystem) {
        await window.bookmarkSystem.initBookmarks();
        if (currentTabId && tabsData[currentTabId]) {
            window.bookmarkSystem.updateStarButton(tabsData[currentTabId].url);
        }
    }
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