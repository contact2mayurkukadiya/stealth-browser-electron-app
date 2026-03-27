const { app, BrowserWindow, WebContentsView, ipcMain, Menu, MenuItem, dialog, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const encryption = require('./encryption');

process.on('uncaughtException', (error) => {
    dialog.showErrorBox('Fatal Application Error', error.stack || error.message || String(error));
    app.quit();
});

let mainWindow;
let isHTMLFullscreen = false;
let tabs = {}; // Store views by ID
let activeTabId = null; // Track currently visible tab
const UI_HEIGHT = 122; // Height of our tabs + nav bar + bookmark bar

try {
    require("electron-reloader")(module, {
        debug: true,
        watchRenderer: true // ensures changes in renderer trigger reloads
    });
} catch (err) {
    console.error("Hot reload error:", err);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200, height: 800,
        titleBarStyle: 'hidden', // Custom title bar
        trafficLightPosition: { x: 15, y: 15 }, // Fix for Mac close/min/max
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    // Security constraints for main window
    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'fullscreen') return callback(true);
        callback(false); // Deny all other permissions safely
    });

    mainWindow.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' }; // Block popups
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
        // Only allow staying on the app:// UI page
        if (!url.startsWith('app://')) {
            event.preventDefault();
        }
    });

    mainWindow.webContents.on('will-attach-webview', (event) => {
        event.preventDefault(); // Prevent unexpected webview attachments
    });

    // mainWindow.webContents.openDevTools();


    // --- STEALTH MODE ---
    mainWindow.setContentProtection(true);

    mainWindow.loadURL('app://index.html');

    // Custom Application Menu for Robust Shortcuts
    const menu = Menu.buildFromTemplate([
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Tab',
                    accelerator: 'CmdOrCtrl+T',
                    click: () => mainWindow.webContents.send('shortcut-new-tab')
                },
                {
                    label: 'New Stealth Tab',
                    accelerator: 'CmdOrCtrl+Shift+T',
                    click: () => mainWindow.webContents.send('shortcut-new-stealth-tab')
                },
                {
                    label: 'History',
                    accelerator: 'CmdOrCtrl+Y',
                    click: () => mainWindow.webContents.send('shortcut-history')
                },
                {
                    label: 'Close Tab',
                    accelerator: 'CmdOrCtrl+W',
                    click: () => mainWindow.webContents.send('shortcut-close-tab')
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => mainWindow.webContents.send('shortcut-reload')
                },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        }
    ]);
    Menu.setApplicationMenu(menu);

    // Global Shortcut Interception (for Ctrl+Tab, which is not easy in menu)
    mainWindow.webContents.on('before-input-event', handleShortcuts);

    // Single resize listener for all tabs
    mainWindow.on('resize', () => {
        const { width, height } = mainWindow.getContentBounds();
        Object.values(tabs).forEach(view => {
            if (isHTMLFullscreen) {
                view.setBounds({ x: 0, y: 0, width, height });
            } else {
                view.setBounds({ x: 0, y: UI_HEIGHT, width, height: height - UI_HEIGHT });
            }
        });
    });

    createTooltipOverlay();
    createBookmarkOverlay();
}

let tooltipView;
function createTooltipOverlay() {
    tooltipView = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        }
    });

    tooltipView.setBackgroundColor('#00000000'); // Transparent background
    tooltipView.webContents.loadURL('app://renderer/tooltip.html');

    // Add it last so it's on top of all other views
    mainWindow.contentView.addChildView(tooltipView);
    tooltipView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); // Hide initially
}

let bookmarkView;
function createBookmarkOverlay() {
    bookmarkView = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        }
    });

    bookmarkView.setBackgroundColor('#00000000'); // Transparent background
    bookmarkView.webContents.loadURL('app://renderer/bookmark-popup.html');
    
    // Bookmark overlays should be above everything else
    mainWindow.contentView.addChildView(bookmarkView);
    bookmarkView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
}

