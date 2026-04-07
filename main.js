const { app, BrowserWindow, WebContentsView, ipcMain, Menu, MenuItem, dialog, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const encryption = require('./encryption');
const compatDiagnostics = require('./compatibilityDiagnostics');

process.on('uncaughtException', (error) => {
    dialog.showErrorBox('Fatal Application Error', error.stack || error.message || String(error));
    app.quit();
});

let mainWindow;
let isHTMLFullscreen = false;
let tabs = {}; // Store views by ID (only fully-loaded tabs)
let activeTabId = null; // Track currently visible tab
const UI_HEIGHT = 122; // Height of our tabs + nav bar + bookmark bar

// Holds metadata for session-restored tabs that have not been activated yet.
// Key: tabId, Value: { url } — enough to create the WebContentsView on demand.
// Entries are removed as soon as the tab is first activated or closed.
const sleepingTabs = {};

// Map Electron webContents.id → tab id (for webRequest diagnostics on shared sessions).
const webContentsIdToTabId = new Map();

// Reduce obvious automation fingerprints and align with Chromium browser signals.
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('lang', 'en-US,en');

function getBrowserLikeUserAgent() {
    const chromeVersion = process.versions.chrome || '120.0.0.0';
    const platform = process.platform;
    if (platform === 'darwin') {
        return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    }
    if (platform === 'win32') {
        return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    }
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

function classifyNavigationError(errorCode, errorDescription) {
    const code = Number(errorCode);
    const normalized = (errorDescription || '').toUpperCase();
    if (code === -201 || normalized.includes('CERT')) {
        return {
            title: 'Secure connection failed',
            details: 'The site certificate could not be verified.',
            suggestion: 'Check system date/time or try again on a trusted network.',
        };
    }
    if (code === -27 || normalized.includes('BLOCKED_BY_RESPONSE')) {
        return {
            title: 'Blocked by site policy',
            details: 'The site refused this navigation based on its response/security policy.',
            suggestion: 'This endpoint may block embedded or non-standard clients.',
        };
    }
    if (code === -102) {
        return {
            title: 'Connection refused',
            details: 'The server rejected the network connection.',
            suggestion: 'The service may be down or blocking this network.',
        };
    }
    if (code === -105) {
        return {
            title: 'Site not found',
            details: 'The domain could not be resolved by DNS.',
            suggestion: 'Check the URL spelling and your internet connection.',
        };
    }
    return {
        title: 'This site cannot be reached',
        details: 'The page failed to load due to a network/security error.',
        suggestion: 'Retry, or open DevTools/terminal logs for full diagnostics.',
    };
}

const MAX_MAINFRAME_REDIRECTS = 12;
const REDIRECT_WINDOW_MS = 10000;
const TRACKING_REDIRECT_HOST_MARKERS = [
    'doubleclick.net',
    'googlesyndication.com',
    'adservice.google.com',
    'taboola.com',
    'outbrain.com',
    'criteo.com',
    'pubmatic.com',
    'openx.net',
    'smartadserver.com',
    'smilewanted.com',
    'adsrvr.org',
];
const sessionNetworkGuardsInstalled = new WeakSet();
const mainFrameRequestWindowsByWebContents = new Map();

function getHostnameSafe(rawUrl) {
    try {
        return new URL(rawUrl).hostname.toLowerCase();
    } catch {
        return '';
    }
}

function isLikelyTrackingRedirectUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        const host = parsed.hostname.toLowerCase();
        const hasTrackingHost = TRACKING_REDIRECT_HOST_MARKERS.some(marker => host.includes(marker));
        if (!hasTrackingHost) return false;

        const search = parsed.search.toLowerCase();
        return (
            search.includes('redirect=') ||
            search.includes('redirect_url=') ||
            search.includes('dest=') ||
            search.includes('target=') ||
            search.includes('url=') ||
            search.includes('next=')
        );
    } catch {
        return false;
    }
}

