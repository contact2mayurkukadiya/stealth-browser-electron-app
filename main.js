const { app, BrowserWindow, WebContentsView, ipcMain, Menu, MenuItem } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let tabs = {}; // Store views by ID
const UI_HEIGHT = 112; // Height of our tabs + nav bar + bookmark bar

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
            nodeIntegration: false
        }
    });

    // mainWindow.webContents.openDevTools();


    // --- STEALTH MODE ---
    mainWindow.setContentProtection(true);

    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

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
            view.setBounds({ x: 0, y: UI_HEIGHT, width, height: height - UI_HEIGHT });
        });
    });
}

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
    view.setBounds({ x: 0, y: UI_HEIGHT, width, height: height - UI_HEIGHT });

    view.webContents.focus(); // Focus the view immediately

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
        if (rawUrl.includes('/renderer/history.html')) return 'stealth://history';
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

ipcMain.handle('session:load', () => {
    try {
        const p = getSessionPath();
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (e) {
        console.error('Failed to load session:', e);
    }
    return null;
});

ipcMain.handle('session:save', (e, data) => {
    try {
        fs.writeFileSync(getSessionPath(), JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save session:', e);
    }
    return true;
});

function appendHistory(url, title) {
    if (!url || url.startsWith('stealth://')) return;
    
    // Ignore Google's homepage and its query parameter variants (but keep /search queries)
    if (url.startsWith('https://www.google.com/') && !url.includes('/search')) return;

    const entry = JSON.stringify({ url, title, timestamp: Date.now() }) + '\n';
    fs.appendFile(getHistoryPath(), entry, (err) => {
        if (err) console.error('Failed to append history:', err);
    });
}

ipcMain.handle('history:get', async () => {
    try {
        const p = getHistoryPath();
        if (!fs.existsSync(p)) return [];
        const content = fs.readFileSync(p, 'utf-8');
        const lines = content.trim().split('\n');
        return lines.filter(Boolean).map(l => JSON.parse(l)).reverse(); // latest first
    } catch (e) {
        console.error('Failed to load history:', e);
        return [];
    }
});

ipcMain.handle('history:clear', async () => {
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
            return JSON.parse(fs.readFileSync(p, 'utf-8'));
        }
    } catch (e) {
        console.error('Failed to load bookmarks:', e);
    }
    return { bar: [] };
}

function saveBookmarks(data) {
    try {
        fs.writeFileSync(getBookmarksPath(), JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save bookmarks:', e);
    }
}

ipcMain.handle('bookmarks:get', () => loadBookmarks());

ipcMain.handle('bookmarks:save', (e, data) => {
    saveBookmarks(data);
    return true;
});

ipcMain.handle('bookmarks:add', (e, item) => {
    const data = loadBookmarks();
    data.bar.push(item);
    saveBookmarks(data);
    return data;
});

ipcMain.handle('bookmarks:remove', (e, id) => {
    const data = loadBookmarks();
    function removeFromList(list) {
        return list.filter(item => {
            if (item.id === id) return false;
            if (item.type === 'folder' && item.children) {
                item.children = removeFromList(item.children);
            }
            return true;
        });
    }
    data.bar = removeFromList(data.bar);
    saveBookmarks(data);
    return data;
});

ipcMain.handle('bookmarks:reorder', (e, bar) => {
    const data = loadBookmarks();
    data.bar = bar;
    saveBookmarks(data);
    return true;
});

ipcMain.handle('bookmarks:addFolder', (e, name) => {
    const data = loadBookmarks();
    const folder = { id: 'f-' + Date.now(), type: 'folder', title: name, children: [] };
    data.bar.push(folder);
    saveBookmarks(data);
    return data;
});

ipcMain.handle('bookmarks:addToFolder', (e, folderId, item) => {
    const data = loadBookmarks();
    const folder = data.bar.find(b => b.id === folderId && b.type === 'folder');
    if (folder) {
        folder.children.push(item);
        saveBookmarks(data);
    }
    return data;
});

// IPC LISTENERS
ipcMain.on('new-tab', (e, { id, isStealth, url }) => createTab(id, url || "https://www.google.com", isStealth));

ipcMain.on('switch-tab', (e, { id }) => {
    Object.values(tabs).forEach(v => {
        // Hide by moving off-screen or removing. Modern approach is removing or hiding via visibility.
        // For WebContentsView, we can remove it from parent and add it back or change z-index.
        mainWindow.contentView.removeChildView(v);
    });
    if (tabs[id]) {
        mainWindow.contentView.addChildView(tabs[id]);
        // Reset bounds since it was removed
        const { width, height } = mainWindow.getContentBounds();
        tabs[id].setBounds({ x: 0, y: UI_HEIGHT, width, height: height - UI_HEIGHT });
        tabs[id].webContents.focus(); // Ensure the new view is focused
    }
});

ipcMain.on('close-tab', (e, { id }) => {
    if (tabs[id]) {
        mainWindow.contentView.removeChildView(tabs[id]);
        tabs[id].webContents.destroy();
        delete tabs[id];
    }
});

ipcMain.on('go-back', (e, { id }) => tabs[id]?.webContents.navigationHistory.goBack());
ipcMain.on('go-forward', (e, { id }) => tabs[id]?.webContents.navigationHistory.goForward());
ipcMain.on('reload', (e, { id }) => tabs[id]?.webContents.reload());
ipcMain.on('navigate', (e, { id, url }) => {
    let formattedUrl = url.trim();
    
    // Internal stealth:// pages
    if (formattedUrl.toLowerCase() === 'stealth://history') {
        tabs[id]?.webContents.loadURL(`file://${path.join(__dirname, 'renderer', 'history.html')}`);
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

    tabs[id]?.webContents.loadURL(formattedUrl);
});

app.whenReady().then(createWindow);