ipcMain.on('bookmark-popup:show', (e, { type, data, x, y, width, height }) => {
    if (!isSenderTrusted(e)) return;
    if (!bookmarkView) return;

    mainWindow.contentView.addChildView(bookmarkView); // Move to top
    bookmarkView.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
    bookmarkView.webContents.send('bookmark-popup:update', { type, data });
});

ipcMain.on('bookmark-popup:hide', (e) => {
    if (!isSenderTrusted(e)) return;
    if (bookmarkView) {
        bookmarkView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
});

ipcMain.on('tooltip:show', (e, { title, url, memory, x, y, width, height }) => {
    if (!isSenderTrusted(e)) return;
    if (!tooltipView) return;

    // Re-assert it as the top-most view to solve z-order issues after tab switches
    mainWindow.contentView.addChildView(tooltipView);

    // Position and size the overlay view
    tooltipView.setBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
    });
    tooltipView.webContents.send('tooltip:update', { title, url, memory });
});

ipcMain.on('tooltip:hide', (e) => {
    if (!isSenderTrusted(e)) return;
    if (tooltipView) {
        tooltipView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
});

// Helper to handle keyboard shortcuts across different WebContents
function handleShortcuts(event, input) {
    if (input.type !== 'keyDown') return;

    const key = input.key.toLowerCase();

    // Only handle Ctrl+Tab here, as others are handled by the Menu
    if (input.control && input.key === 'Tab') {
        event.preventDefault();
        mainWindow.webContents.send('shortcut-switch-tab', { direction: input.shift ? -1 : 1 });
    }
}

// Logic to create a new Tab View
function createTab(id, url = "https://www.google.com", isStealth = false) {
    const view = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            partition: isStealth ? 'in-memory:stealth-' + id : undefined // incognito session for true stealth tabs
        }
    });

    tabs[id] = view;
    mainWindow.contentView.addChildView(view);

    // Initial bounds set
    const { width, height } = mainWindow.getContentBounds();
    view.setBounds({ x: 0, y: isHTMLFullscreen ? 0 : UI_HEIGHT, width, height: isHTMLFullscreen ? height : height - UI_HEIGHT });

    view.webContents.focus(); // Focus the view immediately

    // ─── Security guards for tab content (Rules 13, 14) ────
    // Block all popup windows opened by web content
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Block navigations to non-http(s) URLs (prevents file:// exfiltration)
    view.webContents.on('will-navigate', (event, targetUrl) => {
        const allowed = targetUrl.startsWith('https://') ||
            targetUrl.startsWith('http://') ||
            targetUrl.startsWith('app://');
        if (!allowed) {
            console.warn(`[Security] Blocked navigation to: ${targetUrl}`);
            event.preventDefault();
        }
    });

    // Fullscreen handling
    view.webContents.on('enter-html-full-screen', () => {
        isHTMLFullscreen = true;
        mainWindow.setFullScreen(true);
        const { width, height } = mainWindow.getContentBounds();
        view.setBounds({ x: 0, y: 0, width, height });
    });

    view.webContents.on('leave-html-full-screen', () => {
        isHTMLFullscreen = false;
        mainWindow.setFullScreen(false);
        const { width, height } = mainWindow.getContentBounds();
        view.setBounds({ x: 0, y: UI_HEIGHT, width, height: height - UI_HEIGHT });
    });

    // --- SYNCING METADATA TO UI ---
    view.webContents.on('context-menu', (event, params) => {
        const menu = Menu.buildFromTemplate([
            {
                label: 'Inspect Element',
                click: () => {
                    view.webContents.inspectElement(params.x, params.y);
                }
            }
        ]);
        menu.popup();
    });

    view.webContents.on('before-input-event', handleShortcuts);

    const getDisplayUrl = (rawUrl) => {
        if (!rawUrl) return '';
        if (rawUrl.startsWith('app://') && rawUrl.includes('history')) return 'stealth://history';
        return rawUrl;
    };

    view.webContents.on('page-title-updated', (e, title) => {
        mainWindow.webContents.send('tab-update', { id, title, url: getDisplayUrl(view.webContents.getURL()) });
    });

    view.webContents.on('page-favicon-updated', (e, favicons) => {
        mainWindow.webContents.send('tab-update', { id, favicon: favicons[0] || null, url: getDisplayUrl(view.webContents.getURL()) });
    });

    view.webContents.on('did-start-loading', () => {
        mainWindow.webContents.send('tab-update', { id, isLoading: true, url: getDisplayUrl(view.webContents.getURL()) });
    });

    view.webContents.on('did-stop-loading', () => {
        mainWindow.webContents.send('tab-update', { id, isLoading: false, url: getDisplayUrl(view.webContents.getURL()) });
    });

    // Use these flags to temporarily hold the title until page load completes or URL changes
    view.webContents.on('did-navigate', (event, targetUrl) => {
        let displayUrl = getDisplayUrl(targetUrl);
        mainWindow.webContents.send('url-changed', { id, url: displayUrl });
        if (!isStealth && !targetUrl.startsWith('data:') && !targetUrl.includes('/renderer/history.html')) {
            appendHistory(displayUrl, view.webContents.getTitle() || displayUrl);
        }
    });

    view.webContents.on('did-navigate-in-page', (event, targetUrl) => {
        let displayUrl = getDisplayUrl(targetUrl);
        mainWindow.webContents.send('url-changed', { id, url: displayUrl });
        if (!isStealth && !targetUrl.startsWith('data:') && !targetUrl.includes('/renderer/history.html')) {
            appendHistory(displayUrl, view.webContents.getTitle() || displayUrl);
        }
    });

    view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        // -3 is ERR_ABORTED (user stopped loading), ignore
        if (errorCode === -3) return;

        console.log(`Navigation failed: ${validatedURL} (${errorCode}: ${errorDescription})`);

        // If it's a DNS resolution error (likely just typed a search term), fallback to Google
        if (errorCode === -105) { // ERR_NAME_NOT_RESOLVED
            const searchQuery = validatedURL.replace(/^https?:\/\//, '').replace(/\/$/, '');
            const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
            setImmediate(() => {
                if (!view.webContents.isDestroyed()) {
                    view.webContents.loadURL(googleSearchUrl);
                }
            });
            return;
        }

        // For other errors (SSL, Connection Refused, etc.), show an error page
        const errorHtml = `
            <!DOCTYPE html>
            <html style="background: #253035; color: white; font-family: sans-serif; height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0;">
                <div style="text-align: center; max-width: 500px; padding: 20px;">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 20px;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <h1 style="margin: 0 0 10px 0; font-size: 24px;">This site can't be reached</h1>
                    <p style="color: #aaa; margin: 0 0 20px 0;">The connection to <strong>${validatedURL}</strong> failed.</p>
                    <div style="background: #1e2c32; padding: 15px; border-radius: 8px; font-family: monospace; color: #ff6b6b; font-size: 14px;">
                        Error: ${errorDescription} (${errorCode})
                    </div>
                </div>
            </html>
        `;

        setImmediate(() => {
            if (!view.webContents.isDestroyed()) {
                view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
            }
        });
    });

    view.webContents.loadURL(url);
}