function pickResponseHeadersForDiag(responseHeaders) {
    if (!responseHeaders || typeof responseHeaders !== 'object') return {};
    const want = new Set([
        'content-security-policy',
        'x-frame-options',
        'cross-origin-opener-policy',
        'cross-origin-embedder-policy',
        'permissions-policy',
        'strict-transport-security',
    ]);
    const out = {};
    for (const key of Object.keys(responseHeaders)) {
        const low = key.toLowerCase();
        if (!want.has(low)) continue;
        const val = responseHeaders[key];
        out[low] = Array.isArray(val) ? val.join(', ') : String(val);
    }
    return out;
}

function buildRedirectBlockedPage(targetUrl, reasonText) {
    return `
        <!DOCTYPE html>
        <html style="background: #253035; color: white; font-family: sans-serif; height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0;">
            <div style="text-align: center; max-width: 650px; padding: 20px;">
                <h1 style="margin: 0 0 10px 0; font-size: 24px;">Redirect blocked for safety</h1>
                <p style="color: #aaa; margin: 0 0 8px 0;">The browser prevented a redirect chain that looked abusive.</p>
                <p style="color: #9fc6d8; margin: 0 0 20px 0;">${reasonText}</p>
                <p style="color: #aaa; margin: 0 0 20px 0;">Blocked URL: <strong>${targetUrl}</strong></p>
                <div style="background: #1e2c32; padding: 15px; border-radius: 8px; font-family: monospace; color: #ffd166; font-size: 13px;">
                    Tip: Reload if you trust this site. Normal page redirects are still allowed.
                </div>
            </div>
        </html>
    `;
}

function installSessionNetworkGuards(session) {
    if (!session || sessionNetworkGuardsInstalled.has(session)) return;
    sessionNetworkGuardsInstalled.add(session);

    // Keep request headers consistently browser-like across all resources.
    session.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };
        headers['User-Agent'] = getBrowserLikeUserAgent();
        headers['Accept-Language'] = 'en-US,en;q=0.9';
        callback({ requestHeaders: headers });
    });

    // Network-layer redirect/loop guard (more robust than will-redirect alone).
    session.webRequest.onBeforeRequest((details, callback) => {
        if (details.resourceType !== 'mainFrame') {
            callback({});
            return;
        }

        const webContentsId = details.webContentsId;
        const now = Date.now();
        const currentWindow = mainFrameRequestWindowsByWebContents.get(webContentsId);
        let state = currentWindow;
        if (!state || now - state.startedAt > REDIRECT_WINDOW_MS) {
            state = { startedAt: now, count: 0 };
            mainFrameRequestWindowsByWebContents.set(webContentsId, state);
        }
        state.count += 1;

        const trackingRedirect = isLikelyTrackingRedirectUrl(details.url);
        const redirectLoop = state.count > MAX_MAINFRAME_REDIRECTS;
        if (!trackingRedirect && !redirectLoop) {
            callback({});
            return;
        }

        const reasonText = redirectLoop
            ? `Blocked because this tab requested more than ${MAX_MAINFRAME_REDIRECTS} top-level pages within ${Math.round(REDIRECT_WINDOW_MS / 1000)} seconds.`
            : 'Blocked because the request matched known tracking/csync redirect patterns.';
        console.warn(`[RedirectGuard][webRequest] Blocked ${details.url}. Reason: ${reasonText}`);
        const tabIdForRequest = webContentsIdToTabId.get(webContentsId);
        recordCompatEvent(tabIdForRequest, {
            type: 'main-frame-request-blocked',
            url: details.url,
            reason: reasonText,
        });
        callback({ cancel: true });
    });

    session.webRequest.onHeadersReceived((details, callback) => {
        if (details.resourceType !== 'mainFrame') {
            callback({});
            return;
        }
        const tabIdForHeaders = webContentsIdToTabId.get(details.webContentsId);
        recordCompatEvent(tabIdForHeaders, {
            type: 'main-frame-response',
            url: details.url,
            statusCode: details.statusCode,
            headers: pickResponseHeadersForDiag(details.responseHeaders),
        });
        callback({});
    });
}