// ─── HISTORY STORAGE ───────────────────────────────────────────────────────────
let historyPath;

function getHistoryPath() {
    if (!historyPath) {
        historyPath = path.join(app.getPath('userData'), 'history.ndjson');
    }
    return historyPath;
}

// ─── SESSION STORAGE ───────────────────────────────────────────────────────────
let sessionPath;

function getSessionPath() {
    if (!sessionPath) {
        sessionPath = path.join(app.getPath('userData'), 'session.json');
    }
    return sessionPath;
}

ipcMain.handle('session:load', (e) => {
    if (!isSenderTrusted(e)) return null;
    try {
        const p = getSessionPath();
        if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.encrypted !== undefined) {
                const dec = encryption.decrypt(parsed);
                return dec ? JSON.parse(dec) : null;
            } else {
                return parsed; // Fallback to legacy plaintext
            }
        }
    } catch (e) {
        console.error('Failed to load session:', e);
    }
    return null;
});

ipcMain.handle('session:save', (e, data) => {
    if (!isSenderTrusted(e)) return false;
    try {
        const payload = encryption.encrypt(JSON.stringify(data));
        fs.writeFileSync(getSessionPath(), JSON.stringify(payload, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save session:', e);
    }
    return true;
});

function appendHistory(url, title) {
    if (!url || url.startsWith('stealth://')) return;

    // Ignore Google's homepage and its query parameter variants (but keep /search queries)
    if (url.startsWith('https://www.google.com/') && !url.includes('/search')) return;

    const dataObj = JSON.stringify({ url, title, timestamp: Date.now() });
    const payload = encryption.encrypt(dataObj);
    const entry = JSON.stringify(payload) + '\n';
    fs.appendFile(getHistoryPath(), entry, (err) => {
        if (err) console.error('Failed to append history:', err);
    });
}

ipcMain.handle('history:get', async (e) => {
    if (!isSenderTrusted(e)) return [];
    try {
        const p = getHistoryPath();
        if (!fs.existsSync(p)) return [];
        const content = fs.readFileSync(p, 'utf-8');
        const lines = content.trim().split('\n');
        return lines.filter(Boolean).map(l => {
            try {
                const parsed = JSON.parse(l);
                if (parsed && parsed.encrypted !== undefined) {
                    const dec = encryption.decrypt(parsed);
                    return dec ? JSON.parse(dec) : null;
                }
                return parsed; // Fallback to legacy plaintext
            } catch (err) {
                return null;
            }
        }).filter(Boolean).reverse(); // latest first
    } catch (e) {
        console.error('Failed to load history:', e);
        return [];
    }
});

ipcMain.handle('history:clear', async (e) => {
    if (!isSenderTrusted(e)) return false;
    try {
        fs.writeFileSync(getHistoryPath(), '', 'utf-8');
        return true;
    } catch (e) {
        console.error('Failed to clear history:', e);
        return false;
    }
});

// ─── BOOKMARK STORAGE ────────────────────────────────────────────────────────
let bookmarksPath;

function getBookmarksPath() {
    if (!bookmarksPath) {
        bookmarksPath = path.join(app.getPath('userData'), 'bookmarks.json');
    }
    return bookmarksPath;
}

function loadBookmarks() {
    try {
        const p = getBookmarksPath();
        if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.encrypted !== undefined) {
                const dec = encryption.decrypt(parsed);
                return dec ? JSON.parse(dec) : { bar: [] };
            }
            return parsed; // Fallback to legacy plaintext
        }
    } catch (e) {
        console.error('Failed to load bookmarks:', e);
    }
    return { bar: [] };
}

function saveBookmarks(data) {
    try {
        const payload = encryption.encrypt(JSON.stringify(data));
        fs.writeFileSync(getBookmarksPath(), JSON.stringify(payload, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save bookmarks:', e);
    }
}

function broadcastBookmarks() {
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('bookmarks:updated');
    }
    if (bookmarkView && !bookmarkView.webContents.isDestroyed()) {
        bookmarkView.webContents.send('bookmarks:updated');
    }
}

ipcMain.handle('bookmarks:get', (e) => {
    if (!isSenderTrusted(e)) return { bar: [] };
    return loadBookmarks();
});

ipcMain.handle('bookmarks:save', (e, data) => {
    if (!isSenderTrusted(e)) return false;
    saveBookmarks(data);
    broadcastBookmarks();
    return true;
});

ipcMain.handle('bookmarks:add', (event, item) => {
    if (!isSenderTrusted(event)) return loadBookmarks();
    const data = loadBookmarks();
    
    const normUrl = (u) => u.toLowerCase().replace(/\/$/, '');
    const itemNorm = normUrl(item.url || '');

    // Remove if already exists (by ID or URL) to handle "Edit" or "Move"
    const removeFromList = (list) => {
        return list.filter(b => {
            if (b.id === item.id) return false;
            if (b.type === 'bookmark' && normUrl(b.url || '') === itemNorm) return false;
            
            if (b.type === 'folder' && b.children) {
                b.children = removeFromList(b.children);
            }
            return true;
        });
    };
    data.bar = removeFromList(data.bar);
    
    // Add to root
    data.bar.push(item);
    saveBookmarks(data);
    broadcastBookmarks();
    return data;
});

ipcMain.handle('bookmarks:remove', (event, id) => {
    if (!isSenderTrusted(event)) return loadBookmarks();
    const data = loadBookmarks();
    const removeFromList = (list) => {
        return list.filter(item => {
            if (item.id === id) return false;
            if (item.type === 'folder' && item.children) {
                item.children = removeFromList(item.children);
            }
            return true;
        });
    };
    data.bar = removeFromList(data.bar);
    saveBookmarks(data);
    broadcastBookmarks();
    return data;
});

ipcMain.handle('bookmarks:reorder', (e, bar) => {
    if (!isSenderTrusted(e)) return false;
    const data = loadBookmarks();
    data.bar = bar;
    saveBookmarks(data);
    broadcastBookmarks();
    return true;
});

ipcMain.handle('bookmarks:addFolder', (e, name) => {
    if (!isSenderTrusted(e)) return loadBookmarks();
    const data = loadBookmarks();
    const folder = { id: 'f-' + Date.now(), type: 'folder', title: name, children: [] };
    data.bar.push(folder);
    saveBookmarks(data);
    broadcastBookmarks();
    return data;
});

ipcMain.handle('bookmarks:addToFolder', (e, folderId, item) => {
    if (!isSenderTrusted(e)) return loadBookmarks();
    const data = loadBookmarks();
    
    const normUrl = (u) => u.toLowerCase().replace(/\/$/, '');
    const itemNorm = normUrl(item.url || '');

    // 1. Remove from old position (by ID or URL)
    const removeFromList = (list) => {
        return list.filter(b => {
            if (b.id === item.id) return false;
            if (b.type === 'bookmark' && normUrl(b.url || '') === itemNorm) return false;

            if (b.type === 'folder' && b.children) {
                b.children = removeFromList(b.children);
            }
            return true;
        });
    };
    data.bar = removeFromList(data.bar);

    // 2. Find target folder and add
    const findFolder = (list) => {
        for (const b of list) {
            if (b.id === folderId && b.type === 'folder') return b;
            if (b.type === 'folder' && b.children) {
                const found = findFolder(b.children);
                if (found) return found;
            }
        }
        return null;
    };
    const folder = findFolder(data.bar);
    if (folder) {
        folder.children.push(item);
        saveBookmarks(data);
        broadcastBookmarks();
    }
    return data;
});

// ─── IPC SENDER VALIDATION (Rule 17) ─────────────────────────────────────────
// Only messages originating from our own app:// pages are trusted.
function isSenderTrusted(event) {
    try {
        const frameUrl = event.senderFrame?.url || event.sender?.getURL() || '';
        // Allow app:// (our custom protocol) and data: pages (error pages)
        return frameUrl.startsWith('app://') || frameUrl.startsWith('data:');
    } catch {
        return false;
    }
}

ipcMain.handle('tab:get-info', async (e, { id }) => {
    if (!isSenderTrusted(e)) return null;
    const view = tabs[id];
    if (!view || view.webContents.isDestroyed()) return null;

    try {
        const wc = view.webContents;
        let memoryBytes = 0;

        // Safety check for Electron versions that might not have this method
        if (typeof wc.getProcessMemoryInfo === 'function') {
            try {
                const info = await wc.getProcessMemoryInfo();
                memoryBytes = info.privateBytes || 0;
            } catch (err) {
                console.error('getProcessMemoryInfo failed:', err);
            }
        }

        return {
            title: wc.getTitle(),
            url: wc.getURL(),
            memory: memoryBytes
        };
    } catch (err) {
        console.error('Failed to get tab info:', err);
        return null;
    }
});

// ─── IPC LISTENERS ───────────────────────────────────────────────────────────
ipcMain.on('new-tab', (e, { id, isStealth, url }) => {
    if (!isSenderTrusted(e)) return;
    createTab(id, url || 'https://www.google.com', isStealth);
});

ipcMain.on('switch-tab', (e, { id }) => {
    if (!isSenderTrusted(e)) return;
    Object.values(tabs).forEach(v => mainWindow.contentView.removeChildView(v));
    if (tabs[id]) {
        mainWindow.contentView.addChildView(tabs[id]);
        const { width, height } = mainWindow.getContentBounds();
        tabs[id].setBounds({ x: 0, y: UI_HEIGHT, width, height: height - UI_HEIGHT });
        tabs[id].webContents.focus();
    }
    activeTabId = id;
});

ipcMain.on('close-tab', (e, { id }) => {
    if (!isSenderTrusted(e)) return;
    if (tabs[id]) {
        mainWindow.contentView.removeChildView(tabs[id]);
        tabs[id].webContents.destroy();
        delete tabs[id];
        if (activeTabId === id) activeTabId = null;
    }
});

ipcMain.on('go-back', (e, { id }) => { 
    if (!isSenderTrusted(e)) return;
    const targetId = id === 'current' ? activeTabId : id;
    if (tabs[targetId]) tabs[targetId].webContents.navigationHistory.goBack(); 
});

ipcMain.on('go-forward', (e, { id }) => { 
    if (!isSenderTrusted(e)) return;
    const targetId = id === 'current' ? activeTabId : id;
    if (tabs[targetId]) tabs[targetId].webContents.navigationHistory.goForward(); 
});

ipcMain.on('reload', (e, { id }) => { 
    if (!isSenderTrusted(e)) return;
    const targetId = id === 'current' ? activeTabId : id;
    if (tabs[targetId]) tabs[targetId].webContents.reload(); 
});

ipcMain.on('navigate', (e, { id, url }) => {
    if (!isSenderTrusted(e)) return;
    if (!url) return; // Guard against undefined/null url

    const targetId = id === 'current' ? activeTabId : id;
    if (!tabs[targetId]) return;

    let formattedUrl = url.trim();

    // Internal stealth:// pages
    if (formattedUrl.toLowerCase() === 'stealth://history') {
        tabs[targetId]?.webContents.loadURL('app://history.html');
        return;
    }

    // Heuristic for search query
    const looksLikeUrl = (str) => {
        if (str.includes('://')) return true;
        if (str.includes(' ') || !str.includes('.')) return false;
        return true;
    };

    if (!looksLikeUrl(formattedUrl)) {
        formattedUrl = `https://www.google.com/search?q=${encodeURIComponent(formattedUrl)}`;
    } else if (!formattedUrl.includes('://')) {
        formattedUrl = `https://${formattedUrl}`;
    }

    tabs[targetId]?.webContents.loadURL(formattedUrl);
});

// ─── CUSTOM PROTOCOL (Rule 18 — no file://) ─────────────────────────────────
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }
]);

app.whenReady().then(() => {
    protocol.handle('app', (request) => {
        const url = new URL(request.url);
        // url.hostname is the filename e.g. 'index.html'
        const safeName = path.basename(url.hostname + url.pathname); // strip traversal
        const filePath = path.join(__dirname, 'renderer', safeName);
        return net.fetch(pathToFileURL(filePath).toString());
    });
    createWindow();
});