if (!app.isPackaged) {
    try {
        require("electron-reloader")(module, {
            debug: true,
            watchRenderer: true
        });
    } catch (err) {
        console.error("Hot reload error:", err);
    }
}

function createWindow() {
    const isMac = process.platform === 'darwin';
    mainWindow = new BrowserWindow({
        width: 1200, height: 800,
        // macOS: 'hiddenInset' keeps traffic lights visible inside the window frame.
        // Windows/Linux: 'hidden' removes the default title bar; titleBarOverlay
        // re-adds the native caption buttons (minimize/maximize/close) on the right.
        titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
        ...(isMac
            ? { trafficLightPosition: { x: 15, y: 15 } }
            : {
                titleBarOverlay: {
                    color: '#1a1a1a',
                    symbolColor: '#ffffff',
                    height: 45,
                },
            }
        ),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    // Keep main renderer UA/browser identity close to Chrome.
    mainWindow.webContents.setUserAgent(getBrowserLikeUserAgent());

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


    // --- STEALTH MODE: apply persisted setting (defaults to true) ---
    mainWindow.setContentProtection(loadSettings().contentProtection);

    // Load renderer through app:// so IPC sender validation stays consistent.
    mainWindow.loadURL('app://dist/index.html');

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
                    label: 'Settings',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => mainWindow.webContents.send('shortcut-settings')
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
    tooltipView.webContents.loadURL('app://localhost/tooltip.html');

    // Add it last so it's on top of all other views
    mainWindow.contentView.addChildView(tooltipView);
    tooltipView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); // Hide initially
}


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

    const webContentsNumericId = view.webContents.id;
    webContentsIdToTabId.set(webContentsNumericId, id);
    view.webContents.on('destroyed', () => {
        webContentsIdToTabId.delete(webContentsNumericId);
    });

    // Make tab requests look like a regular Chrome browser, not Electron.
    view.webContents.setUserAgent(getBrowserLikeUserAgent());
    view.webContents.session.setUserAgent(getBrowserLikeUserAgent(), 'en-US,en;q=0.9');
    installSessionNetworkGuards(view.webContents.session);

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

    // Brave-like redirect guard:
    // - allow normal redirects
    // - block excessive redirect chains in a short window
    // - block obvious tracking/csync redirect hops for main frame
    const redirectGuard = { startedAt: 0, count: 0 };
    view.webContents.on('will-redirect', (event, targetUrl, isInPlace, isMainFrame) => {
        if (!isMainFrame) return;

        const now = Date.now();
        if (!redirectGuard.startedAt || now - redirectGuard.startedAt > REDIRECT_WINDOW_MS) {
            redirectGuard.startedAt = now;
            redirectGuard.count = 0;
        }
        redirectGuard.count += 1;

        const currentHost = getHostnameSafe(view.webContents.getURL());
        const redirectHost = getHostnameSafe(targetUrl);
        const isCrossSiteRedirect = currentHost && redirectHost && currentHost !== redirectHost;
        const isTrackingRedirect = isCrossSiteRedirect && isLikelyTrackingRedirectUrl(targetUrl);
        const isRedirectLoop = redirectGuard.count > MAX_MAINFRAME_REDIRECTS;

        if (!isTrackingRedirect && !isRedirectLoop) return;

        event.preventDefault();
        const reasonText = isRedirectLoop
            ? `Blocked because this tab performed more than ${MAX_MAINFRAME_REDIRECTS} redirects within ${Math.round(REDIRECT_WINDOW_MS / 1000)} seconds.`
            : 'Blocked because the redirect target matches known tracking/csync redirect patterns.';

        console.warn(`[RedirectGuard] Blocked redirect to ${targetUrl}. Reason: ${reasonText}`);
        recordCompatEvent(id, {
            type: 'redirect-blocked',
            fromUrl: view.webContents.getURL(),
            targetUrl,
            reason: reasonText,
        });
        const blockedHtml = buildRedirectBlockedPage(targetUrl, reasonText);
        setImmediate(() => {
            if (!view.webContents.isDestroyed()) {
                view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(blockedHtml)}`);
            }
        });
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

    // A subset of anti-automation checks look at navigator.webdriver.
    // This mirrors mainstream browser behavior for regular tabs.
    view.webContents.on('dom-ready', () => {
        view.webContents.executeJavaScript(`
            try {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined,
                    configurable: true
                });
            } catch (_) {}
        `).catch(() => {});
    });

    const getDisplayUrl = (rawUrl) => {
        if (!rawUrl) return '';
        if (rawUrl.startsWith('app://') && rawUrl.includes('history')) return 'stealth://history';
        if (rawUrl.startsWith('app://') && rawUrl.includes('settings')) return 'stealth://settings';
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
        recordCompatEvent(id, { type: 'navigated', url: displayUrl, rawUrl: targetUrl });
        mainWindow.webContents.send('url-changed', { id, url: displayUrl });
        if (!isStealth && !targetUrl.startsWith('data:') && !isInternalPageUrl(targetUrl)) {
            appendHistory(id, displayUrl, view.webContents.getTitle() || displayUrl);
        }
    });

    view.webContents.on('did-navigate-in-page', (event, targetUrl) => {
        let displayUrl = getDisplayUrl(targetUrl);
        mainWindow.webContents.send('url-changed', { id, url: displayUrl });
        if (!isStealth && !targetUrl.startsWith('data:') && !isInternalPageUrl(targetUrl)) {
            appendHistory(id, displayUrl, view.webContents.getTitle() || displayUrl);
        }
    });

    view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        // Ignore subresource/frame failures. Many pages include third-party
        // trackers/ads that fail or are blocked; that should not replace the
        // whole tab with an error page.
        if (!isMainFrame) return;

        // -3 is ERR_ABORTED (user stopped loading), ignore
        if (errorCode === -3) return;

        console.log(`Navigation failed: ${validatedURL} (${errorCode}: ${errorDescription})`);

        recordCompatEvent(id, {
            type: 'load-failed',
            validatedURL,
            errorCode,
            errorDescription,
        });

        // If it's a DNS resolution error (likely just typed a search term), fallback to Google
        if (errorCode === -105) { // ERR_NAME_NOT_RESOLVED
            const searchQuery = validatedURL.replace(/^https?:\/\//, '').replace(/\/$/, '');
            const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
            recordCompatEvent(id, {
                type: 'dns-fallback',
                query: searchQuery,
                fallbackUrl: googleSearchUrl,
            });
            setImmediate(() => {
                if (!view.webContents.isDestroyed()) {
                    view.webContents.loadURL(googleSearchUrl);
                }
            });
            return;
        }

        const errorMeta = classifyNavigationError(errorCode, errorDescription);

        // For other errors (SSL, blocked responses, etc.), show an actionable error page.
        const errorHtml = `
            <!DOCTYPE html>
            <html style="background: #253035; color: white; font-family: sans-serif; height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0;">
                <div style="text-align: center; max-width: 500px; padding: 20px;">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 20px;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <h1 style="margin: 0 0 10px 0; font-size: 24px;">${errorMeta.title}</h1>
                    <p style="color: #aaa; margin: 0 0 10px 0;">${errorMeta.details}</p>
                    <p style="color: #9fc6d8; margin: 0 0 20px 0;">${errorMeta.suggestion}</p>
                    <p style="color: #aaa; margin: 0 0 20px 0;">URL: <strong>${validatedURL}</strong></p>
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

// Tracks the last-recorded {url, timestamp} per tab to deduplicate rapid
// duplicate entries caused by did-navigate + did-navigate-in-page both firing
// for a single Google search (Google uses pushState to normalise its URL).
const lastRecordedByTab = new Map();

function getHistoryPath() {
    if (!historyPath) {
        historyPath = path.join(app.getPath('userData'), 'history.ndjson');
    }
    return historyPath;
}

/**
 * Returns true for any internal browser page (history, settings, etc.) that
 * should never be recorded in browsing history.
 */
function isInternalPageUrl(url) {
    if (!url) return false;
    if (url.startsWith('stealth://')) return true;
    if (url.startsWith('app://') && url.includes('history.html')) return true;
    if (url.startsWith('app://') && url.includes('settings.html')) return true;
    return false;
}

// ─── SETTINGS STORAGE ────────────────────────────────────────────────────────
let settingsPath;

const SETTINGS_DEFAULTS = {
    contentProtection: true,
    startupBehavior: 'continue', // 'fresh' | 'continue' | 'clearHistory'
    compatibilityDiagnosticsEnabled: false,
};

function getSettingsPath() {
    if (!settingsPath) {
        settingsPath = path.join(app.getPath('userData'), 'settings.json');
    }
    return settingsPath;
}

function loadSettings() {
    try {
        const p = getSettingsPath();
        if (fs.existsSync(p)) {
            return { ...SETTINGS_DEFAULTS, ...JSON.parse(fs.readFileSync(p, 'utf-8')) };
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    return { ...SETTINGS_DEFAULTS };
}

function recordCompatEvent(tabId, entry) {
    if (!tabId) return;
    if (!loadSettings().compatibilityDiagnosticsEnabled) return;
    compatDiagnostics.push(tabId, { ...entry, timestamp: Date.now() });
}

function saveSettings(data) {
    try {
        fs.writeFileSync(getSettingsPath(), JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

ipcMain.handle('settings:get', (e) => {
    if (!isSenderTrusted(e)) return SETTINGS_DEFAULTS;
    return loadSettings();
});

ipcMain.handle('settings:save', (e, data) => {
    if (!isSenderTrusted(e)) return false;
    const current = loadSettings();
    saveSettings({ ...current, ...data });
    return true;
});

ipcMain.handle('app:relaunch', (e) => {
    if (!isSenderTrusted(e)) return;
    app.relaunch();
    app.exit(0);
});

ipcMain.handle('compatDiag:getReport', (e, payload = {}) => {
    if (!isSenderTrusted(e)) return null;
    const tabId = payload && payload.tabId != null ? String(payload.tabId) : undefined;
    const report = compatDiagnostics.getReport(tabId);
    return { ...report, activeTabId };
});

ipcMain.handle('compatDiag:clear', (e, payload = {}) => {
    if (!isSenderTrusted(e)) return false;
    const tabId = payload && payload.tabId != null ? String(payload.tabId) : undefined;
    compatDiagnostics.clear(tabId);
    return true;
});

// ─── SESSION STORAGE ───────────────────────────────────────────────────────────
let sessionPath;

function getSessionPath() {
    if (!sessionPath) {
        sessionPath = path.join(app.getPath('userData'), 'session.json');
    }
    return sessionPath;
}

function clearSessionSnapshot() {
    try {
        const p = getSessionPath();
        if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (err) {
        console.error('Failed to clear session snapshot:', err);
    }
}

ipcMain.handle('session:load', (e) => {
    if (!isSenderTrusted(e)) return null;

    const { startupBehavior } = loadSettings();

    // 'clearHistory': wipe history file, then start fresh (no session restore)
    if (startupBehavior === 'clearHistory') {
        try {
            const hp = getHistoryPath();
            if (fs.existsSync(hp)) fs.unlinkSync(hp);
        } catch (err) {
            console.error('Failed to clear history on startup:', err);
        }
        clearSessionSnapshot();
        return null;
    }

    // 'fresh': start with a single new tab, no session restore
    if (startupBehavior === 'fresh') {
        clearSessionSnapshot();
        return null;
    }

    // 'continue' (default): restore previous session
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
    const { startupBehavior } = loadSettings();

    // In fresh/clearHistory modes, do not persist tab snapshots.
    if (startupBehavior === 'fresh' || startupBehavior === 'clearHistory') {
        clearSessionSnapshot();
        return true;
    }

    try {
        const payload = encryption.encrypt(JSON.stringify(data));
        fs.writeFileSync(getSessionPath(), JSON.stringify(payload, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save session:', e);
    }
    return true;
});

function appendHistory(tabId, url, title) {
    if (!url || url.startsWith('stealth://')) return;

    // Ignore Google's homepage and its query parameter variants (but keep /search queries)
    if (url.startsWith('https://www.google.com/') && !url.includes('/search')) return;

    // Skip duplicate: same URL recorded for this tab within the last 3 seconds.
    // This prevents did-navigate + did-navigate-in-page (Google pushState) from
    // writing multiple entries for a single search.
    const now = Date.now();
    const last = lastRecordedByTab.get(tabId);
    if (last && last.url === url && now - last.timestamp < 3000) return;
    lastRecordedByTab.set(tabId, { url, timestamp: now });

    const dataObj = JSON.stringify({ url, title, timestamp: now });
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

ipcMain.handle('history:remove-items', async (e, timestamps) => {
    if (!isSenderTrusted(e)) return false;
    if (!Array.isArray(timestamps) || timestamps.length === 0) return true;

    try {
        const historyFilePath = getHistoryPath();
        if (!fs.existsSync(historyFilePath)) return true;

        const removeSet = new Set(
            timestamps
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value))
        );
        if (removeSet.size === 0) return true;

        const content = fs.readFileSync(historyFilePath, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        const keptLines = lines.filter((line) => {
            try {
                const parsed = JSON.parse(line);
                const decoded = (parsed && parsed.encrypted !== undefined)
                    ? encryption.decrypt(parsed)
                    : JSON.stringify(parsed);
                if (!decoded) return false;
                const item = JSON.parse(decoded);
                return !removeSet.has(Number(item.timestamp));
            } catch (error) {
                // Keep unreadable legacy lines to avoid silent data loss.
                return true;
            }
        });

        const nextContent = keptLines.length > 0 ? `${keptLines.join('\n')}\n` : '';
        fs.writeFileSync(historyFilePath, nextContent, 'utf-8');
        return true;
    } catch (error) {
        console.error('Failed to remove history items:', error);
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

// ─── LAZY TAB LOADING ────────────────────────────────────────────────────────
// Register a tab as sleeping: records its URL for deferred loading without
// creating a WebContentsView. The view is created the first time the tab is
// activated (see the switch-tab handler below).
ipcMain.on('tab:sleep-register', (e, { id, url }) => {
    if (!isSenderTrusted(e)) return;
    sleepingTabs[id] = { url: url || 'https://www.google.com' };
});

// Hide / restore the active tab view so React modals can appear above it.
// WebContentsViews are native children that always render on top of the
// BrowserWindow web content; setting bounds to 0×0 is the only way to
// let a React-rendered modal show above the tab content.
ipcMain.handle('tab:hide-active', (e) => {
    if (!isSenderTrusted(e)) return;
    if (activeTabId && tabs[activeTabId]) {
        tabs[activeTabId].setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
});

ipcMain.handle('tab:restore-active', (e) => {
    if (!isSenderTrusted(e)) return;
    if (activeTabId && tabs[activeTabId]) {
        const { width, height } = mainWindow.getContentBounds();
        tabs[activeTabId].setBounds({ x: 0, y: UI_HEIGHT, width, height: height - UI_HEIGHT });
    }
});

ipcMain.handle('tab:get-info', async (e, { id }) => {
    if (!isSenderTrusted(e)) return null;

    // For sleeping tabs return their stored metadata without accessing a WebContentsView.
    if (!tabs[id] && sleepingTabs[id]) {
        return { url: sleepingTabs[id].url, title: null, memory: 0, isSleeping: true };
    }

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

    // Resolve internal stealth:// URLs the same way the navigate handler does,
    // so that session-restored history tabs load correctly.
    let resolvedUrl = url || 'https://www.google.com';
    if (resolvedUrl.toLowerCase() === 'stealth://history') {
        resolvedUrl = 'app://localhost/dist/history.html';
    } else if (resolvedUrl.toLowerCase() === 'stealth://settings') {
        resolvedUrl = 'app://localhost/dist/settings.html';
    }

    createTab(id, resolvedUrl, isStealth);

    // Notify the main React shell so it can add the tab to its state
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('tab-created', { id, isStealth, url: resolvedUrl });
    }
});

ipcMain.on('switch-tab', (e, { id }) => {
    if (!isSenderTrusted(e)) return;

    // Wake a sleeping tab on first activation: create its WebContentsView now
    // and notify the renderer so the isSleeping flag is cleared in Redux state.
    if (!tabs[id] && sleepingTabs[id]) {
        let resolvedUrl = sleepingTabs[id].url;
        if (resolvedUrl.toLowerCase() === 'stealth://history') {
            resolvedUrl = 'app://localhost/dist/history.html';
        } else if (resolvedUrl.toLowerCase() === 'stealth://settings') {
            resolvedUrl = 'app://localhost/dist/settings.html';
        }
        delete sleepingTabs[id];
        createTab(id, resolvedUrl, false);

        if (mainWindow && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('tab:awoken', { id });
        }
    }

    if (!tabs[id]) return; // Truly unknown tab — don't blank the window

    Object.values(tabs).forEach(v => mainWindow.contentView.removeChildView(v));
    mainWindow.contentView.addChildView(tabs[id]);
    const { width, height } = mainWindow.getContentBounds();
    tabs[id].setBounds({ x: 0, y: UI_HEIGHT, width, height: height - UI_HEIGHT });
    tabs[id].webContents.focus();
    activeTabId = id;
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('tab-switched', { id });
    }
});

ipcMain.on('close-tab', (e, { id }) => {
    if (!isSenderTrusted(e)) return;
    // Clean up sleeping metadata regardless of whether a view was ever created.
    delete sleepingTabs[id];
    if (tabs[id]) {
        mainWindow.contentView.removeChildView(tabs[id]);
        tabs[id].webContents.destroy();
        delete tabs[id];
        if (activeTabId === id) activeTabId = null;
    }
    lastRecordedByTab.delete(id);
    compatDiagnostics.clear(id);
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
        tabs[targetId]?.webContents.loadURL('app://localhost/dist/history.html');
        return;
    }
    if (formattedUrl.toLowerCase() === 'stealth://settings') {
        tabs[targetId]?.webContents.loadURL('app://localhost/dist/settings.html');
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
        // url.hostname may contain file name (app://history.html) or host (app://localhost/...)
        // Support subdirectories (e.g. app://dist/assets/main.js)
        const normalizedPathname = url.pathname === '/' ? '' : url.pathname;
        let reqPath = normalizedPathname;
        if (url.hostname && url.hostname !== 'localhost') {
            reqPath = '/' + url.hostname + normalizedPathname;
        }
        if (!reqPath) {
            reqPath = '/index.html';
        }
        const relativePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, ''); // strip leading ../
        const safePath = relativePath.replace(/^\//, '').replace(/\/+$/, '');
        const filePath = path.join(__dirname, 'renderer', safePath);

        try {
            const data = fs.readFileSync(filePath);
            let mimeType = 'text/plain';
            const ext = path.extname(filePath).toLowerCase();
            if (ext === '.html') mimeType = 'text/html';
            else if (ext === '.js') mimeType = 'text/javascript';
            else if (ext === '.css') mimeType = 'text/css';
            else if (ext === '.json') mimeType = 'application/json';
            else if (ext === '.svg') mimeType = 'image/svg+xml';
            else if (ext === '.png') mimeType = 'image/png';

            return new Response(data, {
                status: 200,
                headers: { 'Content-Type': mimeType }
            });
        } catch (err) {
            console.error('Protocol handle error reading', filePath, err);
            return new Response('File not found', { status: 404 });
        }
    });
    createWindow();
});