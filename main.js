const electron = require('electron');
const electronMain = (() => {
    try {
        return require('electron/main');
    } catch {
        return {};
    }
})();
const app = electron.app || electronMain.app;

const { configureAppPaths } = require('./runtime/appPaths');
const {
    configureBrowserIdentity,
    applyIdentityToWebContents,
    logStartupIdentity,
} = require('./runtime/browserIdentity');
const { buildSecureWebPreferences } = require('./runtime/webPreferences');
const {
    configureProductionGuards,
    applyContentProtection,
    applyShellWindowSecurity,
    applyProfilePickerSecurity,
} = require('./runtime/windowSecurity');
const {
    configureSession,
    normalizeCookieConfig,
    compileCookieConfig,
    cookiePatternMatchesHost,
    shouldBlockStoredCookie,
    clearTabTopLevelRegisterableDomain,
} = require('./runtime/sessionPolicy');
const identityDiagnostics = require('./runtime/identityDiagnostics');
const { setupWebAuthn } = require('./runtime/webauthn');

/** Must run before app.ready and before any getPath('userData') consumers. */
configureAppPaths(app);
configureBrowserIdentity(app);

const BrowserWindow = electron.BrowserWindow;
const WebContentsView = electron.WebContentsView;
const View = electron.View || electronMain.View;
const ipcMain = electron.ipcMain;
const Menu = electron.Menu;
const MenuItem = electron.MenuItem;
const dialog = electron.dialog || electronMain.dialog;
const protocol = electron.protocol || electronMain.protocol;
const net = electron.net || electronMain.net;
const clipboard = electron.clipboard;
const shell = electron.shell || electronMain.shell;
const webContents = electron.webContents;
const session = electron.session || electronMain.session;
const screen = electron.screen;
const nativeTheme = electron.nativeTheme;
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const encryption = require('./encryption');
const { createAppLogger } = require('./appLogger');
const compatDiagnostics = require('./compatibilityDiagnostics');
const { HistoryService } = require('./historyService');
const chromeTheme = require(path.join(__dirname, 'src', 'theme', 'chromeTheme.cjs'));
const C = require(path.join(__dirname, 'src', 'constants', 'conditionStrings.cjs'));
const appLogger = createAppLogger({ app, encryptionModule: encryption });
configureProductionGuards(app, appLogger);

process.on('uncaughtException', (error) => {
    const message = error?.stack || error?.message || String(error);
    appLogger.fatal('main:uncaught-exception', {
        error: appLogger.serializeError(error),
        logFile: appLogger.getCurrentLogFile(),
    });
    try {
        const electronDialog = require('electron').dialog;
        if (electronDialog && typeof electronDialog.showErrorBox === 'function') {
            electronDialog.showErrorBox('Fatal Application Error', message);
        } else {
            console.error('Fatal Application Error:', message);
        }
    } catch {
        console.error('Fatal Application Error:', message);
    }
    if (app && typeof app.quit === 'function') {
        app.quit();
    }
});

process.on('unhandledRejection', (reason) => {
    appLogger.error('main:unhandled-rejection', {
        error: appLogger.serializeError(reason),
    });
});

if (app && typeof app.on === 'function') {
    app.on('render-process-gone', (_event, contents, details) => {
        appLogger.error('electron:render-process-gone', {
            reason: details?.reason,
            exitCode: details?.exitCode,
            webContentsId: contents?.id,
            url: contents && !contents.isDestroyed?.() ? contents.getURL?.() : '',
        });
    });

    app.on('child-process-gone', (_event, details) => {
        appLogger.error('electron:child-process-gone', {
            type: details?.type,
            reason: details?.reason,
            exitCode: details?.exitCode,
            serviceName: details?.serviceName,
            name: details?.name,
        });
    });
}

const appProtocolInstalledSessions = new WeakSet();
const historyService = new HistoryService({ app, encryptionModule: encryption });
function registerAppProtocolForSession(targetSession, sessionTag = 'unknown') {
    if (!targetSession || appProtocolInstalledSessions.has(targetSession)) return;
    targetSession.protocol.handle('app', (request) => {
        const url = new URL(request.url);
        const normalizedPathname = url.pathname === '/' ? '' : url.pathname;
        let reqPath = normalizedPathname;
        if (url.hostname && url.hostname !== 'localhost') {
            reqPath = '/' + url.hostname + normalizedPathname;
        }
        if (!reqPath) {
            reqPath = '/index.html';
        }
        const relativePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
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
            return new Response(data, { status: 200, headers: { 'Content-Type': mimeType } });
        } catch (err) {
            console.error('Protocol handle error reading', filePath, err);
            return new Response('File not found', { status: 404 });
        }
    });
    appProtocolInstalledSessions.add(targetSession);
}

let mainWindow;
/** When set, that tab's web content is in document fullscreen (HTML5) layout. */
let htmlFullscreenTabId = null;
/** Tab menu labels synced from renderer (active tab / site mute state). */
let tabMenuMuteSiteShowsUnmute = false;
let tabMenuPinShowsUnpin = false;
// Window/Tab/Profile registries
const windowContextsById = new Map(); // BrowserWindow.id -> context
const tabIdToWindowId = new Map(); // tabId -> BrowserWindow.id
const profilesById = new Map(); // profileId -> profile metadata
const windowBootstrapById = new Map(); // app windowId -> bootstrap payload
let defaultProfileId = null;
/** Session document (schema v2) used when opening the first window after the profile picker. */
let startupSessionDoc = null;
let profilePickerWindow = null;
let appIsQuitting = false;
let appQuitAfterHistoryClose = false;
let appHistoryCloseStarted = false;
let appHistoryClosed = false;
let appCookieCleanupStarted = false;
let appCookieCleanupClosed = false;

const UI_HEIGHT = 122; // Height of our tabs + nav bar + bookmark bar
let generatedTabCounter = 0;
const MAX_RECENTLY_CLOSED_TABS = 25;
const recentlyClosedTabsByProfile = new Map();
const LENS_SIDEBAR_MIN_WIDTH = 260;
const LENS_SIDEBAR_DEFAULT_RATIO = 0.42;
const LENS_SIDEBAR_MAX_RATIO = 0.7;
const LENS_PANEL_GAP = 14;
const LENS_WORKSPACE_PADDING = 8;
const LENS_SITE_CONTAINER_MAX_SCALE = 1;
const LENS_PAGE_MIN_SCALE = 0.05;
const LENS_PANEL_RADIUS = 24;
const LENS_MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Holds metadata for session-restored tabs that have not been activated yet.
// Key: tabId, Value: { url } — enough to create the WebContentsView on demand.
// Entries are removed as soon as the tab is first activated or closed.
// legacy global kept for compatibility in a few guard paths
const sleepingTabs = {};

// Map Electron webContents.id → tab id (for webRequest diagnostics on shared sessions).
const webContentsIdToTabId = new Map();

// Tabs moved out of the main shell into their own window (WebContentsView reparented).
/** @type {Map<string, import('electron').BaseWindow>} */
const detachedTabWindows = new Map();


function broadcastSettingsUpdate(settings) {
    const payload = { settings };
    // Send to all browser windows
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win || win.isDestroyed?.()) continue;
        try {
            win.webContents.send(C.IPC_INVOKE.SETTINGS_UPDATE, payload);
        } catch (_) { }
    }
    // Send to all tabs and overlays
    for (const ctx of windowContextsById.values()) {
        for (const view of Object.values(ctx.tabs || {})) {
            if (!view || view.webContents.isDestroyed()) continue;
            try {
                view.webContents.send(C.IPC_INVOKE.SETTINGS_UPDATE, payload);
            } catch (_) { }
        }
        if (isViewWebContentsAlive(ctx.chromeOverlayView)) {
            try { ctx.chromeOverlayView.webContents.send(C.IPC_INVOKE.SETTINGS_UPDATE, payload); } catch (_) { }
        }
        if (isViewWebContentsAlive(ctx.chromeOmniboxOverlayView)) {
            try { ctx.chromeOmniboxOverlayView.webContents.send(C.IPC_INVOKE.SETTINGS_UPDATE, payload); } catch (_) { }
        }
        if (isViewWebContentsAlive(ctx.chromeShellMenuOverlayView)) {
            try { ctx.chromeShellMenuOverlayView.webContents.send(C.IPC_INVOKE.SETTINGS_UPDATE, payload); } catch (_) { }
        }
    }
}

function closeDevFileWatchers() {
    for (const watcher of devFileWatchers) {
        try { watcher.close(); } catch (_) { }
    }
    devFileWatchers.length = 0;
}

function getHostWindowForTabId(tabId) {
    return detachedTabWindows.get(tabId) || getWindowContextByTabId(tabId)?.window || getFocusedShellWindow();
}

function getFocusedShellWindow() {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && windowContextsById.has(focused.id)) return focused;
    for (const ctx of windowContextsById.values()) {
        if (ctx.window && !ctx.window.isDestroyed()) return ctx.window;
    }
    return null;
}

function focusedShellWebContents() {
    const w = getFocusedShellWindow();
    if (w && !w.isDestroyed()) return w.webContents;
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
}

function getWindowContextById(windowId) {
    return windowContextsById.get(windowId) || null;
}

function getWindowContextByBrowserWindow(win) {
    if (!win || win.isDestroyed()) return null;
    return getWindowContextById(win.id);
}

/** Prefer the focused shell window over `mainWindow` when tab-id lookup fails (secondary windows / stealth). */
function getWindowContextForShellFallback() {
    const focused = getFocusedShellWindow();
    if (focused) {
        const ctx = getWindowContextByBrowserWindow(focused);
        if (ctx) return ctx;
    }
    return getWindowContextByBrowserWindow(mainWindow);
}

function getWindowContextByEventSender(sender) {
    if (!sender) return null;
    try {
        if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return null;
    } catch (_) {
        return null;
    }
    const win = BrowserWindow.fromWebContents(sender);
    if (win && !win.isDestroyed()) {
        const ctx = getWindowContextByBrowserWindow(win);
        if (ctx) return ctx;
    }
    const tabId = webContentsIdToTabId.get(sender.id);
    if (tabId) return getWindowContextByTabId(tabId);
    return null;
}

function getWindowContextByTabId(tabId) {
    const windowId = tabIdToWindowId.get(tabId);
    if (!windowId) return null;
    return getWindowContextById(windowId);
}

function getOrCreateRecentlyClosedForProfile(profileId) {
    if (!recentlyClosedTabsByProfile.has(profileId)) {
        recentlyClosedTabsByProfile.set(profileId, []);
    }
    return recentlyClosedTabsByProfile.get(profileId);
}

function ensureProfile(profileId, displayName = null) {
    const safeProfileId = String(profileId || '').trim().replace(/[^a-zA-Z0-9-_]/g, '_');
    if (!safeProfileId) return null;
    if (!profilesById.has(safeProfileId)) {
        profilesById.set(safeProfileId, {
            profileId: safeProfileId,
            displayName: displayName || `Profile ${profilesById.size + 1}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            hasCustomAvatar: false,
            avatarExt: null,
            avatarSource: null,
        });
    }
    if (!defaultProfileId) defaultProfileId = safeProfileId;
    return profilesById.get(safeProfileId);
}

let profilesPath;
function getProfilesPath() {
    if (!profilesPath) {
        profilesPath = path.join(app.getPath('userData'), 'profiles.json');
    }
    return profilesPath;
}

function loadProfiles() {
    try {
        const p = getProfilesPath();
        if (!fs.existsSync(p)) return [];
        const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const decoded = (parsed && parsed.encrypted !== undefined)
            ? (() => {
                const dec = encryption.decrypt(parsed);
                return dec ? JSON.parse(dec) : null;
            })()
            : parsed;
        return Array.isArray(decoded) ? decoded : [];
    } catch {
        return [];
    }
}

function saveProfiles() {
    try {
        const data = Array.from(profilesById.values());
        const payload = encryption.encrypt(JSON.stringify(data));
        fs.writeFileSync(getProfilesPath(), JSON.stringify(payload, null, 2), 'utf-8');
    } catch (error) {
        console.error('Failed to save profiles:', error);
    }
}

const MAX_PROFILE_AVATAR_BYTES = 512 * 1024;

function getProfileAvatarsDir() {
    const dir = path.join(app.getPath('userData'), 'profile-avatars');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function safeProfileIdForPath(profileId) {
    return String(profileId || '').trim().replace(/[^a-zA-Z0-9-_]/g, '_');
}

function removeAvatarFilesForProfile(profileId) {
    const safeId = safeProfileIdForPath(profileId);
    const dir = path.join(app.getPath('userData'), 'profile-avatars');
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
        if (name === `${safeId}.png` || name === `${safeId}.jpeg` || name === `${safeId}.jpg` || name === `${safeId}.webp` || name === `${safeId}.gif`) {
            try {
                fs.unlinkSync(path.join(dir, name));
            } catch (_) {
                /* ignore */
            }
        }
    }
}

function avatarFilePath(profileId, ext) {
    return path.join(getProfileAvatarsDir(), `${safeProfileIdForPath(profileId)}.${ext}`);
}

/** Shared rules for profile photo uploads (used by validate IPC and save). */
function validateAvatarDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        return { ok: false, error: 'Invalid image' };
    }
    const comma = dataUrl.indexOf(',');
    if (comma < 12) return { ok: false, error: 'Invalid image' };
    const header = dataUrl.slice(0, comma);
    const b64 = dataUrl.slice(comma + 1).replace(/\s/g, '');
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64$/i.test(header)) {
        return {
            ok: false,
            error: 'Unsupported format. Use PNG, JPEG, WebP, or GIF.',
        };
    }
    let buf;
    try {
        buf = Buffer.from(b64, 'base64');
    } catch {
        return { ok: false, error: 'Invalid image data' };
    }
    if (!buf.length || buf.length > MAX_PROFILE_AVATAR_BYTES) {
        return {
            ok: false,
            error: `Image too large (max ${Math.round(MAX_PROFILE_AVATAR_BYTES / 1024)} KB).`,
        };
    }
    return { ok: true, header, buf };
}

function setProfileAvatarFromDataUrl(profileId, dataUrl) {
    const p = profilesById.get(safeProfileIdForPath(profileId));
    if (!p) return { ok: false, error: 'Profile not found' };
    const check = validateAvatarDataUrl(dataUrl);
    if (!check.ok) return check;
    const { header, buf } = check;
    let ext = 'png';
    if (/image\/jpe?g/i.test(header)) ext = 'jpeg';
    else if (/image\/webp/i.test(header)) ext = 'webp';
    else if (/image\/gif/i.test(header)) ext = 'gif';
    removeAvatarFilesForProfile(profileId);
    const dest = avatarFilePath(profileId, ext === 'jpeg' ? 'jpeg' : ext);
    fs.writeFileSync(dest, buf);
    p.hasCustomAvatar = true;
    p.avatarExt = ext;
    p.avatarSource = 'upload';
    p.updatedAt = Date.now();
    saveProfiles();
    return { ok: true, profile: p };
}

const PRESET_AVATAR_PNG_DIR = path.join(__dirname, 'renderer', 'assets', 'images', 'profiles');

function setProfileAvatarFromPresetPngFile(profileId, fileName) {
    const p = profilesById.get(safeProfileIdForPath(profileId));
    if (!p) return { ok: false, error: 'Profile not found' };
    if (typeof fileName !== 'string' || !/^\d+\.png$/i.test(fileName)) {
        return { ok: false, error: 'Invalid preset' };
    }
    const safeName = path.basename(fileName);
    const resolvedDir = path.resolve(PRESET_AVATAR_PNG_DIR);
    const srcPath = path.join(resolvedDir, safeName);
    const resolvedSrc = path.resolve(srcPath);
    if (resolvedSrc !== resolvedDir && !resolvedSrc.startsWith(resolvedDir + path.sep)) {
        return { ok: false, error: 'Invalid preset' };
    }
    let buf;
    try {
        buf = fs.readFileSync(resolvedSrc);
    } catch {
        return { ok: false, error: 'Preset file not found' };
    }
    if (!buf.length || buf.length > MAX_PROFILE_AVATAR_BYTES) {
        return {
            ok: false,
            error: `Image too large (max ${Math.round(MAX_PROFILE_AVATAR_BYTES / 1024)} KB).`,
        };
    }
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
        return { ok: false, error: 'Invalid image' };
    }
    removeAvatarFilesForProfile(profileId);
    const dest = avatarFilePath(profileId, 'png');
    fs.writeFileSync(dest, buf);
    p.hasCustomAvatar = true;
    p.avatarExt = 'png';
    p.avatarSource = 'preset';
    p.updatedAt = Date.now();
    saveProfiles();
    return { ok: true, profile: p };
}

function getProfileAvatarDataUrl(profileId) {
    const safeId = safeProfileIdForPath(profileId);
    const p = profilesById.get(safeId);
    if (!p || !p.hasCustomAvatar || !p.avatarExt) return null;
    const fp = avatarFilePath(profileId, p.avatarExt);
    if (!fs.existsSync(fp)) return null;
    let buf;
    try {
        buf = fs.readFileSync(fp);
    } catch {
        return null;
    }
    const mime = p.avatarExt === 'jpeg' ? 'image/jpeg' : `image/${p.avatarExt}`;
    return `data:${mime};base64,${buf.toString('base64')}`;
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

function getSessionPolicyDeps({ profileId = null, isStealthSession = false } = {}) {
    return {
        resourceTypeMainFrame: C.RESOURCE_TYPE.MAIN_FRAME,
        maxMainFrameRedirects: MAX_MAINFRAME_REDIRECTS,
        redirectWindowMs: REDIRECT_WINDOW_MS,
        isLikelyTrackingRedirectUrl,
        webContentsIdToTabId,
        recordCompatEvent,
        pickResponseHeadersForDiag,
        mainFrameRequestWindowsByWebContents,
        profileId,
        isStealthSession,
        getCookieConfig: getCachedCookieConfig,
        logPolicyError: (stage, error) => {
            appLogger.warn('cookies:policy-hook-failed', {
                stage,
                error: appLogger.serializeError(error),
            });
        },
    };
}

function installSessionNetworkGuards(targetSession, options = {}) {
    configureSession(targetSession, getSessionPolicyDeps(options));
    installCookieStoreGuard(targetSession, options);
}

// Dev-only chokidar watchers tracked so they can be closed before quit.
// On macOS, leaving fsevents handles alive causes fse_dispatch_event to abort()
// during node::Environment::CleanupHandles() because the V8 isolate is already torn down.
const devFileWatchers = [];

if (!app.isPackaged) {
    try {
        require('electron-reloader')(module, {
            debug: false,
            // Only main-process module graph — cwd-wide watch + ignore was unreliable for renderer/dist (e.g. CSS).
            watchRenderer: false,
        });
    } catch (err) {
        console.error('Hot reload error:', err);
    }
    try {
        const chokidar = require('chokidar');

        let preloadRelaunchScheduled = false;
        devFileWatchers.push(
            chokidar
                .watch(path.join(__dirname, 'preload.js'), { ignoreInitial: true })
                .on('change', () => {
                    if (preloadRelaunchScheduled) return;
                    preloadRelaunchScheduled = true;
                    app.relaunch();
                    app.quit();
                })
        );

        // One reload after all four Vite steps finish (see scripts/renderer-build-all.cjs).
        const rendererReloadStamp = path.join(__dirname, '.stealth-renderer-reload');
        if (!fs.existsSync(rendererReloadStamp)) {
            fs.writeFileSync(rendererReloadStamp, '');
        }
        devFileWatchers.push(
            chokidar
                .watch(rendererReloadStamp, { ignoreInitial: true })
                .on('change', () => {
                    for (const win of BrowserWindow.getAllWindows()) {
                        if (win.isDestroyed()) continue;
                        win.webContents.reloadIgnoringCache();
                    }
                })
        );
    } catch (err) {
        console.error('Dev file watch error:', err);
    }
}

app.on('before-quit', () => {
    appIsQuitting = true;
    closeDevFileWatchers();
});

/** Usable screen rectangle (excludes dock/taskbar); keeps custom title bar — not OS fullscreen. */
function getPrimaryWorkAreaBounds() {
    try {
        if (!screen || typeof screen.getPrimaryDisplay !== 'function') return null;
        const wa = screen.getPrimaryDisplay().workArea;
        if (!wa || wa.width < 320 || wa.height < 240) return null;
        return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
    } catch {
        return null;
    }
}

function createWindow({ profileId = null, windowId = null, fillWorkArea = true, stealthWindow = false } = {}) {
    const resolvedProfileId = profileId || defaultProfileId || `profile-${crypto.randomUUID()}`;
    ensureProfile(resolvedProfileId);
    const partition = `persist:profile-${resolvedProfileId}`;
    const mappedSession = session.fromPartition(partition);
    registerAppProtocolForSession(mappedSession, partition);
    installSessionNetworkGuards(mappedSession, { profileId: resolvedProfileId, isStealthSession: false });

    /** One shared in-memory session per stealth window (all tabs incognito; discarded with the window). */
    let stealthTabsPartition = null;
    if (stealthWindow) {
        stealthTabsPartition = `in-memory:stealth-win-${crypto.randomUUID()}`;
        const stealthTabSession = session.fromPartition(stealthTabsPartition);
        registerAppProtocolForSession(stealthTabSession, stealthTabsPartition);
        installSessionNetworkGuards(stealthTabSession, { profileId: resolvedProfileId, isStealthSession: true });
    }

    const isMac = process.platform === C.PLATFORM.DARWIN;
    const workArea = fillWorkArea ? getPrimaryWorkAreaBounds() : null;
    const stealthTitleBarOverlay =
        process.platform !== 'darwin'
            ? chromeTheme.getTitleBarOverlayFromSettings(
                { colorTheme: 'dark', accentTheme: 'default', accentCustomHex: null },
                true,
            )
            : null;
    const window = new BrowserWindow({
        ...(workArea
            ? {
                x: workArea.x,
                y: workArea.y,
                width: workArea.width,
                height: workArea.height,
            }
            : { width: 1200, height: 800 }),
        // macOS: 'hiddenInset' keeps traffic lights visible inside the window frame.
        // Windows/Linux: 'hidden' removes the default title bar; titleBarOverlay
        // re-adds the native caption buttons (minimize/maximize/close) on the right.
        titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
        ...(isMac
            ? { trafficLightPosition: { x: 15, y: 15 } }
            : {
                titleBarOverlay: stealthWindow ? stealthTitleBarOverlay : getTitleBarOverlayOptionsForNativeTheme(),
            }
        ),
        webPreferences: buildSecureWebPreferences({ partition }),
    });

    applyIdentityToWebContents(window.webContents);

    applyShellWindowSecurity(window, { permissionFullscreen: C.PERMISSION.FULLSCREEN });

    applyContentProtection(window, loadSettings().contentProtection);

    // Load renderer through app:// so IPC sender validation stays consistent.
    const shellEntryUrl = 'app://dist/index.html';
    window.loadURL(shellEntryUrl).catch((error) => {
        console.error('Failed to load shell entry URL:', shellEntryUrl, error);
    });

    // Custom Application Menu for robust shortcuts and tab actions
    rebuildApplicationMenu();

    // Global Shortcut Interception (for Ctrl+Tab, which is not easy in menu)
    window.webContents.on('before-input-event', handleShortcuts);
    // window.webContents.openDevTools({ mode: 'detach' });

    // Resize the visible tab view in the main shell (only one tab view is attached at a time).
    if (!mainWindow || mainWindow.isDestroyed()) mainWindow = window;
    window.on('focus', () => {
        mainWindow = window;
        rebuildApplicationMenu();
    });

    const context = {
        window,
        windowId: windowId || `window-${crypto.randomUUID()}`,
        profileId: resolvedProfileId,
        partition,
        stealthWindow: !!stealthWindow,
        stealthTabsPartition,
        tabs: {},
        sleepingTabs: {},
        activeTabId: null,
        isActiveTabTemporarilyHidden: false,
        /** True while active tab's WebContentsView was removeChildView'd for shell overlays. */
        activeTabViewRemovedForShellOverlay: false,
        /** Native container for tab WebContentsViews and tab-scoped sidebars. */
        tabContentView: null,
        tooltipView: null,
        /** Full-window WebContentsView for Lens selection UI above tab layer. */
        chromeOverlayView: null,
        /** Compact WebContentsView for omnibox autocomplete popup. */
        chromeOmniboxOverlayView: null,
        /** Compact WebContentsView for shell menus (settings, bookmarks, profile). */
        chromeShellMenuOverlayView: null,
        /** Ref-count for Lens overlay acquires (internal, not shell omnibox). */
        chromeOverlayAcquireCount: 0,
        /** Ref-count for chrome-overlay:v1 acquire/release from omnibox. */
        chromeOmniboxOverlayAcquireCount: 0,
        /** Ref-count for chrome-shell-menu-overlay:v1 acquire/release. */
        chromeShellMenuOverlayAcquireCount: 0,
        chromeShellMenuOverlayBlurDismissPending: false,
        chromeOverlayOmniboxMode: false,
        chromeOverlayBlurDismissPending: false,
        lastOmniboxOverlayPatch: null,
        /** True once chromeOmniboxOverlayView HTML/JS has finished loading. */
        chromeOmniboxOverlayReady: false,
        /** Per-tab Google Lens sessions: each tab keeps its sidebar WebContentsView and sizing. */
        lensSessions: new Map(),
        lensOverlayBounds: null,
        chromeOverlayFullWindowMode: false,
    };
    windowContextsById.set(window.id, context);
    createTabContentContainer(context);
    appLogger.info('window:create', {
        windowId: context.windowId,
        browserWindowId: window.id,
        profileId: context.profileId,
        stealthWindow: context.stealthWindow,
        partition,
    });

    if (stealthWindow) {
        window.setTitle('InviSurf — Stealth');
        windowBootstrapById.set(context.windowId, { stealthWindow: true });
    }

    window.on('resize', () => {
        layoutTabContentContainer(context);
        if (!context.activeTabId || detachedTabWindows.has(context.activeTabId)) return;
        const view = context.tabs[context.activeTabId];
        if (!view) return;
        if (context.isActiveTabTemporarilyHidden) {
            if (!context.activeTabViewRemovedForShellOverlay) {
                view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            }
            return;
        }
        layoutActiveTabView(context, context.activeTabId);
        if (getLensSession(context, context.activeTabId, false)?.selectionActive) {
            postLensSelectionPatch(context);
        }
        if ((context.chromeOmniboxOverlayAcquireCount || 0) > 0 && context.lastOmniboxOverlayPatch) {
            layoutOmniboxOverlayBounds(context, context.lastOmniboxOverlayPatch);
        }
        ensureChromeOverlayOnTop(context);
    });

    window.on('close', () => {
        const windowSnapshot = captureClosedWindowSnapshot(context);
        appLogger.info('window:close', {
            windowId: context.windowId,
            profileId: context.profileId,
            stealthWindow: context.stealthWindow,
            tabCount: Object.keys(context.tabs).length + Object.keys(context.sleepingTabs).length,
            capturedRecentlyClosedTabs: windowSnapshot?.tabs?.length || 0,
        });
        if (windowSnapshot) {
            pushRecentlyClosedEntry(context.profileId, windowSnapshot);
        }

        // Destroy all tab WebContentsViews before the parent window is torn down.
        // On Windows, leaving live child views attached when the native window handle
        // is destroyed causes a native (C++) crash.
        for (const tabId of Object.keys(context.tabs)) {
            const view = context.tabs[tabId];
            removeTabContentChildView(context, view);
            try { if (!view.webContents.isDestroyed()) view.webContents.destroy(); } catch (_) { }
        }
        context.tabs = {};
        context.activeTabId = null;

        if (context.tooltipView) {
            try { context.window.contentView.removeChildView(context.tooltipView); } catch (_) { }
            try { if (!context.tooltipView.webContents.isDestroyed()) context.tooltipView.webContents.destroy(); } catch (_) { }
            context.tooltipView = null;
        }
        if (context.chromeOverlayView) {
            try { context.window.contentView.removeChildView(context.chromeOverlayView); } catch (_) { }
            try {
                if (!context.chromeOverlayView.webContents.isDestroyed()) context.chromeOverlayView.webContents.destroy();
            } catch (_) { }
            context.chromeOverlayView = null;
        }
        if (context.chromeOmniboxOverlayView) {
            try { context.window.contentView.removeChildView(context.chromeOmniboxOverlayView); } catch (_) { }
            try {
                if (!context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
                    context.chromeOmniboxOverlayView.webContents.destroy();
                }
            } catch (_) { }
            context.chromeOmniboxOverlayView = null;
        }
        if (context.chromeShellMenuOverlayView) {
            try { context.window.contentView.removeChildView(context.chromeShellMenuOverlayView); } catch (_) { }
            try {
                if (!context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
                    context.chromeShellMenuOverlayView.webContents.destroy();
                }
            } catch (_) { }
            context.chromeShellMenuOverlayView = null;
        }
        if (context.lensSessions) {
            for (const sessionState of context.lensSessions.values()) {
                const sidebarView = sessionState?.sidebarView;
                if (!sidebarView) continue;
                removeTabContentChildView(context, sessionState.sidebarHostView || sidebarView);
                try {
                    if (sessionState.sidebarHostView) {
                        try { sessionState.sidebarHostView.removeChildView(sidebarView); } catch (_) { }
                    }
                    if (!sidebarView.webContents.isDestroyed()) sidebarView.webContents.destroy();
                } catch (_) { }
            }
            context.lensSessions.clear();
        }
        if (context.tabContentView) {
            try { context.window.contentView.removeChildView(context.tabContentView); } catch (_) { }
            context.tabContentView = null;
        }
        context.chromeOverlayAcquireCount = 0;
        context.chromeOmniboxOverlayAcquireCount = 0;
        context.chromeShellMenuOverlayAcquireCount = 0;
    });

    window.on('closed', () => {
        appLogger.info('window:closed', {
            windowId: context.windowId,
            profileId: context.profileId,
            browserWindowId: window.id,
        });
        windowContextsById.delete(window.id);
        windowBootstrapById.delete(context.windowId);
        const profileStillOpen = Array.from(windowContextsById.values()).some(
            (ctx) => ctx?.profileId === context.profileId,
        );
        if (context.stealthWindow) {
            cleanupStealthCookiesForContext(context).catch((error) => {
                appLogger.warn('cookies:stealth-cleanup-failed', {
                    profileId: context.profileId,
                    windowId: context.windowId,
                    error: appLogger.serializeError(error),
                });
            });
        }
        if (!profileStillOpen) {
            cleanupSessionOnlyCookiesForProfile(context.profileId).catch((error) => {
                appLogger.warn('cookies:session-only-cleanup-failed', {
                    profileId: context.profileId,
                    error: appLogger.serializeError(error),
                });
            });
        }
        if (mainWindow === window) {
            mainWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) || null;
        }
    });

    createChromeOverlayLayer(context);
    createChromeShellMenuOverlayLayer(context);
    createChromeOmniboxOverlayLayer(context);
    createTooltipOverlay(context);
    ensureChromeOverlayOnTop(context);
    return context;
}

function createProfilePickerWindow() {
    if (profilePickerWindow && !profilePickerWindow.isDestroyed()) {
        profilePickerWindow.show();
        profilePickerWindow.focus();
        return;
    }
    const workArea = electron.screen.getPrimaryDisplay().workArea;
    const picker = new BrowserWindow({
        x: workArea.x,
        y: workArea.y,
        width: workArea.width,
        height: workArea.height,
        minWidth: 360,
        minHeight: 400,
        title: 'Choose profile',
        titleBarStyle: 'default',
        fullscreen: false,
        webPreferences: buildSecureWebPreferences(),
    });
    applyProfilePickerSecurity(picker, loadSettings().contentProtection);
    applyIdentityToWebContents(picker.webContents);
    picker.loadURL('app://dist/profile-picker.html').catch((error) => {
        console.error('Failed to load profile picker:', error);
    });
    profilePickerWindow = picker;
    picker.on('closed', () => {
        profilePickerWindow = null;
        if (windowContextsById.size === 0 && process.platform !== C.PLATFORM.DARWIN) {
            app.quit();
        }
    });
}

function layoutTabContentContainer(context) {
    if (!context?.tabContentView || !context?.window || context.window.isDestroyed()) return;
    try {
        const { width, height } = context.window.getContentBounds();
        context.tabContentView.setBounds({ x: 0, y: 0, width, height });
        if (typeof context.tabContentView.setBackgroundColor === 'function') {
            context.tabContentView.setBackgroundColor(getChromeShellBackgroundColor(context));
        }
    } catch (_) { }
}

function createTabContentContainer(context) {
    if (!context?.window?.contentView || typeof View !== 'function') return null;
    try {
        const container = new View();
        context.window.contentView.addChildView(container);
        context.tabContentView = container;
        layoutTabContentContainer(context);
        return container;
    } catch (error) {
        console.warn('tab-content-container unavailable:', error?.message || error);
        context.tabContentView = null;
        return null;
    }
}

function getTabContentParent(context) {
    return context?.tabContentView || context?.window?.contentView || null;
}

function setNativeViewCornerRadius(view, radius) {
    try {
        if (view && typeof view.setBorderRadius === 'function') {
            view.setBorderRadius(radius);
        }
    } catch (_) { }
}

function addTabContentChildView(context, view) {
    if (!view) return false;
    const parent = getTabContentParent(context);
    if (!parent || typeof parent.addChildView !== 'function') return false;
    try {
        parent.addChildView(view);
        return true;
    } catch (_) {
        if (parent !== context?.window?.contentView && context?.window?.contentView) {
            try {
                context.window.contentView.addChildView(view);
                return true;
            } catch (_) { }
        }
        return false;
    }
}

function removeTabContentChildView(context, view) {
    if (!view) return false;
    const parent = getTabContentParent(context);
    if (parent && typeof parent.removeChildView === 'function') {
        try {
            parent.removeChildView(view);
            return true;
        } catch (_) { }
    }
    if (parent !== context?.window?.contentView && context?.window?.contentView) {
        try {
            context.window.contentView.removeChildView(view);
            return true;
        } catch (_) { }
    }
    return false;
}

function createChromeOverlayLayer(context) {
    if (context.chromeOverlayView) return;
    const overlayView = new WebContentsView({
        webPreferences: buildSecureWebPreferences(),
    });
    applyIdentityToWebContents(overlayView.webContents);
    overlayView.setBackgroundColor('#00000000');
    overlayView.webContents.once('did-finish-load', () => {
        sendChromeOverlayThemePatch(context);
    });
    overlayView.webContents.loadURL('app://localhost/chrome-overlay.html').catch((err) => {
        console.error('chrome-overlay load', err);
    });
    context.window.contentView.addChildView(overlayView);
    overlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    context.chromeOverlayView = overlayView;
}

function createChromeOmniboxOverlayLayer(context) {
    if (context.chromeOmniboxOverlayView) return;
    context.chromeOmniboxOverlayReady = false;
    const overlayView = new WebContentsView({
        webPreferences: buildSecureWebPreferences(),
    });
    applyIdentityToWebContents(overlayView.webContents);
    overlayView.setBackgroundColor('#00000000');
    overlayView.webContents.once('did-finish-load', () => {
        context.chromeOmniboxOverlayReady = true;
        sendChromeOmniboxOverlayThemePatch(context);
        replayOmniboxOverlayPatchIfNeeded(context);
    });
    overlayView.webContents.on('blur', () => {
        dismissOmniboxChromeOverlayOnBlur(context);
    });
    overlayView.webContents.loadURL('app://localhost/chrome-overlay.html?omnibox=1').catch((err) => {
        console.error('chrome-omnibox-overlay load', err);
    });
    context.window.contentView.addChildView(overlayView);
    overlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    context.chromeOmniboxOverlayView = overlayView;
}

function createChromeShellMenuOverlayLayer(context) {
    if (context.chromeShellMenuOverlayView) return;
    const overlayView = new WebContentsView({
        webPreferences: buildSecureWebPreferences(),
    });
    applyIdentityToWebContents(overlayView.webContents);
    overlayView.setBackgroundColor('#00000000');
    overlayView.webContents.once('did-finish-load', () => {
        sendChromeShellMenuOverlayThemePatch(context);
    });
    overlayView.webContents.on('blur', () => {
        dismissChromeShellMenuOverlayOnBlur(context);
    });
    overlayView.webContents.loadURL('app://localhost/chrome-overlay.html?shellMenu=1').catch((err) => {
        console.error('chrome-shell-menu-overlay load', err);
    });
    context.window.contentView.addChildView(overlayView);
    overlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    context.chromeShellMenuOverlayView = overlayView;
}

/**
 * Tab WebContentsView stays below chrome overlay; Lens sidebar stays above overlay
 * so Google Lens results remain clickable/scrollable; tooltip stays topmost.
 * Call after tab attach/detach and whenever z-order may have changed.
 */
function ensureChromeOverlayOnTop(context) {
    if (!context?.window?.contentView) return;
    const cv = context.window.contentView;
    const activeId = context.activeTabId;
    const tabView =
        activeId && !detachedTabWindows.has(activeId) ? context.tabs[activeId] : null;
    const lensSession = getLensSession(context, activeId, false);
    try {
        if (context.tabContentView) {
            layoutTabContentContainer(context);
            cv.addChildView(context.tabContentView);
        }
        if (tabView && !tabView.webContents.isDestroyed()) {
            const hideTabForLens =
                lensSession?.selectionActive && context.activeTabViewRemovedForShellOverlay;
            if (!hideTabForLens) {
                addTabContentChildView(context, tabView);
            }
        }
        if (context.chromeOverlayView && !context.chromeOverlayView.webContents.isDestroyed()) {
            cv.addChildView(context.chromeOverlayView);
        }
        if (context.chromeOmniboxOverlayView && !context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
            cv.addChildView(context.chromeOmniboxOverlayView);
        }
        if (context.chromeShellMenuOverlayView && !context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
            cv.addChildView(context.chromeShellMenuOverlayView);
        }
        if (lensSession?.selectionActive && lensSession.sidebarView && !lensSession.sidebarView.webContents.isDestroyed()) {
            addTabContentChildView(context, lensSession.sidebarHostView || lensSession.sidebarView);
        }
        if (context.tooltipView && !context.tooltipView.webContents.isDestroyed()) {
            cv.addChildView(context.tooltipView);
        }
    } catch (err) {
        console.error('ensureChromeOverlayOnTop', err?.message || err);
    }
}

function getLensSession(context, tabId = context?.activeTabId, create = false) {
    if (!context || !tabId) return null;
    if (!context.lensSessions) context.lensSessions = new Map();
    let sessionState = context.lensSessions.get(tabId);
    if (!sessionState && create) {
        sessionState = {
            tabId,
            sidebarHostView: null,
            sidebarView: null,
            sidebarWidth: null,
            selectionActive: false,
            overlayAcquired: false,
            siteBounds: null,
            lastSelection: null,
            lastSelectionRatio: null,
            lastSelectionText: '',
            lastSelectionImage: null,
            textSnapshot: null,
            pageZoomFactorBeforeLens: null,
            pageScale: 1,
            sourceWidth: null,
            sourceHeight: null,
            magnifierImage: null,
        };
        context.lensSessions.set(tabId, sessionState);
    }
    return sessionState || null;
}

function isViewWebContentsAlive(view) {
    const wc = view?.webContents;
    return !!(wc && typeof wc.isDestroyed === 'function' && !wc.isDestroyed());
}

function destroyLensSidebarViews(context, lensSession) {
    if (!lensSession) return;
    const sidebarView = lensSession.sidebarView;
    if (sidebarView) {
        removeTabContentChildView(context, lensSession.sidebarHostView || sidebarView);
        const wc = sidebarView.webContents;
        if (wc && typeof wc.isDestroyed === 'function' && !wc.isDestroyed()) {
            try { wc.removeAllListeners(); } catch (_) { }
            try {
                if (wc.debugger?.isAttached?.()) wc.debugger.detach();
            } catch (_) { }
            try { wc.destroy(); } catch (_) { }
        }
        lensSession.sidebarView = null;
    }
    const hostView = lensSession.sidebarHostView;
    if (hostView) {
        try {
            if (sidebarView) hostView.removeChildView(sidebarView);
        } catch (_) { }
        lensSession.sidebarHostView = null;
    }
}

function suspendLensSessionPresentation(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    if (!context || !tabId || !lensSession?.selectionActive) return false;

    if (lensSession.sidebarView) {
        removeTabContentChildView(context, lensSession.sidebarHostView || lensSession.sidebarView);
    }

    if (lensSession.overlayAcquired && context.chromeOverlayAcquireCount > 0) {
        context.chromeOverlayAcquireCount -= 1;
    }
    lensSession.overlayAcquired = false;
    repairLensChromeOverlayAcquireCount(context);

    if ((context.chromeOverlayAcquireCount || 0) <= 0 && isViewWebContentsAlive(context.chromeOverlayView)) {
        try {
            context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
            context.chromeOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } catch (_) { }
    }

    if (context.activeTabId === tabId) {
        context.lensOverlayBounds = null;
        context.chromeOverlayFullWindowMode = false;
        context.isActiveTabTemporarilyHidden = false;
        context.activeTabViewRemovedForShellOverlay = false;
    }
    return true;
}

function getFirstActiveLensTabId(context) {
    if (!context?.lensSessions) return null;
    for (const [tabId, sessionState] of context.lensSessions.entries()) {
        if (!sessionState?.selectionActive) continue;
        const view = context.tabs[tabId];
        if (view && !view.webContents.isDestroyed()) return tabId;
    }
    return null;
}

function findActiveLensTabForProfile(profileId) {
    if (!profileId) return null;
    for (const context of windowContextsById.values()) {
        if (!context || context.profileId !== profileId) continue;
        const tabId = getFirstActiveLensTabId(context);
        if (tabId) return { context, tabId };
    }
    return null;
}

function countLensOverlayAcquires(context) {
    if (!context?.lensSessions) return 0;
    let required = 0;
    for (const sessionState of context.lensSessions.values()) {
        if (sessionState?.selectionActive && sessionState.overlayAcquired) required += 1;
    }
    return required;
}

function repairLensChromeOverlayAcquireCount(context) {
    const required = countLensOverlayAcquires(context);
    if (required > 0 && (context.chromeOverlayAcquireCount || 0) < required) {
        context.chromeOverlayAcquireCount = required;
    }
}

function layoutChromeOverlayFullWindowBounds(context) {
    if (!context?.chromeOverlayView || context.chromeOverlayView.webContents.isDestroyed()) return null;
    if ((context.chromeOverlayAcquireCount || 0) <= 0) return null;
    context.chromeOverlayFullWindowMode = true;
    const { width, height } = context.window.getContentBounds();
    const bounds = { x: 0, y: 0, width, height };
    try {
        context.chromeOverlayView.setBounds(bounds);
        return bounds;
    } catch (err) {
        console.error('layoutChromeOverlayFullWindowBounds', err?.message || err);
        return null;
    }
}

function restoreLensOverlayAfterShellDismiss(context) {
    if (!context?.activeTabId) return;
    if (!getLensSession(context, context.activeTabId, false)?.selectionActive) return;
    context.chromeOverlayFullWindowMode = false;
    setImmediate(() => {
        if (!context?.activeTabId) return;
        if (!getLensSession(context, context.activeTabId, false)?.selectionActive) return;
        if (context.chromeOverlayOmniboxMode) return;
        restoreActiveLensTabPresentation(context, context.activeTabId);
    });
}

function ensureLensOverlayAcquired(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.selectionActive) return;
    createChromeOverlayLayer(context);
    if (!lensSession.overlayAcquired) {
        context.chromeOverlayAcquireCount = (context.chromeOverlayAcquireCount || 0) + 1;
        lensSession.overlayAcquired = true;
    } else if ((context.chromeOverlayAcquireCount || 0) <= 0) {
        context.chromeOverlayAcquireCount = 1;
    }
}

function restoreActiveLensTabPresentation(context, tabId = context?.activeTabId) {
    if (!context || !tabId) return false;
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.selectionActive) return false;
    hideActiveTabViewForShellOverlay(context);
    layoutActiveTabView(context, tabId);
    layoutLensSidebar(context, tabId);
    ensureLensOverlayAcquired(context, tabId);
    repairLensChromeOverlayAcquireCount(context);
    return postLensSelectionPatch(context);
}

function getLensSidebarWidth(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.selectionActive || !lensSession.sidebarView || lensSession.sidebarView.webContents.isDestroyed()) return 0;
    const { width } = context.window.getContentBounds();
    const maxWidth = Math.max(220, Math.floor(width * LENS_SIDEBAR_MAX_RATIO));
    const minWidth = Math.min(LENS_SIDEBAR_MIN_WIDTH, maxWidth);
    const preferredWidth = lensSession.sidebarWidth || Math.floor(width * LENS_SIDEBAR_DEFAULT_RATIO);
    return Math.max(minWidth, Math.min(preferredWidth, maxWidth));
}

function getLensLayoutMetrics(context, tabId = context?.activeTabId) {
    if (!context?.window || context.window.isDestroyed()) return null;
    const { width, height } = context.window.getContentBounds();
    const fs = htmlFullscreenTabId === tabId;
    const sidebarWidth = fs ? 0 : getLensSidebarWidth(context, tabId);
    const contentTop = fs ? 0 : UI_HEIGHT;
    const contentHeight = fs ? height : Math.max(0, height - UI_HEIGHT);
    const panelGap = fs || sidebarWidth <= 0 ? 0 : LENS_PANEL_GAP;
    const sidebarBounds = sidebarWidth > 0 ? {
        x: Math.max(panelGap, width - sidebarWidth - panelGap),
        y: contentTop + panelGap,
        width: Math.max(0, sidebarWidth),
        height: Math.max(0, contentHeight - (panelGap * 2)),
    } : { x: width, y: contentTop, width: 0, height: contentHeight };
    const leftPanelBounds = sidebarWidth > 0 ? {
        x: panelGap,
        y: contentTop + panelGap,
        width: Math.max(0, sidebarBounds.x - (panelGap * 2)),
        height: Math.max(0, contentHeight - (panelGap * 2)),
    } : {
        x: 0,
        y: contentTop,
        width,
        height: contentHeight,
    };

    return { width, height, fs, sidebarWidth, panelGap, contentTop, contentHeight, sidebarBounds, leftPanelBounds };
}

/** Lens selection UI only covers the left workspace; sidebar stays native-interactive. */
function computeLensChromeOverlayBounds(context, tabId = context?.activeTabId) {
    const { width, height } = context.window.getContentBounds();
    const metrics = getLensLayoutMetrics(context, tabId);
    if (!metrics || metrics.sidebarWidth <= 0) {
        return {
            x: 0,
            y: UI_HEIGHT,
            width,
            height: Math.max(0, height - UI_HEIGHT),
        };
    }
    return {
        x: 0,
        y: metrics.contentTop,
        width: Math.max(0, metrics.sidebarBounds.x),
        height: metrics.contentHeight,
    };
}

function getActiveTabContentBounds(context, tabId = context?.activeTabId) {
    if (!context?.window || context.window.isDestroyed()) return { x: 0, y: UI_HEIGHT, width: 0, height: 0 };
    const metrics = getLensLayoutMetrics(context, tabId);
    if (!metrics) return { x: 0, y: UI_HEIGHT, width: 0, height: 0 };
    const lensSession = getLensSession(context, tabId, false);
    if (lensSession?.selectionActive && !metrics.fs) {
        const leftPanel = metrics.leftPanelBounds;
        const maxContainerWidth = Math.max(1, leftPanel.width - (LENS_WORKSPACE_PADDING * 2));
        const maxContainerHeight = Math.max(1, leftPanel.height - (LENS_WORKSPACE_PADDING * 2));
        const sourceWidth = Math.max(1, Math.round(lensSession.sourceWidth || metrics.width));
        const sourceHeight = Math.max(1, Math.round(lensSession.sourceHeight || metrics.contentHeight));
        const scale = Math.max(
            LENS_PAGE_MIN_SCALE,
            Math.min(
                LENS_SITE_CONTAINER_MAX_SCALE,
                maxContainerWidth / sourceWidth,
                maxContainerHeight / sourceHeight,
            ),
        );
        const containerWidth = Math.floor(sourceWidth * scale);
        const containerHeight = Math.floor(sourceHeight * scale);
        const bounds = {
            x: leftPanel.x + Math.max(0, Math.floor((leftPanel.width - containerWidth) / 2)),
            y: leftPanel.y + Math.max(0, Math.floor((leftPanel.height - containerHeight) / 2)),
            width: Math.max(1, Math.min(containerWidth, maxContainerWidth)),
            height: Math.max(1, Math.min(containerHeight, maxContainerHeight)),
        };
        lensSession.siteBounds = bounds;
        lensSession.pageScale = scale;
        return bounds;
    }
    if (lensSession) {
        lensSession.siteBounds = null;
        lensSession.pageScale = 1;
    }
    return {
        x: 0,
        y: metrics.fs ? 0 : UI_HEIGHT,
        width: Math.max(0, metrics.width - metrics.sidebarWidth),
        height: metrics.contentHeight,
    };
}

function resetTabWebContentsScale(view) {
    const webContents = view?.webContents;
    if (!webContents || webContents.isDestroyed()) return;
    try { webContents.setZoomFactor(1); } catch (_) { }
    try { webContents.setZoomLevel(0); } catch (_) { }
    if (typeof webContents.setVisualZoomLevelLimits === 'function') {
        try {
            const result = webContents.setVisualZoomLevelLimits(1, 1);
            if (result && typeof result.catch === 'function') result.catch(() => { });
        } catch (_) { }
    }
}

function applyLensSidebarMobileViewport(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    const sidebarView = lensSession?.sidebarView;
    if (!context?.window || !sidebarView || sidebarView.webContents.isDestroyed()) return;
    try { sidebarView.webContents.setUserAgent(LENS_MOBILE_USER_AGENT); } catch (_) { }
    try { sidebarView.webContents.setZoomFactor(1); } catch (_) { }
}

function layoutLensSidebar(context, tabId = context?.activeTabId) {
    if (tabId !== context?.activeTabId) return;
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.sidebarView || lensSession.sidebarView.webContents.isDestroyed()) return;
    const metrics = getLensLayoutMetrics(context, tabId);
    if (!metrics) return;
    const radius = metrics.sidebarWidth > 0 ? LENS_PANEL_RADIUS : 0;
    const hostView = lensSession.sidebarHostView || lensSession.sidebarView;
    hostView.setBounds(metrics.sidebarBounds);
    setNativeViewCornerRadius(hostView, radius);
    if (typeof hostView.setBackgroundColor === 'function') {
        try { hostView.setBackgroundColor(getChromeShellBackgroundColor(context)); } catch (_) { }
    }
    if (lensSession.sidebarHostView) {
        lensSession.sidebarView.setBounds({
            x: 0,
            y: 0,
            width: Math.max(0, metrics.sidebarBounds.width),
            height: Math.max(0, metrics.sidebarBounds.height),
        });
    } else {
        setNativeViewCornerRadius(lensSession.sidebarView, radius);
    }
    applyLensSidebarMobileViewport(context, tabId);
}

// function layoutActiveTabView(context, tabId = context?.activeTabId) {
//     if (!context || !tabId || detachedTabWindows.has(tabId)) return;
//     const view = context.tabs[tabId];
//     if (!view || view.webContents.isDestroyed()) return;
//     const bounds = getActiveTabContentBounds(context, tabId);
//     const lensSession = getLensSession(context, tabId, false);
//     if (lensSession?.selectionActive) {
//         if (lensSession.pageZoomFactorBeforeLens === null) {
//             try {
//                 if (!view.webContents.isDestroyed()) {
//                     lensSession.pageZoomFactorBeforeLens = view.webContents.getZoomFactor();
//                 }
//             } catch (_) {
//                 lensSession.pageZoomFactorBeforeLens = 1;
//             }
//         }
//         try {
//             if (!view.webContents.isDestroyed()) {
//                 view.webContents.setZoomFactor(lensSession.pageScale || 1);
//             }
//         } catch (_) { }
//     } else if (lensSession && lensSession.pageZoomFactorBeforeLens !== null) {
//         try {
//             if (!view.webContents.isDestroyed()) {
//                 view.webContents.setZoomFactor(lensSession.pageZoomFactorBeforeLens || 1);
//             }
//         } catch (_) { }
//         lensSession.pageZoomFactorBeforeLens = null;
//     }
//     view.setBounds(bounds);
//     setNativeViewCornerRadius(view, lensSession?.selectionActive ? LENS_PANEL_RADIUS : 0);
//     layoutLensSidebar(context, tabId);
// }

function layoutActiveTabView(context, tabId = context?.activeTabId) {
    if (!context || !tabId || detachedTabWindows.has(tabId)) return;
    const view = context.tabs[tabId];
    if (!view || view.webContents.isDestroyed()) return;

    const lensSession = getLensSession(context, tabId, false);

    if (lensSession?.selectionActive) {
        // Keep the live view hidden/collapsed during selection
        try {
            view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } catch (_) { }
    } else {
        // Restore standard bounds on exit
        resetTabWebContentsScale(view);
        const bounds = getActiveTabContentBounds(context, tabId);
        view.setBounds(bounds);
        setNativeViewCornerRadius(view, 0);
    }

    layoutLensSidebar(context, tabId);
}

function detachLensSidebarsExcept(context, activeTabId) {
    if (!context?.lensSessions) return;
    for (const [tabId, sessionState] of context.lensSessions.entries()) {
        const sidebarView = sessionState?.sidebarView;
        if (!sidebarView || sidebarView.webContents.isDestroyed()) continue;
        if (tabId === activeTabId) continue;
        removeTabContentChildView(context, sessionState.sidebarHostView || sidebarView);
    }
}

function destroyLensSession(context, tabId) {
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession) return;
    if (lensSession.overlayAcquired && context.chromeOverlayAcquireCount > 0) {
        context.chromeOverlayAcquireCount -= 1;
    }
    destroyLensSidebarViews(context, lensSession);
    context.lensSessions.delete(tabId);
    repairLensChromeOverlayAcquireCount(context);
    const remainingLensTabId = getFirstActiveLensTabId(context);
    if (!remainingLensTabId && isViewWebContentsAlive(context.chromeOverlayView)) {
        context.chromeOverlayFullWindowMode = false;
        try {
            context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
            if (context.chromeOverlayAcquireCount <= 0) {
                context.chromeOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            }
        } catch (_) { }
    } else if (
        context.activeTabId &&
        context.activeTabId === remainingLensTabId &&
        getLensSession(context, context.activeTabId, false)?.selectionActive
    ) {
        restoreActiveLensTabPresentation(context, context.activeTabId);
    }
}

function injectLensSidebarCloseButton(context, tabId) {
    const lensSession = getLensSession(context, tabId, false);
    const sidebarView = lensSession?.sidebarView;
    if (!isViewWebContentsAlive(sidebarView)) return;
    const background = getChromeShellBackgroundColor(context);
    const gutterMaskHeight = Math.max(10, Math.min(18, LENS_PANEL_RADIUS - 6));
    const script = `
        (() => {
            const style = document.getElementById('invisurf-lens-panel-style') || document.createElement('style');
            style.id = 'invisurf-lens-panel-style';
            style.textContent = \`
                html {
                    background: ${background} !important;
                }
                body {
                    min-height: 100vh;
                    margin: 0 !important;
                    overflow-x: hidden !important;
                    background: ${background} !important;
                }
                #invisurf-lens-panel-border {
                    position: fixed !important;
                    inset: 0 !important;
                    z-index: 2147483646 !important;
                    border: 1px solid rgba(95, 99, 104, 0.24) !important;
                    border-radius: ${LENS_PANEL_RADIUS}px !important;
                    box-sizing: border-box !important;
                    pointer-events: none !important;
                }
                .invisurf-lens-gutter-mask {
                    position: fixed !important;
                    left: 0 !important;
                    right: 0 !important;
                    height: ${gutterMaskHeight}px !important;
                    z-index: 2147483645 !important;
                    background: ${background} !important;
                    pointer-events: none !important;
                }
                #invisurf-lens-gutter-mask-top {
                    top: 0 !important;
                }
                #invisurf-lens-gutter-mask-bottom {
                    bottom: 0 !important;
                }
                body::-webkit-scrollbar {
                    width: 10px;
                }
            \`;
            if (!style.parentNode) document.head.appendChild(style);
            document.documentElement.style.backgroundColor = ${JSON.stringify(background)};
            if (document.body) document.body.style.backgroundColor = ${JSON.stringify(background)};
            const ensureMask = (id) => {
                let mask = document.getElementById(id);
                if (!mask) {
                    mask = document.createElement('div');
                    mask.id = id;
                    mask.className = 'invisurf-lens-gutter-mask';
                    document.documentElement.appendChild(mask);
                }
                return mask;
            };
            ensureMask('invisurf-lens-gutter-mask-top');
            ensureMask('invisurf-lens-gutter-mask-bottom');
            let border = document.getElementById('invisurf-lens-panel-border');
            if (!border) {
                border = document.createElement('div');
                border.id = 'invisurf-lens-panel-border';
                document.documentElement.appendChild(border);
            }
            if (document.getElementById('invisurf-lens-close')) return;
            const meta = document.querySelector('meta[name="viewport"]') || document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
            if (!meta.parentNode) document.head.appendChild(meta);
            const style = document.createElement('style');
            style.id = 'invisurf-lens-mobile-style';
            style.textContent = 'html,body{max-width:100vw!important;overflow-x:hidden!important;}';
            document.head.appendChild(style);
            const btn = document.createElement('button');
            btn.id = 'invisurf-lens-close';
            btn.type = 'button';
            btn.textContent = '×';
            btn.title = 'Close Google Lens';
            btn.setAttribute('aria-label', 'Close Google Lens');
            Object.assign(btn.style, {
                position: 'fixed',
                top: '8px',
                right: '8px',
                zIndex: '2147483647',
                width: '28px',
                height: '28px',
                border: '0',
                borderRadius: '999px',
                background: 'rgba(60,64,67,.9)',
                color: '#fff',
                font: '20px/28px system-ui, sans-serif',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,.22)',
            });
            btn.addEventListener('click', () => {
                window.location.href = 'invisurf-lens://close';
            });
            document.documentElement.appendChild(btn);
        })();
    `;
    sidebarView.webContents.executeJavaScript(script).catch(() => { });
}

/** Match chrome-overlay.html omnibox panel layout for hit-target sizing. */
function computeOmniboxOverlayBounds(context, patch) {
    const dr = patch?.dropdownRect || {};
    const pad = 8;
    const shadowMargin = 12;
    const { width: windowW, height: windowH } = context.window.getContentBounds();
    let w = Math.round(Number(dr.width) || 320);
    let inputH = Math.round(Number(dr.height) || 34);
    let left = Math.round(Number(dr.left) || 0);
    let top = Math.round(Number(dr.top) || 0);
    w = Math.max(200, Math.min(w, windowW - 2 * pad));
    left = Math.max(pad, Math.min(left, windowW - w - pad));
    top = Math.max(pad, Math.min(top, windowH - 120 - pad));

    const items = Array.isArray(patch?.items) ? patch.items.slice(0, 24) : [];
    const rowHeight = 50;
    const scrollPad = 6;
    const maxScrollH = Math.min(412, Math.floor(windowH * 0.7));
    let scrollH = 0;
    if (items.length > 0) {
        scrollH = Math.min(items.length * rowHeight, maxScrollH);
    } else if (String(patch?.query || '').trim()) {
        scrollH = 36;
    }
    const panelH = inputH + scrollPad + scrollH;
    const panelHeight = Math.min(panelH, windowH - top - pad);
    const x = Math.max(0, left - shadowMargin);
    const y = Math.max(0, top - shadowMargin);
    const width = Math.min(windowW - x, w + (left - x) + shadowMargin);
    const height = Math.min(windowH - y, panelHeight + (top - y) + shadowMargin);
    return {
        x,
        y,
        width,
        height: Math.max(inputH + (top - y), height),
    };
}

function clampNumber(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function estimateMenuRowsHeight(items, rowHeight = 38, separatorHeight = 13, padding = 12) {
    if (!Array.isArray(items) || items.length === 0) return padding;
    return items.reduce((sum, item) => (
        sum + (item?.type === 'separator' ? separatorHeight : rowHeight)
    ), padding);
}

function menuOverlayBoundsFromPanel(context, panelRect, options = {}) {
    const pad = 8;
    const shadowMargin = Number.isFinite(Number(options.shadowMargin))
        ? Number(options.shadowMargin)
        : 16;
    const { width: windowW, height: windowH } = context.window.getContentBounds();
    const panelLeft = clampNumber(Math.round(Number(panelRect.left) || 0), pad, windowW - pad);
    const panelTop = clampNumber(Math.round(Number(panelRect.top) || 0), pad, windowH - pad);
    const panelWidth = Math.max(1, Math.round(Number(panelRect.width) || 1));
    const panelHeight = Math.max(1, Math.round(Number(panelRect.height) || 1));
    const extraLeft = Math.max(0, Math.round(Number(options.extraLeft) || 0));
    const extraRight = Math.max(0, Math.round(Number(options.extraRight) || 0));
    const extraTop = Math.max(0, Math.round(Number(options.extraTop) || 0));
    const extraBottom = Math.max(0, Math.round(Number(options.extraBottom) || 0));

    const wantedLeft = panelLeft - extraLeft - shadowMargin;
    const wantedTop = panelTop - extraTop - shadowMargin;
    const wantedRight = panelLeft + panelWidth + extraRight + shadowMargin;
    const wantedBottom = panelTop + panelHeight + extraBottom + shadowMargin;
    const x = Math.max(0, Math.min(windowW - 1, wantedLeft));
    const y = Math.max(0, Math.min(windowH - 1, wantedTop));
    const right = Math.max(x + 1, Math.min(windowW, wantedRight));
    const bottom = Math.max(y + 1, Math.min(windowH, wantedBottom));

    return {
        x,
        y,
        width: Math.max(1, right - x),
        height: Math.max(1, bottom - y),
        viewportWidth: windowW,
        viewportHeight: windowH,
    };
}

function computeMenuOverlayBounds(context, patch) {
    const pad = 8;
    const { width: windowW, height: windowH } = context.window.getContentBounds();
    const kind = patch?.kind;

    if (kind === 'bookmarkContextMenu') {
        const menuWidth = 220;
        const fixedHeight = 290;
        const left = clampNumber(Math.round(Number(patch.clientX) || 0), pad, windowW - menuWidth - pad);
        const top = clampNumber(Math.round(Number(patch.clientY) || 0), pad, windowH - fixedHeight - pad);
        return menuOverlayBoundsFromPanel(context, { left, top, width: menuWidth, height: fixedHeight });
    }

    if (kind === 'bookmarkFolderMenu') {
        const ar = patch.anchorRect || {};
        const minW = 240;
        const maxW = 420;
        let width = Math.round(Number(ar.width) || 280);
        width = clampNumber(width, minW, maxW);
        const left = clampNumber(Math.round(Number(ar.left) || 0), pad, windowW - width - pad);
        const top = clampNumber(
            Math.round(Number(ar.top) || 0) + Math.round(Number(ar.height) || 0) + 4,
            pad,
            windowH - 80 - pad,
        );
        const items = Array.isArray(patch.items) ? patch.items.slice(0, 400) : [];
        const maxH = Math.max(100, Math.min(windowH * 0.9, windowH - top - pad));
        const listHeight = items.length === 0 ? 56 : Math.min(items.length * 36 + 8, maxH - 40);
        const height = Math.min(maxH, 40 + Math.max(56, listHeight));
        return menuOverlayBoundsFromPanel(context, { left, top, width, height });
    }

    if (kind === 'bookmarkEditor') {
        const ar = patch.anchorRect || {};
        const panelWidth = Math.min(340, Math.max(280, windowW - 16));
        const left0 = Math.round(Number(ar.left) || 0);
        const top0 = Math.round(Number(ar.top) || 0);
        const w0 = Math.max(1, Math.round(Number(ar.width) || 32));
        const h0 = Math.max(1, Math.round(Number(ar.height) || 32));
        const left = clampNumber(left0 + w0 - panelWidth, pad, windowW - panelWidth - pad);
        const top = clampNumber(top0 + h0 + 6, pad, windowH - 280 - pad);
        const height = Math.min(480, windowH - top - pad);
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height });
    }

    if (kind === 'profileMenu') {
        const r = patch.menuRect || {};
        const width = Math.round(Number(r.width) || 260);
        const left = clampNumber(Math.round(Number(r.left) || 0), pad, windowW - width - pad);
        const top = clampNumber(Math.round(Number(r.top) || 0), pad, windowH - 80 - pad);
        const items = Array.isArray(patch.items) ? patch.items : [];
        const rows = items.length + 1 + (patch.showEdit ? 1 : 0);
        const separators = 1 + (patch.showEdit ? 1 : 0);
        const height = Math.min(windowH - top - pad, rows * 42 + separators * 13 + 16);
        return menuOverlayBoundsFromPanel(context, { left, top, width, height });
    }

    if (kind === 'siteInfo') {
        const ar = patch.anchorRect || {};
        const panelWidth = 340;
        const left0 = Math.round(Number(ar.left) || 0);
        const top0 = Math.round(Number(ar.top) || 0);
        const h0 = Math.max(1, Math.round(Number(ar.height) || 32));
        const left = clampNumber(left0, pad, windowW - panelWidth - pad);
        const top = clampNumber(top0 + h0 + 6, pad, windowH - 280 - pad);
        const height = Math.max(240, Math.min(windowH * 0.6, windowH - top - pad));
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height });
    }

    if (kind === 'cookieControls' || kind === 'downloadPanel') {
        const ar = patch.anchorRect || {};
        const panelWidth = kind === 'cookieControls' ? 340 : 300;
        const left0 = Math.round(Number(ar.left) || 0);
        const top0 = Math.round(Number(ar.top) || 0);
        const h0 = Math.max(1, Math.round(Number(ar.height) || 32));
        const left = clampNumber(left0, pad, windowW - panelWidth - pad);
        const top = clampNumber(top0 + h0 + 6, pad, windowH - 220 - pad);
        const height = Math.max(160, Math.min(windowH * 0.45, windowH - top - pad));
        return menuOverlayBoundsFromPanel(context, { left, top, width: panelWidth, height });
    }

    if (kind === 'appMenu') {
        const r = patch.menuRect || {};
        const width = Math.round(Number(r.width) || 320);
        const left = clampNumber(Math.round(Number(r.left) || 0), pad, windowW - width - pad);
        const top = clampNumber(Math.round(Number(r.top) || 0), pad, windowH - 80 - pad);
        const items = Array.isArray(patch.items) ? patch.items : [];
        const submenus = patch.submenus && typeof patch.submenus === 'object' ? patch.submenus : {};
        const submenuHeight = Object.values(submenus).reduce((maxHeight, submenuItems) => (
            Math.max(maxHeight, estimateMenuRowsHeight(submenuItems, 42, 13, 20))
        ), 0);
        const estimatedHeight = Math.max(
            240,
            estimateMenuRowsHeight(items, 42, 13, 20),
            Math.min(420, submenuHeight),
        );
        const height = Math.min(windowH - top - pad, estimatedHeight);
        const submenuWidth = items.reduce((maxWidth, item) => {
            if (!item?.submenuKey || !Array.isArray(submenus[item.submenuKey])) return maxWidth;
            return Math.max(maxWidth, Math.round(Number(item.submenuWidth) || 320));
        }, 0);
        return menuOverlayBoundsFromPanel(context, {
            left,
            top,
            width,
            height,
        }, {
            extraLeft: submenuWidth ? submenuWidth + 6 : 0,
            extraBottom: submenuWidth ? 16 : 0,
        });
    }

    return null;
}

function layoutChromeOverlayBounds(context, patch) {
    if (!context?.chromeOverlayView || context.chromeOverlayView.webContents.isDestroyed()) return null;
    if (context.chromeOverlayAcquireCount <= 0) return null;
    let bounds;
    if (patch?.kind === 'lensSelection') {
        bounds = context.chromeOverlayFullWindowMode
            ? (() => {
                const { width, height } = context.window.getContentBounds();
                return { x: 0, y: 0, width, height };
            })()
            : computeLensChromeOverlayBounds(context, context.activeTabId);
        context.lensOverlayBounds = bounds;
    } else if (getLensSession(context, context.activeTabId, false)?.selectionActive) {
        bounds = context.chromeOverlayFullWindowMode
            ? (() => {
                const { width, height } = context.window.getContentBounds();
                return { x: 0, y: 0, width, height };
            })()
            : computeLensChromeOverlayBounds(context, context.activeTabId);
        context.lensOverlayBounds = bounds;
    } else {
        context.chromeOverlayFullWindowMode = false;
        const { width, height } = context.window.getContentBounds();
        bounds = { x: 0, y: 0, width, height };
    }
    try {
        context.chromeOverlayView.setBounds(bounds);
        return bounds;
    } catch (err) {
        console.error('layoutChromeOverlayBounds', err?.message || err);
        return null;
    }
}

function layoutOmniboxOverlayBounds(context, patch) {
    if (!context?.chromeOmniboxOverlayView || context.chromeOmniboxOverlayView.webContents.isDestroyed()) return null;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return null;
    const bounds = computeOmniboxOverlayBounds(context, patch);
    try {
        context.chromeOmniboxOverlayView.setBounds(bounds);
        return bounds;
    } catch (err) {
        console.error('layoutOmniboxOverlayBounds', err?.message || err);
        return null;
    }
}

/** Notify shell that omnibox overlay B received a patch (including replay after load). */
function notifyOmniboxOverlayDelivered(context) {
    if (!context?.window?.webContents || context.window.webContents.isDestroyed()) return;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
    try {
        context.window.webContents.send(C.IPC_EVENT.OMNIBOX_OVERLAY_DELIVERED);
    } catch (err) {
        console.error('omnibox-overlay:delivered send', err?.message || err);
    }
}

/** Re-send the last omnibox patch after overlay HTML/JS is ready (IPC listener registered). */
function replayOmniboxOverlayPatchIfNeeded(context) {
    if (!context?.chromeOmniboxOverlayReady) return;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
    const patch = context.lastOmniboxOverlayPatch;
    if (!patch || patch.kind !== 'omniboxSuggestions') return;
    if (!context.chromeOmniboxOverlayView || context.chromeOmniboxOverlayView.webContents.isDestroyed()) return;
    try {
        const replayPatch = { ...patch };
        const overlayBounds = layoutOmniboxOverlayBounds(context, replayPatch);
        if (overlayBounds) replayPatch.overlayBounds = overlayBounds;
        ensureChromeOverlayOnTop(context);
        context.chromeOmniboxOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, replayPatch);
        if (replayPatch.focusInput !== false) {
            setImmediate(() => {
                if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
                focusChromeOmniboxOverlayWebContents(context);
            });
        }
        notifyOmniboxOverlayDelivered(context);
    } catch (err) {
        console.error('replayOmniboxOverlayPatchIfNeeded', err?.message || err);
    }
}

/**
 * Store and deliver an omnibox suggestions patch. When overlay HTML is not ready yet,
 * the patch is queued in lastOmniboxOverlayPatch and replayed on did-finish-load.
 */
function deliverOmniboxOverlayPatch(context, patch) {
    if (!context?.chromeOmniboxOverlayView || context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
        return { ok: false };
    }
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return { ok: false };
    try {
        context.chromeOverlayOmniboxMode = true;
        context.lastOmniboxOverlayPatch = patch;
        const deliverPatch = { ...patch };
        const overlayBounds = layoutOmniboxOverlayBounds(context, deliverPatch);
        if (overlayBounds) deliverPatch.overlayBounds = overlayBounds;
        ensureChromeOverlayOnTop(context);
        if (context.chromeOmniboxOverlayReady) {
            context.chromeOmniboxOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, deliverPatch);
            if (deliverPatch.focusInput !== false) {
                setImmediate(() => {
                    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
                    focusChromeOmniboxOverlayWebContents(context);
                });
            }
            notifyOmniboxOverlayDelivered(context);
        }
    } catch (err) {
        console.error('deliverOmniboxOverlayPatch', err?.message || err);
        return { ok: false };
    }
    return { ok: true, delivered: !!context.chromeOmniboxOverlayReady };
}

/** Move native keyboard focus to the omnibox popup overlay. */
function focusChromeOmniboxOverlayWebContents(context) {
    if (!context?.chromeOmniboxOverlayView || context.chromeOmniboxOverlayView.webContents.isDestroyed()) return;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
    try {
        if (context.window && !context.window.isDestroyed()) context.window.focus();
    } catch (_) { /* ignore */ }
    try {
        context.chromeOmniboxOverlayView.webContents.focus();
    } catch (err) {
        console.error('focusChromeOmniboxOverlayWebContents', err?.message || err);
    }
}

/** @deprecated use focusChromeOmniboxOverlayWebContents for omnibox input */
function focusChromeOverlayWebContents(context) {
    focusChromeOmniboxOverlayWebContents(context);
}

function dismissOmniboxChromeOverlayOnBlur(context) {
    if (!context?.chromeOverlayOmniboxMode) return;
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
    if (context.chromeOverlayBlurDismissPending) return;
    if (!context.window?.webContents || context.window.webContents.isDestroyed()) return;
    context.chromeOverlayBlurDismissPending = true;
    setImmediate(() => {
        try {
            if (!context.chromeOverlayOmniboxMode) return;
            if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return;
            if (!context.window?.webContents || context.window.webContents.isDestroyed()) return;
            context.window.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_HOST, {
                type: 'dismiss',
                reason: 'blur',
            });
        } catch (err) {
            console.error('chrome-overlay:v1:blur-dismiss', err?.message || err);
        } finally {
            setTimeout(() => {
                context.chromeOverlayBlurDismissPending = false;
            }, 0);
        }
    });
}

function dismissChromeShellMenuOverlay(context, reason = 'outside') {
    if (!context?.window?.webContents || context.window.webContents.isDestroyed()) return;
    if ((context.chromeShellMenuOverlayAcquireCount || 0) <= 0) return;
    try {
        context.window.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_HOST, {
            type: 'dismiss',
            reason,
        });
    } catch (err) {
        console.error('chrome-shell-menu-overlay:v1:dismiss', err?.message || err);
    }
}

function dismissChromeShellMenuOverlayOnBlur(context) {
    if ((context?.chromeShellMenuOverlayAcquireCount || 0) <= 0) return;
    if (context.chromeShellMenuOverlayBlurDismissPending) return;
    context.chromeShellMenuOverlayBlurDismissPending = true;
    setImmediate(() => {
        try {
            dismissChromeShellMenuOverlay(context, 'blur');
        } finally {
            setTimeout(() => {
                context.chromeShellMenuOverlayBlurDismissPending = false;
            }, 0);
        }
    });
}

function focusChromeShellMenuOverlayWebContents(context) {
    if (!context?.chromeShellMenuOverlayView || context.chromeShellMenuOverlayView.webContents.isDestroyed()) return;
    if ((context.chromeShellMenuOverlayAcquireCount || 0) <= 0) return;
    try {
        if (context.window && !context.window.isDestroyed()) context.window.focus();
    } catch (_) { /* ignore */ }
    try {
        context.chromeShellMenuOverlayView.webContents.focus();
    } catch (err) {
        console.error('focusChromeShellMenuOverlayWebContents', err?.message || err);
    }
}

function getWindowContextByChromeOverlaySender(sender) {
    if (!sender || sender.isDestroyed?.()) return null;
    for (const ctx of windowContextsById.values()) {
        const ov = ctx.chromeOverlayView;
        if (isViewWebContentsAlive(ov) && ov.webContents === sender) {
            return ctx;
        }
        const shellOv = ctx.chromeShellMenuOverlayView;
        if (isViewWebContentsAlive(shellOv) && shellOv.webContents === sender) {
            return ctx;
        }
        const omniboxOv = ctx.chromeOmniboxOverlayView;
        if (isViewWebContentsAlive(omniboxOv) && omniboxOv.webContents === sender) {
            return ctx;
        }
    }
    return null;
}

function createTooltipOverlay(context) {
    const tooltipView = new WebContentsView({
        webPreferences: buildSecureWebPreferences(),
    });

    applyIdentityToWebContents(tooltipView.webContents);
    tooltipView.setBackgroundColor('#00000000'); // Transparent background
    tooltipView.webContents.loadURL('app://localhost/tooltip.html');

    // Add it last so it's on top of all other views
    context.window.contentView.addChildView(tooltipView);
    tooltipView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); // Hide initially
    context.tooltipView = tooltipView;
}

function generateTabId() {
    generatedTabCounter += 1;
    return `tab-${Date.now()}-${generatedTabCounter}`;
}

function isAllowedTabNavigationUrl(targetUrl) {
    if (!targetUrl || typeof targetUrl !== 'string') return false;
    return targetUrl.startsWith(C.URL.SCHEME_HTTPS) ||
        targetUrl.startsWith(C.URL.SCHEME_HTTP) ||
        targetUrl.startsWith(C.URL.SCHEME_APP) ||
        targetUrl.startsWith(C.URL.SCHEME_VIEW_SOURCE);
}

/** Detach active tab native view so shell HTML (portals, omnibox popups) renders above it. */
function hideActiveTabViewForShellOverlay(context) {
    if (!context?.activeTabId || detachedTabWindows.has(context.activeTabId)) return;
    const view = context.tabs[context.activeTabId];
    if (!view || view.webContents.isDestroyed()) return;
    context.isActiveTabTemporarilyHidden = true;
    try {
        removeTabContentChildView(context, view);
        context.activeTabViewRemovedForShellOverlay = true;
    } catch (err) {
        console.error('hideActiveTabViewForShellOverlay removeChildView:', err?.message || err);
        try {
            view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } catch (_) { /* ignore */ }
    }
}

/** Re-attach after hideActiveTabViewForShellOverlay and apply current content bounds. */
function restoreActiveTabViewFromShellOverlay(context) {
    if (!context?.activeTabId || detachedTabWindows.has(context.activeTabId)) return;
    const view = context.tabs[context.activeTabId];
    if (!view || view.webContents.isDestroyed()) return;
    context.isActiveTabTemporarilyHidden = false;
    if (context.activeTabViewRemovedForShellOverlay) {
        try {
            addTabContentChildView(context, view);
            context.activeTabViewRemovedForShellOverlay = false;
        } catch (err) {
            console.error('restoreActiveTabViewFromShellOverlay addChildView:', err?.message || err);
        }
    }
    try {
        layoutActiveTabView(context, context.activeTabId);
    } catch (err) {
        console.error('restoreActiveTabViewFromShellOverlay setBounds:', err?.message || err);
    }
    ensureChromeOverlayOnTop(context);
}

function activateTabInContext(context, id) {
    if (!context || !context.tabs[id]) return false;
    if (context.activeTabId !== id) {
        suspendLensSessionPresentation(context, context.activeTabId);
        dismissChromeShellMenuOverlay(context, 'browser-action');
    }
    const skipSameTab =
        context.activeTabId === id &&
        !detachedTabWindows.has(id) &&
        !context.isActiveTabTemporarilyHidden;
    // Re-activating the already-visible tab only removes/re-attaches every view and
    // re-sends omnibox:focus — causes NTP flicker when clicking the active tab repeatedly.
    if (skipSameTab) {
        layoutActiveTabView(context, id);
        ensureChromeOverlayOnTop(context);
        return true;
    }
    if (detachedTabWindows.has(id)) {
        const w = detachedTabWindows.get(id);
        if (w && !w.isDestroyed()) {
            w.show();
            w.focus();
        }
        return true;
    }
    context.isActiveTabTemporarilyHidden = false;
    context.activeTabViewRemovedForShellOverlay = false;
    for (const tid of Object.keys(context.tabs)) {
        if (detachedTabWindows.has(tid)) continue;
        try {
            removeTabContentChildView(context, context.tabs[tid]);
        } catch (_) {
            // View may already be detached from the shell.
        }
    }
    detachLensSidebarsExcept(context, id);
    addTabContentChildView(context, context.tabs[id]);
    context.activeTabId = id;
    layoutActiveTabView(context, id);
    const activeUrl = context.tabs[id]?.webContents.getURL() ?? '';
    const blankActive = isBlankTab(activeUrl);
    // For blank/NTP tabs we move keyboard focus straight to the shell + omnibox (below).
    // Focusing the tab WebContentsView first caused a visible focus flash before setImmediate.
    if (!blankActive) {
        context.tabs[id].webContents.focus();
    }
    if (context.window && !context.window.webContents.isDestroyed()) {
        context.window.webContents.send(C.IPC_EVENT.TAB_SWITCHED, { id });
    }
    const lensSession = getLensSession(context, id, false);
    if (lensSession?.selectionActive) {
        restoreActiveLensTabPresentation(context, id);
    } else if (context.chromeOverlayView && !context.chromeOverlayView.webContents.isDestroyed()) {
        try {
            context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
            context.chromeOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } catch (_) { }
    }

    // Autofocus the omnibox when switching to a blank/NTP tab so the user
    // can type immediately without clicking the address bar.
    // webContents.focus() on the shell window shifts Electron's native keyboard
    // ownership away from the tab's WebContentsView back to the chrome renderer,
    // which is required for a DOM .focus() call in the renderer to take effect.
    if (blankActive) {
        context.omniboxFocusGen = (context.omniboxFocusGen || 0) + 1;
        const omniboxGen = context.omniboxFocusGen;
        setImmediate(() => {
            if (context.omniboxFocusGen !== omniboxGen) return;
            sendOmniboxFocusToShell(context, id, true, false);
        });
    }

    ensureChromeOverlayOnTop(context);
    return true;
}

function activateTab(id) {
    const context = getWindowContextByTabId(id) || getWindowContextForShellFallback();
    return activateTabInContext(context, id);
}

function layoutDetachedTabView(tabId) {
    const context = getWindowContextByTabId(tabId);
    if (!context) return;
    const view = context.tabs[tabId];
    const win = detachedTabWindows.get(tabId);
    if (!view || view.webContents.isDestroyed() || !win || win.isDestroyed()) return;
    const { width, height } = win.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
}

function moveTabToDetachedWindow(id, fallbackTabId) {
    const context = getWindowContextByTabId(id) || getWindowContextForShellFallback();
    if (!context) return { ok: false };
    if (context.stealthWindow) return { ok: false };
    activateOrWakeTab(id);
    if (!context.tabs[id] || detachedTabWindows.has(id)) {
        return { ok: false };
    }

    const view = context.tabs[id];
    if (!view || view.webContents.isDestroyed()) return { ok: false };
    const tabWebContents = view.webContents;
    const movedTabUrl = tabWebContents.getURL();
    const movedTabHistory = captureNavigationHistorySnapshot(tabWebContents);
    const movedTabTitle = tabWebContents.getTitle();
    if (!movedTabUrl) return { ok: false };

    if (context.activeTabId === id) {
        const next =
            fallbackTabId && context.tabs[fallbackTabId] && !detachedTabWindows.has(fallbackTabId)
                ? fallbackTabId
                : Object.keys(context.tabs).find((tid) => tid !== id && !detachedTabWindows.has(tid));
        if (next) {
            activateTabInContext(context, next);
        } else {
            context.activeTabId = null;
        }
    }

    // Remove tab from source window context.
    try {
        removeTabContentChildView(context, view);
    } catch (_) {
        // Not attached (e.g. inactive tab) — continue cleanup.
    }
    try {
        view.webContents.destroy();
    } catch (_) {
        /* ignore */
    }
    destroyLensSession(context, id);
    delete context.tabs[id];
    delete context.sleepingTabs[id];
    tabIdToWindowId.delete(id);
    pendingTransitionsByTab.delete(String(id));
    historyService.clearTab(id);
    compatDiagnostics.clear(id);

    // Open a full shell window (header/tab bar/nav) and bootstrap it with this tab URL.
    const targetContext = createWindow({ profileId: context.profileId });
    windowBootstrapById.set(targetContext.windowId, {
        movedTab: {
            url: toDisplayUrl(movedTabUrl),
            title: movedTabTitle || '',
            isStealth: false,
            history: movedTabHistory,
        },
    });

    return { ok: true, mode: 'full-shell-window' };
}

function openUrlInNewTab(targetUrl, options = {}) {
    const context = options.context || getWindowContextByBrowserWindow(mainWindow);
    if (!context) return false;
    const openInBackground = options.background === true;
    const resolvedTargetUrl = resolveInternalPageUrl(targetUrl);
    if (!isAllowedTabNavigationUrl(resolvedTargetUrl)) return false;

    const newTabId = generateTabId();
    const stealthTab = !!context.stealthWindow;
    createTab(context, newTabId, resolvedTargetUrl, stealthTab, { activate: !openInBackground });

    if (context.window && !context.window.webContents.isDestroyed()) {
        context.window.webContents.send(C.IPC_EVENT.TAB_CREATED, { id: newTabId, isStealth: stealthTab, url: resolvedTargetUrl });
    }
    if (!openInBackground) {
        activateTabInContext(context, newTabId);
    }
    return true;
}

/**
 * Canonical form for internal pseudo-URLs (omnibox + session). Legacy `stealth://`
 * URLs are still accepted and treated the same as `invisurf://`.
 */
function normalizeInternalSchemeUrl(displayUrl) {
    if (!displayUrl || typeof displayUrl !== 'string') return '';
    const t = displayUrl.trim().toLowerCase();
    if (t === C.URL.STEALTH_HISTORY || t === C.URL.HISTORY_DISPLAY) return C.URL.HISTORY_DISPLAY;
    if (t === C.URL.STEALTH_SETTINGS || t === C.URL.SETTINGS_DISPLAY) return C.URL.SETTINGS_DISPLAY;
    return displayUrl.trim();
}

const CANONICAL_NTP_HTML = C.URL.NTP_CANONICAL_HTML;

function resolveInternalPageUrl(rawUrl) {
    if (rawUrl == null || typeof rawUrl !== 'string') return '';
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    const normalizedUrl = trimmed.toLowerCase();
    if (normalizedUrl === C.URL.STEALTH_HISTORY || normalizedUrl === C.URL.HISTORY_DISPLAY) return C.URL.HISTORY_LOAD;
    if (normalizedUrl === C.URL.STEALTH_SETTINGS || normalizedUrl === C.URL.SETTINGS_DISPLAY) return C.URL.SETTINGS_LOAD;
    if (normalizedUrl === C.URL.NTP_DISPLAY) return CANONICAL_NTP_HTML;
    return trimmed;
}

/** Always returns a non-empty loadable URL for tab WebContents (never `loadURL('')`). */
function resolveTabLoadUrl(rawUrl) {
    const effective = typeof rawUrl === 'string' && rawUrl.trim() ? rawUrl.trim() : C.URL.NTP_DISPLAY;
    return resolveInternalPageUrl(effective) || CANONICAL_NTP_HTML;
}

// A tab qualifies for omnibox autofocus when it has no meaningful page loaded.
// This covers the custom NTP, about:blank, and empty URL states.
function isBlankTab(url) {
    if (!url || url.trim() === '' || url === C.URL.ABOUT_BLANK) return true;
    const normalized = url.toLowerCase();
    return normalized === C.URL.NTP_DISPLAY ||
        normalized.startsWith(C.URL.NTP_LOCALHOST_PREFIX) ||
        (normalized.startsWith(C.URL.GOOGLE_ORIGIN_PREFIX) && !normalized.includes(C.URL.SEARCH_PATH));
}

// After did-finish-load, only re-assert omnibox focus for pages whose scripts steal
// focus (e.g. Google). Custom NTP uses a separate path (reassertOmniboxAfterCustomNtpLoad).
function shouldReassertOmniboxAfterPageLoad(url) {
    if (!url || typeof url !== 'string') return false;
    const u = url.toLowerCase();
    if (u === C.URL.ABOUT_BLANK || u === C.URL.NTP_DISPLAY || u.startsWith(C.URL.NTP_LOCALHOST_PREFIX)) {
        return false;
    }
    return u.startsWith(C.URL.GOOGLE_ORIGIN_PREFIX) && !u.includes(C.URL.SEARCH_PATH);
}

/** True when the loaded document is our bundled New Tab Page (not Google / about:blank). */
function isCustomNewTabDocumentUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const u = url.toLowerCase();
    return u === C.URL.NTP_DISPLAY || u.startsWith(C.URL.NTP_LOCALHOST_PREFIX);
}

function isGoogleLensSearchableUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const u = url.trim().toLowerCase();
    if (!u || u === C.URL.ABOUT_BLANK) return false;
    if (
        u === C.URL.NTP_DISPLAY ||
        u.startsWith(C.URL.NTP_LOCALHOST_PREFIX) ||
        u.startsWith(C.URL.SCHEME_APP) ||
        u.startsWith(C.URL.SCHEME_INVISURF) ||
        u.startsWith(C.URL.SCHEME_STEALTH)
    ) {
        return false;
    }
    return u.startsWith(C.URL.SCHEME_HTTP) || u.startsWith(C.URL.SCHEME_HTTPS);
}

function canSearchActiveTabWithGoogleLens(context) {
    if (!context || !context.activeTabId || detachedTabWindows.has(context.activeTabId)) return false;
    const activeView = context.tabs[context.activeTabId];
    if (!activeView || activeView.webContents.isDestroyed()) return false;
    try {
        return isGoogleLensSearchableUrl(activeView.webContents.getURL());
    } catch (_) {
        return false;
    }
}

/** Focus shell omnibox — shared by activateTabInContext and load handlers. */
function sendOmniboxFocusToShell(context, tabId, selectAll, openOverlay = false) {
    if (!context?.window || context.window.isDestroyed()) return;
    try {
        context.window.focus();
    } catch (_) {
        /* ignore */
    }
    if (!context.window.webContents || context.window.webContents.isDestroyed()) return;
    context.window.webContents.focus();
    context.window.webContents.send(C.IPC_EVENT.OMNIBOX_FOCUS, {
        tabId,
        selectAll,
        openOverlay: !!openOverlay,
    });
}

function toDisplayUrl(rawUrl) {
    if (!rawUrl) return '';
    if (rawUrl.startsWith(C.URL.SCHEME_APP) && rawUrl.includes(C.URL.FRAGMENT_HISTORY)) return C.URL.HISTORY_DISPLAY;
    if (rawUrl.startsWith(C.URL.SCHEME_APP) && rawUrl.includes(C.URL.FRAGMENT_SETTINGS)) return C.URL.SETTINGS_DISPLAY;
    if (rawUrl.startsWith(C.URL.SCHEME_APP) && rawUrl.includes(C.URL.FRAGMENT_NEWTAB)) return '';
    return rawUrl;
}

function truncateMenuLabel(value, maxLength = 70) {
    if (!value) return '';
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function getActiveTabView() {
    const context = getWindowContextByBrowserWindow(mainWindow);
    if (!context || !context.activeTabId) return null;
    return context.tabs[context.activeTabId] || null;
}

function getTabIdByDisplayUrl(targetDisplayUrl) {
    if (!targetDisplayUrl) return null;
    const targetNorm = normalizeInternalSchemeUrl(targetDisplayUrl);

    const context = getWindowContextByBrowserWindow(mainWindow);
    if (!context) return null;
    for (const [id, view] of Object.entries(context.tabs)) {
        if (!view || view.webContents.isDestroyed()) continue;
        const currentNorm = normalizeInternalSchemeUrl(toDisplayUrl(view.webContents.getURL()));
        if (currentNorm === targetNorm) return id;
    }

    for (const [id, entry] of Object.entries(context.sleepingTabs)) {
        const cand = entry.url.startsWith('app://') ? toDisplayUrl(entry.url) : entry.url;
        if (normalizeInternalSchemeUrl(cand) === targetNorm) return id;
    }

    return null;
}

function activateOrWakeTab(id) {
    const context = getWindowContextByTabId(id) || getWindowContextForShellFallback();
    if (!context) return false;
    if (!id) return false;
    if (!context.tabs[id] && context.sleepingTabs[id]) {
        const sleep = context.sleepingTabs[id];
        const resolvedUrl = resolveTabLoadUrl(sleep.url);
        const sleepHistory = sleep.history || null;
        delete context.sleepingTabs[id];
        createTab(context, id, resolvedUrl, !!context.stealthWindow, {
            navigationHistory: sleepHistory,
        });

        if (context.window && !context.window.webContents.isDestroyed()) {
            context.window.webContents.send(C.IPC_EVENT.TAB_AWOKEN, { id });
        }
    }
    return activateTabInContext(context, id);
}

function openOrActivateSettingsTab() {
    const existingSettingsTabId = getTabIdByDisplayUrl(C.URL.SETTINGS_DISPLAY);
    if (existingSettingsTabId) {
        return activateOrWakeTab(existingSettingsTabId);
    }
    return openUrlInNewTab(C.URL.SETTINGS_DISPLAY, { background: false });
}

function navigateActiveTabHome() {
    const context = getWindowContextForShellFallback();
    if (getLensSession(context, context?.activeTabId, false)?.selectionActive) {
        closeGoogleLensSelection(context, { closeSidebar: true });
    }
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return;
    resetTabWebContentsScale(activeView);
    activeView.webContents.loadURL('https://www.google.com');
}

function goBackInActiveTab() {
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return;
    activeView.webContents.navigationHistory.goBack();
}

function goForwardInActiveTab() {
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return;
    activeView.webContents.navigationHistory.goForward();
}

function openViewSourceForActiveTab() {
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return;
    const currentUrl = activeView.webContents.getURL();
    if (!currentUrl || currentUrl.startsWith(C.URL.SCHEME_VIEW_SOURCE)) return;
    if (currentUrl.startsWith(C.URL.SCHEME_DATA)) return;
    openUrlInNewTab(`${C.URL.SCHEME_VIEW_SOURCE}${currentUrl}`, { background: false });
}

function openDevToolsForActiveTab(panel) {
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return;
    const webContents = activeView.webContents;
    webContents.openDevTools({ mode: 'right', activate: true });
    if (!panel) return;

    const panelScript = `
        (() => {
            const panelName = ${JSON.stringify(panel)};
            const trySelectPanel = () => {
                try {
                    if (typeof InspectorFrontendAPI !== 'undefined' && InspectorFrontendAPI.showPanel) {
                        InspectorFrontendAPI.showPanel(panelName);
                        return true;
                    }
                    if (typeof UI !== 'undefined' && UI.inspectorView && UI.inspectorView.showPanel) {
                        UI.inspectorView.showPanel(panelName);
                        return true;
                    }
                } catch (_) {}
                return false;
            };
            if (!trySelectPanel()) setTimeout(trySelectPanel, 120);
        })();
    `;

    const selectPanel = () => {
        const devToolsWebContents = webContents.devToolsWebContents;
        if (!devToolsWebContents || devToolsWebContents.isDestroyed()) return;
        devToolsWebContents.executeJavaScript(panelScript).catch(() => { });
    };

    if (webContents.isDevToolsOpened()) {
        selectPanel();
    } else {
        webContents.once('devtools-opened', selectPanel);
    }
}

function openUndockedDevToolsForActiveTab(context, panel = C.DEVTOOLS_PANEL.ELEMENTS) {
    const activeView = context?.activeTabId ? context.tabs[context.activeTabId] : getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return;
    const wc = activeView.webContents;
    wc.openDevTools({ mode: 'undocked', activate: true });
    if (!panel) return;

    const panelScript = `
        (() => {
            const panelName = ${JSON.stringify(panel)};
            const trySelectPanel = () => {
                try {
                    if (typeof InspectorFrontendAPI !== 'undefined' && InspectorFrontendAPI.showPanel) {
                        InspectorFrontendAPI.showPanel(panelName);
                        return true;
                    }
                    if (typeof UI !== 'undefined' && UI.inspectorView && UI.inspectorView.showPanel) {
                        UI.inspectorView.showPanel(panelName);
                        return true;
                    }
                } catch (_) {}
                return false;
            };
            if (!trySelectPanel()) setTimeout(trySelectPanel, 120);
        })();
    `;

    const selectPanel = () => {
        const devToolsWebContents = wc.devToolsWebContents;
        if (!devToolsWebContents || devToolsWebContents.isDestroyed()) return;
        devToolsWebContents.executeJavaScript(panelScript).catch(() => { });
    };

    if (wc.isDevToolsOpened()) {
        selectPanel();
    } else {
        wc.once('devtools-opened', selectPanel);
    }
}

function openDevToolsForLensSidebar(context, tabId = context?.activeTabId, panel = C.DEVTOOLS_PANEL.ELEMENTS) {
    const lensSession = getLensSession(context, tabId, false);
    const sidebarView = lensSession?.sidebarView;
    if (!sidebarView || sidebarView.webContents.isDestroyed()) return;
    const wc = sidebarView.webContents;
    wc.openDevTools({ mode: 'undocked', activate: true });
    if (!panel) return;

    const panelScript = `
        (() => {
            const panelName = ${JSON.stringify(panel)};
            const trySelectPanel = () => {
                try {
                    if (typeof InspectorFrontendAPI !== 'undefined' && InspectorFrontendAPI.showPanel) {
                        InspectorFrontendAPI.showPanel(panelName);
                        return true;
                    }
                    if (typeof UI !== 'undefined' && UI.inspectorView && UI.inspectorView.showPanel) {
                        UI.inspectorView.showPanel(panelName);
                        return true;
                    }
                } catch (_) {}
                return false;
            };
            if (!trySelectPanel()) setTimeout(trySelectPanel, 120);
        })();
    `;

    const selectPanel = () => {
        const devToolsWebContents = wc.devToolsWebContents;
        if (!devToolsWebContents || devToolsWebContents.isDestroyed()) return;
        devToolsWebContents.executeJavaScript(panelScript).catch(() => { });
    };

    if (wc.isDevToolsOpened()) {
        selectPanel();
    } else {
        wc.once('devtools-opened', selectPanel);
    }
}

function openDownloadsFolder() {
    try {
        const downloadsPath = app.getPath('downloads');
        shell.openPath(downloadsPath).catch((error) => {
            console.error('Failed to open downloads folder:', error?.message || error);
        });
        return true;
    } catch (error) {
        console.error('Failed to resolve downloads folder:', error?.message || error);
        return false;
    }
}

function printActiveTab() {
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return false;
    activeView.webContents.print({}, (success, failureReason) => {
        if (!success && failureReason) {
            console.error('Print failed:', failureReason);
        }
    });
    return true;
}

function triggerFindInActiveTab() {
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return false;
    try {
        activeView.webContents.focus();
        const modifier = process.platform === 'darwin' ? 'meta' : 'control';
        activeView.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: [modifier] });
        activeView.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: [modifier] });
        return true;
    } catch (error) {
        console.error('Find shortcut failed:', error?.message || error);
        return false;
    }
}

function getChromeShellBackgroundColor(context) {
    try {
        const patch = getChromeOverlayThemePatchForContext(context);
        return patch?.tokens?.['--chrome-shell-tint'] || patch?.tokens?.['--chrome-shell-bg'] || patch?.tokens?.['--chrome-body-bg'] || (patch?.effectiveDark ? '#253035' : '#ffffff');
    } catch (_) {
        return nativeTheme?.shouldUseDarkColors ? '#253035' : '#ffffff';
    }
}

function buildLensSidebarPlaceholderHtml(context) {
    const background = getChromeShellBackgroundColor(context);
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: ${background};
      color: #7b8188;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    body {
      display: grid;
      place-items: center;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      border: 1px solid rgba(95, 99, 104, 0.24);
      border-radius: ${LENS_PANEL_RADIUS}px;
      box-sizing: border-box;
      pointer-events: none;
    }
    .placeholder {
      max-width: 220px;
      text-align: center;
      font-size: 13px;
      line-height: 1.45;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="placeholder">Drag on site to search on Google Lens</div>
</body>
</html>`;
}

function createLensSidebarHostView(context) {
    if (typeof View !== 'function') return null;
    try {
        const host = new View();
        if (typeof host.setBackgroundColor === 'function') {
            host.setBackgroundColor(getChromeShellBackgroundColor(context));
        }
        setNativeViewCornerRadius(host, LENS_PANEL_RADIUS);
        return host;
    } catch (_) {
        return null;
    }
}

function isGoogleLensSidebarUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith('data:') || url === 'about:blank') return true;
    if (url.startsWith('invisurf-lens://close')) return true;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return false;
        if (parsed.hostname === 'lens.google.com') return true;
        // Lens upload POST redirects to Google Search results in the sidebar.
        if (parsed.hostname === 'www.google.com' || parsed.hostname === 'google.com') {
            const path = parsed.pathname || '/';
            if (path === '/search' || path.startsWith('/search/')) return true;
            // Result links often pass through Google's /url redirect wrapper first.
            if (path === '/url' || path.startsWith('/url/')) return true;
        }
        return false;
    } catch (_) {
        return false;
    }
}

function openLensSidebarNavigationInTab(context, url, options = {}) {
    const targetUrl = String(url || '').trim();
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        return false;
    }
    return openUrlInNewTab(targetUrl, {
        context,
        background: options.background === true,
        keepLensOpen: true,
    });
}

function createLensSidebar(context, tabId = context?.activeTabId) {
    if (!context || context.window.isDestroyed() || !tabId) return null;
    const lensSession = getLensSession(context, tabId, true);
    if (lensSession.sidebarView && !isViewWebContentsAlive(lensSession.sidebarView)) {
        lensSession.sidebarView = null;
        lensSession.sidebarHostView = null;
    }
    if (isViewWebContentsAlive(lensSession.sidebarView)) {
        return lensSession.sidebarView;
    }

    const sidebar = new WebContentsView({
        webPreferences: buildSecureWebPreferences({ partition: context.partition }),
    });
    try { sidebar.webContents.setBackgroundColor(getChromeShellBackgroundColor(context)); } catch (_) { }
    let sidebarHostView = createLensSidebarHostView(context);
    if (sidebarHostView) {
        try {
            sidebarHostView.addChildView(sidebar);
        } catch (_) {
            sidebarHostView = null;
        }
    }
    // Lens mobile layout requires a mobile Safari UA; scoped to Lens sidebar only.
    sidebar.webContents.setUserAgent(LENS_MOBILE_USER_AGENT);
    sidebar.webContents.setWindowOpenHandler(({ url, disposition }) => {
        const lensUrl = isGoogleLensSidebarUrl(url);
        if (lensUrl) {
            sidebar.webContents.loadURL(url).catch(() => { });
            return { action: 'deny' };
        }
        openLensSidebarNavigationInTab(context, url, {
            background: disposition === 'background-tab',
        });
        return { action: 'deny' };
    });
    sidebar.webContents.on('will-navigate', (event, url) => {
        const lensUrl = isGoogleLensSidebarUrl(url);
        if (String(url || '').startsWith('invisurf-lens://close')) {
            event.preventDefault();
            if (context.activeTabId === tabId) {
                closeGoogleLensSelection(context, { closeSidebar: true });
            } else {
                destroyLensSession(context, tabId);
            }
            return;
        }
        if (!lensUrl) {
            event.preventDefault();
            openLensSidebarNavigationInTab(context, url);
        }
    });
    sidebar.webContents.on('will-redirect', (event, url) => {
        const lensUrl = isGoogleLensSidebarUrl(url);
        if (!lensUrl) {
            event.preventDefault();
            openLensSidebarNavigationInTab(context, url);
        }
    });
    sidebar.webContents.on('did-finish-load', () => {
        injectLensSidebarCloseButton(context, tabId);
    });
    lensSession.sidebarHostView = sidebarHostView;
    lensSession.sidebarView = sidebar;
    sidebar.webContents.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(buildLensSidebarPlaceholderHtml(context)).toString('base64')}`).catch(() => { });
    if (tabId === context.activeTabId) {
        addTabContentChildView(context, sidebarHostView || sidebar);
        layoutLensSidebar(context, tabId);
    }
    return sidebar;
}

function closeGoogleLensSelection(context, { closeSidebar = false } = {}) {
    if (!context) return;
    const tabId = context.activeTabId;
    const lensSession = getLensSession(context, tabId, false);
    if (lensSession) lensSession.selectionActive = false;
    context.lensOverlayBounds = null;
    context.chromeOverlayFullWindowMode = false;
    if (context.chromeOverlayView && !context.chromeOverlayView.webContents.isDestroyed()) {
        try {
            context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
        } catch (_) { }
    }
    if (lensSession?.overlayAcquired && context.chromeOverlayAcquireCount > 0) {
        context.chromeOverlayAcquireCount -= 1;
        lensSession.overlayAcquired = false;
        repairLensChromeOverlayAcquireCount(context);
        if (context.chromeOverlayAcquireCount <= 0 && context.chromeOverlayView && !context.chromeOverlayView.webContents.isDestroyed()) {
            try { context.chromeOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch (_) { }
        }
    }
    if (lensSession) {
        if (context.activeTabId && context.tabs[context.activeTabId] && lensSession.pageZoomFactorBeforeLens !== null) {
            try { context.tabs[context.activeTabId].webContents.setZoomFactor(lensSession.pageZoomFactorBeforeLens || 1); } catch (_) { }
        }
        lensSession.pageZoomFactorBeforeLens = null;
        lensSession.pageScale = 1;
        lensSession.sourceWidth = null;
        lensSession.sourceHeight = null;
        lensSession.siteBounds = null;
        lensSession.fullSnapshot = null;
        lensSession.snapshotDataUrl = null;
        lensSession.magnifierImage = null;
        lensSession.lastSelectionRatio = null;
        lensSession.lastSelectionText = '';
        lensSession.textSnapshot = null;
    }
    if (closeSidebar && lensSession) {
        destroyLensSidebarViews(context, lensSession);
        context.lensSessions.delete(tabId);
    }
    if (context.activeTabViewRemovedForShellOverlay || context.isActiveTabTemporarilyHidden) {
        restoreActiveTabViewFromShellOverlay(context);
    } else {
        layoutActiveTabView(context, tabId);
    }
    ensureChromeOverlayOnTop(context);
}

// function postLensSelectionPatch(context) {
//     if (!context?.chromeOverlayView || context.chromeOverlayView.webContents.isDestroyed()) return false;
//     const lensSession = getLensSession(context, context.activeTabId, false);
//     if (!lensSession?.selectionActive) return false;
//     const tabBounds = getActiveTabContentBounds(context);
//     if (tabBounds.width < 40 || tabBounds.height < 40) return false;
//     const lensMetrics = getLensLayoutMetrics(context, context.activeTabId);
//     const { width: windowWidth } = context.window.getContentBounds();
//     const sidebarWidth = getLensSidebarWidth(context, context.activeTabId);
//     const siteBounds = {
//         x: tabBounds.x,
//         y: Math.max(0, tabBounds.y - UI_HEIGHT),
//         width: tabBounds.width,
//         height: tabBounds.height,
//     };
//     const patch = {
//         kind: 'lensSelection',
//         hint: 'Select any text or image to search with Google Lens',
//         sidebarWidth,
//         minSidebarWidth: Math.min(LENS_SIDEBAR_MIN_WIDTH, Math.max(220, Math.floor(context.window.getContentBounds().width * LENS_SIDEBAR_MAX_RATIO))),
//         maxSidebarWidth: Math.max(220, Math.floor(context.window.getContentBounds().width * LENS_SIDEBAR_MAX_RATIO)),
//         windowWidth,
//         panelRadius: LENS_PANEL_RADIUS,
//         sourceWidth: lensSession.sourceWidth || windowWidth,
//         sourceHeight: lensSession.sourceHeight || (lensMetrics?.contentHeight || 0),
//         siteBounds,
//         leftPanelBounds: lensMetrics ? {
//             x: lensMetrics.leftPanelBounds.x,
//             y: Math.max(0, lensMetrics.leftPanelBounds.y - UI_HEIGHT),
//             width: lensMetrics.leftPanelBounds.width,
//             height: lensMetrics.leftPanelBounds.height,
//         } : null,
//         sidebarBounds: lensMetrics ? {
//             x: lensMetrics.sidebarBounds.x,
//             y: Math.max(0, lensMetrics.sidebarBounds.y - UI_HEIGHT),
//             width: lensMetrics.sidebarBounds.width,
//             height: lensMetrics.sidebarBounds.height,
//         } : null,
//         panelGap: lensMetrics?.panelGap || LENS_PANEL_GAP,
//         contentHeight: lensMetrics?.contentHeight || 0,
//         selectionRect: lensSession.lastSelection || null,
//         hasSelection: !!lensSession.lastSelection,
//         magnifierImage: lensSession.magnifierImage || null,
//     };
//     layoutChromeOverlayBounds(context, patch);
//     ensureChromeOverlayOnTop(context);
//     context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, patch);
//     return true;
// }

function postLensSelectionPatch(context) {
    if (!context?.chromeOverlayView || context.chromeOverlayView.webContents.isDestroyed()) return false;
    const lensSession = getLensSession(context, context.activeTabId, false);
    if (!lensSession?.selectionActive) return false;

    const lensMetrics = getLensLayoutMetrics(context, context.activeTabId);
    const tabBounds = getActiveTabContentBounds(context, context.activeTabId);
    if (tabBounds.width < 40 || tabBounds.height < 40) return false;
    const { width: windowWidth, height: windowHeight } = context.window.getContentBounds();
    const sidebarWidth = getLensSidebarWidth(context, context.activeTabId);
    const overlayOriginY = context.chromeOverlayFullWindowMode ? 0 : (lensMetrics?.contentTop ?? UI_HEIGHT);
    const backdropTop = context.chromeOverlayFullWindowMode ? (lensMetrics?.contentTop ?? UI_HEIGHT) : 0;
    const overlayHeight = context.chromeOverlayFullWindowMode
        ? windowHeight
        : (lensMetrics?.contentHeight || 0);
    const siteBounds = {
        x: tabBounds.x,
        y: Math.max(0, tabBounds.y - overlayOriginY),
        width: tabBounds.width,
        height: tabBounds.height,
    };
    const selectionRatio = lensSession.lastSelectionRatio || null;
    const selectionRect = selectionRatio ? {
        x: Math.round(selectionRatio.x * siteBounds.width),
        y: Math.round(selectionRatio.y * siteBounds.height),
        width: Math.max(1, Math.round(selectionRatio.width * siteBounds.width)),
        height: Math.max(1, Math.round(selectionRatio.height * siteBounds.height)),
    } : (lensSession.lastSelection || null);

    const patch = {
        kind: 'lensSelection',
        hint: 'Select any text or image to search with Google Lens',
        sidebarWidth,
        minSidebarWidth: Math.min(LENS_SIDEBAR_MIN_WIDTH, Math.max(220, Math.floor(context.window.getContentBounds().width * LENS_SIDEBAR_MAX_RATIO))),
        maxSidebarWidth: Math.max(220, Math.floor(context.window.getContentBounds().width * LENS_SIDEBAR_MAX_RATIO)),
        windowWidth,
        panelRadius: LENS_PANEL_RADIUS,
        sourceWidth: lensSession.sourceWidth || windowWidth,
        sourceHeight: lensSession.sourceHeight || (lensMetrics?.contentHeight || 0),
        snapshotDataUrl: lensSession.snapshotDataUrl,
        siteBounds,
        leftPanelBounds: lensMetrics ? {
            x: lensMetrics.leftPanelBounds.x,
            y: Math.max(0, lensMetrics.leftPanelBounds.y - overlayOriginY),
            width: lensMetrics.leftPanelBounds.width,
            height: lensMetrics.leftPanelBounds.height,
        } : null,
        sidebarBounds: lensMetrics ? {
            x: lensMetrics.sidebarBounds.x,
            y: Math.max(0, lensMetrics.sidebarBounds.y - overlayOriginY),
            width: lensMetrics.sidebarBounds.width,
            height: lensMetrics.sidebarBounds.height,
        } : null,
        panelGap: lensMetrics?.panelGap || LENS_PANEL_GAP,
        backdropTop,
        contentHeight: overlayHeight,
        selectionRect,
        selectionRatio,
        hasSelectionText: !!lensSession.lastSelectionText,
        hasSelection: !!selectionRect,
    };

    layoutChromeOverlayBounds(context, patch);
    ensureChromeOverlayOnTop(context);
    context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, patch);
    return true;
}

function resizeGoogleLensSidebar(context, width) {
    const lensSession = getLensSession(context, context?.activeTabId, false);
    if (!lensSession?.sidebarView || lensSession.sidebarView.webContents.isDestroyed()) return false;
    const { width: windowWidth } = context.window.getContentBounds();
    const maxWidth = Math.max(220, Math.floor(windowWidth * LENS_SIDEBAR_MAX_RATIO));
    const minWidth = Math.min(LENS_SIDEBAR_MIN_WIDTH, maxWidth);
    const nextWidth = Math.max(minWidth, Math.min(Math.round(Number(width) || 0), maxWidth));
    lensSession.sidebarWidth = nextWidth;
    layoutActiveTabView(context, context.activeTabId);
    if (lensSession.selectionActive) {
        layoutChromeOverlayBounds(context, { kind: 'lensSelection' });
        ensureChromeOverlayOnTop(context);
    }
    return true;
}

function commitGoogleLensSidebarResize(context, width) {
    const resized = resizeGoogleLensSidebar(context, width);
    if (resized) postLensSelectionPatch(context);
    return resized;
}

function copyLensSelectionImage(context) {
    const lensSession = getLensSession(context, context?.activeTabId, false);
    if (!lensSession?.lastSelectionImage) return false;
    try {
        clipboard.writeImage(electron.nativeImage.createFromBuffer(lensSession.lastSelectionImage));
        return true;
    } catch (error) {
        console.error('Copy Lens image failed:', error?.message || error);
        return false;
    }
}

async function copyLensSelectionText(context) {
    const lensSession = getLensSession(context, context?.activeTabId, false);
    const text = String(lensSession?.lastSelectionText || '').trim();
    if (!text) return false;
    try {
        clipboard.writeText(text);
        return true;
    } catch (error) {
        console.error('Copy Lens text failed:', error?.message || error);
        return false;
    }
}

async function extractLensPageTextSnapshot(activeView) {
    if (!activeView || activeView.webContents.isDestroyed()) return null;
    const script = `
        (() => {
            const root = document.body || document.documentElement;
            if (!root) return null;
            const vv = window.visualViewport;
            const viewportWidth = Math.max(1, Math.round((vv && vv.width) || window.innerWidth || document.documentElement.clientWidth || 1));
            const viewportHeight = Math.max(1, Math.round((vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 1));
            const words = [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    const text = node.nodeValue || '';
                    if (!text.trim()) return NodeFilter.FILTER_REJECT;
                    const parent = node.parentElement;
                    if (!parent || parent.closest('script,style,noscript,template')) return NodeFilter.FILTER_REJECT;
                    const style = window.getComputedStyle(parent);
                    if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            });
            const intersectsViewport = (rect) =>
                rect.width > 0 && rect.height > 0 &&
                rect.right >= 0 && rect.bottom >= 0 &&
                rect.left <= viewportWidth && rect.top <= viewportHeight;
            let node;
            while ((node = walker.nextNode()) && words.length < 4000) {
                const text = node.nodeValue || '';
                const re = /\\S+/g;
                let match;
                while ((match = re.exec(text)) && words.length < 4000) {
                    const range = document.createRange();
                    try {
                        range.setStart(node, match.index);
                        range.setEnd(node, match.index + match[0].length);
                        const rects = Array.from(range.getClientRects()).filter(intersectsViewport);
                        for (const rect of rects) {
                            words.push({
                                text: match[0],
                                x: rect.left,
                                y: rect.top,
                                width: rect.width,
                                height: rect.height,
                            });
                        }
                    } catch (_) {
                        // Ignore detached or otherwise invalid text ranges.
                    } finally {
                        range.detach();
                    }
                }
            }
            return { width: viewportWidth, height: viewportHeight, words };
        })();
    `;
    try {
        const snapshot = await activeView.webContents.executeJavaScript(script, true);
        if (!snapshot || !Array.isArray(snapshot.words)) return null;
        return snapshot;
    } catch (error) {
        console.warn('Lens text snapshot failed:', error?.message || error);
        return null;
    }
}

function getLensSelectionText(lensSession, selectionRatio) {
    const snapshot = lensSession?.textSnapshot;
    if (!snapshot?.words?.length || !selectionRatio) return '';
    const rect = {
        x: selectionRatio.x * snapshot.width,
        y: selectionRatio.y * snapshot.height,
        width: selectionRatio.width * snapshot.width,
        height: selectionRatio.height * snapshot.height,
    };
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    const intersects = (word) => {
        const wordRight = word.x + word.width;
        const wordBottom = word.y + word.height;
        return wordRight >= rect.x && word.x <= right && wordBottom >= rect.y && word.y <= bottom;
    };
    const selected = snapshot.words
        .filter(intersects)
        .sort((a, b) => {
            const lineDelta = a.y - b.y;
            if (Math.abs(lineDelta) > 8) return lineDelta;
            return a.x - b.x;
        });
    if (!selected.length) return '';
    const lines = [];
    for (const word of selected) {
        const current = lines[lines.length - 1];
        if (!current || Math.abs(word.y - current.y) > Math.max(8, word.height * 0.8)) {
            lines.push({ y: word.y, words: [word.text] });
        } else {
            current.words.push(word.text);
        }
    }
    return lines.map((line) => line.words.join(' ')).join('\n').trim();
}

// function startGoogleLensSelection(context = getWindowContextByBrowserWindow(mainWindow)) {
//     if (!context || !context.activeTabId || detachedTabWindows.has(context.activeTabId)) return false;
//     const activeView = context.tabs[context.activeTabId];
//     if (!activeView || activeView.webContents.isDestroyed()) return false;

//     const lensSession = getLensSession(context, context.activeTabId, true);
//     lensSession.selectionActive = true;
//     if (!lensSession.sourceWidth || !lensSession.sourceHeight) {
//         const { width, height } = context.window.getContentBounds();
//         lensSession.sourceWidth = Math.max(1, Math.round(width));
//         lensSession.sourceHeight = Math.max(1, Math.round((htmlFullscreenTabId === context.activeTabId) ? height : Math.max(0, height - UI_HEIGHT)));
//     }
//     createLensSidebar(context, context.activeTabId);
//     // openUndockedDevToolsForActiveTab(context);
//     layoutActiveTabView(context, context.activeTabId);
//     createChromeOverlayLayer(context);
//     if (!lensSession.overlayAcquired) {
//         context.chromeOverlayAcquireCount += 1;
//         lensSession.overlayAcquired = true;
//     }
//     const posted = postLensSelectionPatch(context);
//     return posted;
// }

async function startGoogleLensSelection(context = getWindowContextByBrowserWindow(mainWindow)) {
    if (!context || !context.activeTabId || detachedTabWindows.has(context.activeTabId)) return false;
    const activeView = context.tabs[context.activeTabId];
    if (!activeView || activeView.webContents.isDestroyed()) return false;
    if (!canSearchActiveTabWithGoogleLens(context)) return false;

    const existingLens = findActiveLensTabForProfile(context.profileId);
    if (existingLens) {
        try {
            if (!existingLens.context.window.isDestroyed()) {
                existingLens.context.window.focus();
            }
        } catch (_) { /* ignore */ }
        if (existingLens.tabId !== context.activeTabId || existingLens.context !== context) {
            activateTabInContext(existingLens.context, existingLens.tabId);
        } else {
            restoreActiveLensTabPresentation(context, existingLens.tabId);
        }
        return true;
    }

    const lensSession = getLensSession(context, context.activeTabId, true);
    lensSession.selectionActive = true;

    // 1. Capture the visual layout instantly before hiding the live page
    try {
        lensSession.textSnapshot = await extractLensPageTextSnapshot(activeView);
        const image = await activeView.webContents.capturePage();
        if (!image || image.isEmpty()) {
            lensSession.selectionActive = false;
            return false;
        }
        // Cache the NativeImage in-memory for instant, synchronous cropping later
        lensSession.fullSnapshot = image;
        lensSession.snapshotDataUrl = image.toDataURL(); // For the overlay renderer

        const size = image.getSize();
        lensSession.sourceWidth = size.width;
        lensSession.sourceHeight = size.height;
    } catch (err) {
        console.error('Failed to capture webpage for Lens:', err);
        lensSession.selectionActive = false;
        return false;
    }

    createLensSidebar(context, context.activeTabId);

    // 2. Hide the live tab completely to prevent layout thrashing on resize
    hideActiveTabViewForShellOverlay(context);
    layoutActiveTabView(context, context.activeTabId);

    createChromeOverlayLayer(context);
    if (!lensSession.overlayAcquired) {
        context.chromeOverlayAcquireCount += 1;
        lensSession.overlayAcquired = true;
    }

    return postLensSelectionPatch(context);
}

async function refreshLensMagnifierSnapshot(context, tabId = context?.activeTabId) {
    const lensSession = getLensSession(context, tabId, false);
    const view = tabId ? context?.tabs?.[tabId] : null;
    if (!lensSession?.selectionActive || !view || view.webContents.isDestroyed()) return false;
    try {
        const image = await view.webContents.capturePage();
        if (!image || image.isEmpty()) return false;
        lensSession.magnifierImage = image.toDataURL();
        if (context.activeTabId === tabId && lensSession.selectionActive) postLensSelectionPatch(context);
        return true;
    } catch (error) {
        console.error('Lens magnifier snapshot failed:', error?.message || error);
        return false;
    }
}

function submitLensImageInSidebar(context, tabId, pngBuffer, dimensions) {
    const sidebar = createLensSidebar(context, tabId);
    if (!isViewWebContentsAlive(sidebar)) return Promise.resolve(false);
    const imageDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    const uploadUrl = `https://lens.google.com/v3/upload?ep=ccm&s=&st=${Date.now()}`;
    const background = getChromeShellBackgroundColor(context);
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Google Lens</title>
  <style>
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:${background};color:#7b8188;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    body{display:grid;place-items:center}
    .loading{display:grid;place-items:center;gap:10px;text-align:center;font-size:13px;font-weight:500}
    .spinner{width:24px;height:24px;border:3px solid rgba(123,129,136,.28);border-top-color:#1a73e8;border-radius:50%;animation:s 1s linear infinite}
    body::before{content:"";position:fixed;inset:0;border:1px solid rgba(95,99,104,.24);border-radius:${LENS_PANEL_RADIUS}px;box-sizing:border-box;pointer-events:none}
    p{margin:0}
    @keyframes s{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <p>Searching with Google Lens...</p>
  </div>
  <script>
    (async function () {
      try {
        const response = await fetch(${JSON.stringify(imageDataUrl)});
        const blob = await response.blob();
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = ${JSON.stringify(uploadUrl)};
        form.enctype = 'multipart/form-data';
        form.style.display = 'none';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.name = 'encoded_image';
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], 'invisurf-lens.png', { type: 'image/png' }));
        fileInput.files = transfer.files;
        form.appendChild(fileInput);

        const dimensionsInput = document.createElement('input');
        dimensionsInput.type = 'hidden';
        dimensionsInput.name = 'processed_image_dimensions';
        dimensionsInput.value = ${JSON.stringify(`${dimensions.width},${dimensions.height}`)};
        form.appendChild(dimensionsInput);

        document.body.appendChild(form);
        form.submit();
      } catch (error) {
        document.body.innerHTML = '<p>Could not send this image to Google Lens.</p>';
      }
    })();
  </script>
</body>
</html>`;

    return new Promise((resolve) => {
        let finished = false;
        const cleanup = () => {
            sidebar.webContents.removeListener('did-navigate', onNavigate);
            sidebar.webContents.removeListener('did-fail-load', onFail);
        };
        const onNavigate = (_event, targetUrl) => {
            if (!/^https:\/\/lens\.google\.com\//i.test(String(targetUrl || ''))) return;
            finished = true;
            cleanup();
            resolve(true);
        };
        const onFail = (_event, _errorCode, errorDescription) => {
            if (finished) return;
            cleanup();
            console.error('Google Lens sidebar load failed:', errorDescription);
            resolve(false);
        };
        sidebar.webContents.on('did-navigate', onNavigate);
        sidebar.webContents.on('did-fail-load', onFail);
        sidebar.webContents.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`).catch((error) => {
            cleanup();
            console.error('Google Lens submit page failed:', error?.message || error);
            resolve(false);
        });
        setTimeout(() => {
            if (finished || !isViewWebContentsAlive(sidebar)) return;
            cleanup();
            resolve(true);
        }, 8000);
    });
}

// async function captureGoogleLensSelection(context, rect = {}) {
//     const tabId = context?.activeTabId;
//     const lensSession = getLensSession(context, tabId, false);
//     if (!lensSession?.selectionActive || !tabId) return false;
//     const activeView = context.tabs[tabId];
//     if (!activeView || activeView.webContents.isDestroyed()) return false;

//     const x = Math.max(0, Math.round(Number(rect.x) || 0));
//     const y = Math.max(0, Math.round(Number(rect.y) || 0));
//     const width = Math.max(1, Math.round(Number(rect.width) || 0));
//     const height = Math.max(1, Math.round(Number(rect.height) || 0));
//     if (width < 8 || height < 8) return false;

//     const previousContentProtection = loadSettings().contentProtection;
//     try {
//         if (previousContentProtection) context.window.setContentProtection(false);
//         const image = await activeView.webContents.capturePage({ x, y, width, height });
//         if (previousContentProtection) context.window.setContentProtection(true);
//         if (!image || image.isEmpty()) return false;
//         const png = image.toPNG();
//         lensSession.lastSelection = { x, y, width, height };
//         lensSession.lastSelectionImage = png;
//         await submitLensImageInSidebar(context, tabId, png, { width, height });
//         if (context.activeTabId === tabId && lensSession.selectionActive) {
//             postLensSelectionPatch(context);
//             ensureChromeOverlayOnTop(context);
//             try {
//                 const sidebar = lensSession.sidebarView;
//                 if (sidebar && !sidebar.webContents.isDestroyed()) sidebar.webContents.focus();
//             } catch (_) { /* ignore */ }
//         }
//         return true;
//     } catch (error) {
//         if (previousContentProtection) {
//             try { context.window.setContentProtection(true); } catch (_) { }
//         }
//         console.error('Google Lens capture failed:', error?.message || error);
//         if (context.activeTabId === tabId && lensSession.selectionActive) postLensSelectionPatch(context);
//         return false;
//     }
// }

async function captureGoogleLensSelection(context, rect = {}) {
    const tabId = context?.activeTabId;
    const lensSession = getLensSession(context, tabId, false);
    if (!lensSession?.selectionActive || !tabId) return false;
    const activeView = context.tabs[tabId];
    if (!activeView || activeView.webContents.isDestroyed()) return false;

    const site = lensSession.siteBounds;
    if (!site || !site.width || !site.height) return false;

    try {
        if (!lensSession.fullSnapshot || lensSession.fullSnapshot.isEmpty()) return false;

        const origSize = lensSession.fullSnapshot.getSize();

        const selectionX = Math.max(0, Math.min(Math.round(Number(rect.x) || 0), Math.max(0, site.width - 1)));
        const selectionY = Math.max(0, Math.min(Math.round(Number(rect.y) || 0), Math.max(0, site.height - 1)));
        const selectionWidth = Math.max(1, Math.min(Math.round(Number(rect.width) || 0), site.width - selectionX));
        const selectionHeight = Math.max(1, Math.min(Math.round(Number(rect.height) || 0), site.height - selectionY));
        if (selectionWidth < 8 || selectionHeight < 8) return false;

        // Translate scaled overlay coordinates to the original snapshot pixels.
        const x = Math.max(0, Math.round((selectionX / site.width) * origSize.width));
        const y = Math.max(0, Math.round((selectionY / site.height) * origSize.height));
        const width = Math.max(1, Math.round((selectionWidth / site.width) * origSize.width));
        const height = Math.max(1, Math.round((selectionHeight / site.height) * origSize.height));

        // Prevent cropping out-of-bounds
        const safeX = Math.min(x, origSize.width - 1);
        const safeY = Math.min(y, origSize.height - 1);
        const safeWidth = Math.max(1, Math.min(width, origSize.width - safeX));
        const safeHeight = Math.max(1, Math.min(height, origSize.height - safeY));

        // Perform instant crop in memory
        const croppedImage = lensSession.fullSnapshot.crop({
            x: safeX,
            y: safeY,
            width: safeWidth,
            height: safeHeight
        });
        const png = croppedImage.toPNG();

        lensSession.lastSelection = {
            x: selectionX,
            y: selectionY,
            width: selectionWidth,
            height: selectionHeight,
        };
        lensSession.lastSelectionRatio = {
            x: selectionX / site.width,
            y: selectionY / site.height,
            width: selectionWidth / site.width,
            height: selectionHeight / site.height,
        };
        lensSession.lastSelectionText = getLensSelectionText(lensSession, lensSession.lastSelectionRatio);
        lensSession.lastSelectionImage = png;

        await submitLensImageInSidebar(context, tabId, png, { width: safeWidth, height: safeHeight });

        if (context.activeTabId === tabId && lensSession.selectionActive) {
            postLensSelectionPatch(context);
            ensureChromeOverlayOnTop(context);
            try {
                const sidebar = lensSession.sidebarView;
                if (sidebar && !sidebar.webContents.isDestroyed()) sidebar.webContents.focus();
            } catch (_) { /* ignore */ }
        }
        return true;
    } catch (error) {
        console.error('Google Lens capture failed:', error?.message || error);
        if (context.activeTabId === tabId && lensSession.selectionActive) postLensSelectionPatch(context);
        return false;
    }
}

function searchActiveTabWithGoogleLens() {
    return startGoogleLensSelection();
}

function canStoreRecentlyClosedUrl(rawUrl) {
    const displayUrl = toDisplayUrl(rawUrl);
    const resolvedUrl = resolveInternalPageUrl(displayUrl);
    if (!resolvedUrl || resolvedUrl.startsWith(C.URL.SCHEME_DATA)) return false;
    return isAllowedTabNavigationUrl(resolvedUrl);
}

function captureNavigationHistorySnapshot(tabWebContents) {
    try {
        const navigationHistory = tabWebContents?.navigationHistory;
        if (!navigationHistory || typeof navigationHistory.getAllEntries !== 'function') return null;
        const rawEntries = navigationHistory.getAllEntries();
        if (!Array.isArray(rawEntries) || rawEntries.length === 0) return null;

        const activeIndex = typeof navigationHistory.getActiveIndex === 'function'
            ? navigationHistory.getActiveIndex()
            : rawEntries.length - 1;
        const entries = [];
        let index = 0;

        for (let i = 0; i < rawEntries.length; i += 1) {
            const entry = rawEntries[i];
            const displayUrl = toDisplayUrl(entry?.url || '');
            if (!canStoreRecentlyClosedUrl(displayUrl)) continue;
            entries.push({
                ...entry,
                url: resolveInternalPageUrl(displayUrl),
                title: entry?.title || displayUrl,
            });
            if (i <= activeIndex) index = entries.length - 1;
        }

        if (entries.length === 0) return null;
        return { entries, index: Math.max(0, Math.min(index, entries.length - 1)) };
    } catch (err) {
        console.warn('Failed to capture navigation history snapshot:', err?.message || err);
        return null;
    }
}

function captureClosedTabSnapshot(context, tabId) {
    if (!context || !tabId) return null;
    if (detachedTabWindows.has(tabId)) return null;

    if (context.sleepingTabs[tabId]) {
        const sleep = context.sleepingTabs[tabId];
        const displayUrl = toDisplayUrl(sleep.url || '');
        if (!canStoreRecentlyClosedUrl(displayUrl)) return null;
        return {
            id: tabId,
            title: (sleep.title || '').trim() || displayUrl,
            url: displayUrl,
            history: sleep.history || null,
            favicon: sleep.favicon || null,
            isSleeping: true,
        };
    }

    const view = context.tabs[tabId];
    if (!view || view.webContents.isDestroyed()) return null;
    const tabWebContents = view.webContents;
    const rawUrl = tabWebContents.getURL();
    const displayUrl = toDisplayUrl(rawUrl);
    if (!canStoreRecentlyClosedUrl(displayUrl)) return null;
    return {
        id: tabId,
        title: (tabWebContents.getTitle() || '').trim() || displayUrl,
        url: displayUrl,
        history: captureNavigationHistorySnapshot(tabWebContents),
        favicon: null,
        isSleeping: false,
    };
}

function captureClosedWindowSnapshot(context) {
    if (!context || context.stealthWindow) return null;

    const sessionWindow = readDecodedSessionDoc()?.windowsById?.[context.windowId] || null;
    const persistedTabsById = new Map(
        Array.isArray(sessionWindow?.tabs)
            ? sessionWindow.tabs
                .filter((tab) => tab?.id)
                .map((tab) => [tab.id, tab])
            : [],
    );
    const tabIds = new Set([
        ...persistedTabsById.keys(),
        ...Object.keys(context.tabs),
        ...Object.keys(context.sleepingTabs),
    ]);
    const tabs = [];
    for (const tabId of tabIds) {
        const snap = captureClosedTabSnapshot(context, tabId) || persistedTabsById.get(tabId);
        if (snap) tabs.push(snap);
    }
    if (tabs.length === 0) return null;

    let activeTabId = context.activeTabId || sessionWindow?.activeTabId;
    if (!activeTabId || !tabs.some((t) => t.id === activeTabId)) {
        activeTabId = tabs[tabs.length - 1].id;
    }

    return {
        type: 'window',
        profileId: context.profileId,
        tabs,
        activeTabId,
    };
}

function recentlyClosedEntryLabel(entry) {
    if (!entry) return '';
    if (entry.type === 'window') {
        const count = entry.tabs?.length || 0;
        if (count === 1) {
            const only = entry.tabs[0];
            return truncateMenuLabel(only.title || only.url || 'Tab');
        }
        return `Window (${count} tabs)`;
    }
    return truncateMenuLabel(entry.title || entry.url);
}

function recentlyClosedEntryTooltip(entry) {
    if (!entry) return '';
    if (entry.type === 'window') {
        return (entry.tabs || []).map((t) => t.url).filter(Boolean).join('\n');
    }
    return entry.url || '';
}

function pushRecentlyClosedEntry(profileId, entry) {
    if (!profileId || !entry) return;
    const stack = getOrCreateRecentlyClosedForProfile(profileId);
    let normalized;

    if (entry.type === 'window') {
        const tabs = (entry.tabs || []).filter((t) => t && canStoreRecentlyClosedUrl(t.url));
        if (tabs.length === 0) return;
        let activeTabId = entry.activeTabId;
        if (!activeTabId || !tabs.some((t) => t.id === activeTabId)) {
            activeTabId = tabs[tabs.length - 1].id;
        }
        normalized = {
            type: 'window',
            profileId: entry.profileId || profileId,
            tabs,
            activeTabId,
            closedAt: Date.now(),
        };
    } else {
        if (!canStoreRecentlyClosedUrl(entry.url)) return;
        normalized = {
            type: 'tab',
            title: (entry.title || '').trim(),
            url: toDisplayUrl(entry.url),
            history: entry.history || null,
            closedAt: Date.now(),
        };
    }

    stack.unshift(normalized);
    if (stack.length > MAX_RECENTLY_CLOSED_TABS) {
        stack.length = MAX_RECENTLY_CLOSED_TABS;
    }
    appLogger.info('recently-closed:push', {
        profileId,
        type: normalized.type,
        url: normalized.url,
        tabCount: normalized.tabs?.length || undefined,
        stackSize: stack.length,
    });
    rebuildApplicationMenu();
}

/** @deprecated Use pushRecentlyClosedEntry */
function pushRecentlyClosedTab(profileId, entry) {
    if (!entry) return;
    pushRecentlyClosedEntry(profileId, { type: 'tab', ...entry });
}

function restoreRecentlyClosedTabInContext(context, entry) {
    if (!context || !entry?.url) return false;
    const newTabId = generateTabId();
    const stealthTab = !!context.stealthWindow;
    const resolvedUrl = resolveTabLoadUrl(entry.url);
    createTab(context, newTabId, resolvedUrl, stealthTab, {
        activate: true,
        navigationHistory: entry.history,
    });
    appLogger.info('recently-closed:restore-tab', {
        windowId: context.windowId,
        profileId: context.profileId,
        tabId: newTabId,
        url: entry.url,
        historyLength: entry.history?.entries?.length || 0,
    });

    if (context.window && !context.window.webContents.isDestroyed()) {
        context.window.webContents.send(C.IPC_EVENT.TAB_CREATED, {
            id: newTabId,
            isStealth: stealthTab,
            url: toDisplayUrl(entry.url),
            title: entry.title || '',
        });
    }
    return true;
}

function restoreRecentlyClosedWindowEntry(entry) {
    const profileId = entry?.profileId;
    if (!profileId || !entry?.tabs?.length) return false;
    ensureProfile(profileId);
    const targetContext = createWindow({ profileId });
    windowBootstrapById.set(targetContext.windowId, {
        restoreWindow: {
            tabs: entry.tabs,
            activeTabId: entry.activeTabId,
        },
    });
    appLogger.info('recently-closed:restore-window', {
        profileId,
        windowId: targetContext.windowId,
        tabCount: entry.tabs.length,
        activeTabId: entry.activeTabId,
    });
    return true;
}

function consumeRecentlyClosedWindowForProfile(profileId) {
    if (!profileId) return null;
    const stack = getOrCreateRecentlyClosedForProfile(profileId);
    const index = stack.findIndex((entry) => (
        entry?.type === 'window' &&
        entry.profileId === profileId &&
        Array.isArray(entry.tabs) &&
        entry.tabs.length > 0
    ));
    if (index < 0) return null;
    const [entry] = stack.splice(index, 1);
    rebuildApplicationMenu();
    appLogger.info('recently-closed:consume-window-for-profile', {
        profileId,
        closedAt: entry.closedAt,
        tabCount: entry.tabs.length,
        remaining: stack.length,
    });
    return entry;
}

function restoreRecentlyClosedEntry(context, entry) {
    if (!entry) return false;
    if (entry.type === 'window') {
        return restoreRecentlyClosedWindowEntry(entry);
    }
    return restoreRecentlyClosedTabInContext(context, entry);
}

function resolveRestoreTargetContext(profileId) {
    const focused = getWindowContextForShellFallback();
    if (focused && focused.profileId === profileId) return focused;
    for (const ctx of windowContextsById.values()) {
        if (
            ctx.profileId === profileId &&
            !ctx.stealthWindow &&
            ctx.window &&
            !ctx.window.isDestroyed()
        ) {
            return ctx;
        }
    }
    return createWindow({ profileId });
}

function restoreRecentlyClosed(closedAt = null) {
    const focusedContext = getWindowContextForShellFallback();
    const profileId = focusedContext?.profileId || defaultProfileId;
    if (!profileId) return;

    const stack = getOrCreateRecentlyClosedForProfile(profileId);
    if (stack.length === 0) return;

    const targetIndex = closedAt == null
        ? 0
        : stack.findIndex((entry) => entry && entry.closedAt === closedAt);
    if (targetIndex < 0) return;
    const [entry] = stack.splice(targetIndex, 1);
    rebuildApplicationMenu();
    if (!entry) return;
    appLogger.info('recently-closed:restore', {
        profileId,
        type: entry.type,
        closedAt: entry.closedAt,
        remaining: stack.length,
    });

    if (entry.type === 'window') {
        restoreRecentlyClosedWindowEntry(entry);
        return;
    }

    const targetContext = resolveRestoreTargetContext(entry.profileId || profileId);
    restoreRecentlyClosedTabInContext(targetContext, entry);
}

/** @deprecated Use restoreRecentlyClosed */
function restoreRecentlyClosedTab(closedAt = null) {
    restoreRecentlyClosed(closedAt);
}

function buildRecentlyClosedMenuItems() {
    const context = getWindowContextForShellFallback();
    if (!context) return [{ label: 'No recently closed tabs', enabled: false }];
    const stack = getOrCreateRecentlyClosedForProfile(context.profileId);
    if (stack.length === 0) {
        return [{ label: 'No recently closed tabs', enabled: false }];
    }

    return stack.map((entry) => ({
        label: recentlyClosedEntryLabel(entry),
        toolTip: recentlyClosedEntryTooltip(entry),
        click: () => restoreRecentlyClosed(entry.closedAt),
    }));
}

function buildApplicationMenu() {
    return Menu.buildFromTemplate([
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Tab',
                    accelerator: 'CmdOrCtrl+T',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_NEW_TAB)
                },
                {
                    label: 'New Stealth Window',
                    accelerator: 'CmdOrCtrl+Shift+N',
                    click: () => {
                        const w = getFocusedShellWindow() || mainWindow;
                        const context = getWindowContextByBrowserWindow(w);
                        if (!context) return;
                        createWindow({ profileId: context.profileId, stealthWindow: true });
                    },
                },
                {
                    label: 'New Window',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        const w = getFocusedShellWindow() || mainWindow;
                        const context = getWindowContextByBrowserWindow(w);
                        if (!context) return;
                        createWindow({ profileId: context.profileId });
                    },
                },
                {
                    label: 'Close Tab',
                    accelerator: 'CmdOrCtrl+W',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_CLOSE_TAB)
                },
                {
                    label: 'Print...',
                    accelerator: 'CmdOrCtrl+P',
                    click: () => printActiveTab(),
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
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_RELOAD)
                },
                { type: 'separator' },
                {
                    label: 'Settings page',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => openOrActivateSettingsTab(),
                },
                {
                    label: 'Developer',
                    submenu: [
                        {
                            label: 'View Source',
                            click: () => openViewSourceForActiveTab(),
                        },
                        {
                            label: 'Inspect Elements',
                            click: () => openDevToolsForActiveTab('elements'),
                        },
                        {
                            label: 'JavaScript Console',
                            click: () => openDevToolsForActiveTab('console'),
                        },
                    ],
                },
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
        },
        {
            label: 'History',
            submenu: [
                {
                    label: 'Show History',
                    accelerator: 'CmdOrCtrl+Y',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_HISTORY),
                },
                { type: 'separator' },
                { label: 'Home', click: () => navigateActiveTabHome() },
                { label: 'Back', click: () => goBackInActiveTab() },
                { label: 'Forward', click: () => goForwardInActiveTab() },
                { type: 'separator' },
                {
                    label: 'Reopen Closed Tab',
                    accelerator: 'CmdOrCtrl+Shift+T',
                    enabled: (() => {
                        const context = getWindowContextForShellFallback();
                        return !!context && getOrCreateRecentlyClosedForProfile(context.profileId).length > 0;
                    })(),
                    click: () => restoreRecentlyClosed(),
                },
                { label: 'Recently Closed', enabled: false },
                ...buildRecentlyClosedMenuItems(),
            ]
        },
        {
            label: 'Tab',
            submenu: [
                {
                    label: 'New Tab to the Right',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_NEW_RIGHT),
                },
                { type: 'separator' },
                {
                    label: 'Select Next Tab',
                    accelerator: 'Control+Tab',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_SWITCH_TAB, { direction: 1 }),
                },
                {
                    label: 'Select Previous Tab',
                    accelerator: 'Control+Shift+Tab',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_SWITCH_TAB, { direction: -1 }),
                },
                { type: 'separator' },
                {
                    label: 'Duplicate Tab',
                    accelerator: 'CommandOrControl+Shift+D',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_DUPLICATE),
                },
                {
                    label: tabMenuMuteSiteShowsUnmute ? 'Unmute Site' : 'Mute Site',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_MUTE),
                },
                {
                    label: tabMenuPinShowsUnpin ? 'Unpin Tab' : 'Pin Tab',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_PIN),
                },
                {
                    label: 'Group Tab',
                    enabled: false,
                },
                { type: 'separator' },
                {
                    label: 'Close Other Tabs',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_CLOSE_OTHERS),
                },
                {
                    label: 'Close Tabs to the Right',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_CLOSE_RIGHT),
                },
                { type: 'separator' },
                {
                    label: 'Move Tab to New Window',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_MOVE_WINDOW),
                },
                {
                    label: 'Search Tabs…',
                    accelerator: 'Shift+CommandOrControl+A',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_TAB_SEARCH),
                },
            ],
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Search…',
                    accelerator: 'CommandOrControl+Shift+P',
                    click: () => focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_COMMAND_PALETTE),
                },
            ],
        },
    ]);
}

function runMenuCommandFromPalette(commandId) {
    switch (commandId) {
        case C.MENU_COMMAND.OPEN_SETTINGS:
            openOrActivateSettingsTab();
            return true;
        case C.MENU_COMMAND.NAVIGATE_HOME:
            navigateActiveTabHome();
            return true;
        case C.MENU_COMMAND.HISTORY_BACK:
            goBackInActiveTab();
            return true;
        case C.MENU_COMMAND.HISTORY_FORWARD:
            goForwardInActiveTab();
            return true;
        case C.MENU_COMMAND.VIEW_SOURCE:
            openViewSourceForActiveTab();
            return true;
        case C.MENU_COMMAND.DEVTOOLS_ELEMENTS:
            openDevToolsForActiveTab(C.DEVTOOLS_PANEL.ELEMENTS);
            return true;
        case C.MENU_COMMAND.DEVTOOLS_CONSOLE:
            openDevToolsForActiveTab(C.DEVTOOLS_PANEL.CONSOLE);
            return true;
        case C.MENU_COMMAND.TOGGLE_FULLSCREEN:
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
            return true;
        case C.MENU_COMMAND.QUIT:
            app.quit();
            return true;
        case C.MENU_COMMAND.NEW_WINDOW_CURRENT_PROFILE: {
            const context = getWindowContextByBrowserWindow(mainWindow);
            if (!context) return false;
            createWindow({ profileId: context.profileId });
            return true;
        }
        case C.MENU_COMMAND.EDIT_UNDO: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.undo();
            return true;
        }
        case C.MENU_COMMAND.EDIT_REDO: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.redo();
            return true;
        }
        case C.MENU_COMMAND.EDIT_CUT: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.cut();
            return true;
        }
        case C.MENU_COMMAND.EDIT_COPY: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.copy();
            return true;
        }
        case C.MENU_COMMAND.EDIT_PASTE: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.paste();
            return true;
        }
        case C.MENU_COMMAND.EDIT_SELECT_ALL: {
            const focused = webContents.getFocusedWebContents();
            if (focused && !focused.isDestroyed()) focused.selectAll();
            return true;
        }
        case C.MENU_COMMAND.OPEN_DOWNLOADS:
            return openDownloadsFolder();
        case C.MENU_COMMAND.PRINT_ACTIVE_TAB:
            return printActiveTab();
        case C.MENU_COMMAND.FIND_IN_PAGE:
            return triggerFindInActiveTab();
        case C.MENU_COMMAND.SEARCH_WITH_GOOGLE_LENS:
            return searchActiveTabWithGoogleLens();
        default:
            return false;
    }
}

function rebuildApplicationMenu() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    Menu.setApplicationMenu(buildApplicationMenu());
}

ipcMain.handle(C.IPC_INVOKE.RUN_MENU_COMMAND, (event, commandId) => {
    if (!isSenderTrusted(event)) return false;
    if (typeof commandId !== 'string') return false;
    return runMenuCommandFromPalette(commandId);
});

ipcMain.handle(C.IPC_INVOKE.GOOGLE_LENS_ACTIVE_FOR_PROFILE, (event) => {
    if (!isSenderTrusted(event)) return false;
    const context = getWindowContextByEventSender(event.sender);
    if (!context?.profileId) return false;
    return !!findActiveLensTabForProfile(context.profileId);
});

ipcMain.handle(C.IPC_INVOKE.IS_STEALTH_WINDOW, (event) => {
    if (!isSenderTrusted(event)) return false;
    const ctx = getWindowContextByEventSender(event.sender);
    return !!(ctx && ctx.stealthWindow);
});

ipcMain.handle(C.IPC_INVOKE.WINDOW_CREATE, (event, payload = {}) => {
    if (!isSenderTrusted(event)) return null;
    const senderContext = getWindowContextByEventSender(event.sender);
    if (!senderContext) return null;
    const profileId = typeof payload.profileId === 'string' && payload.profileId.trim()
        ? payload.profileId.trim()
        : senderContext.profileId;
    ensureProfile(profileId);
    const created = createWindow({ profileId });
    return { windowId: created.windowId, profileId };
});

ipcMain.handle(C.IPC_INVOKE.WINDOW_CREATE_STEALTH, (event) => {
    if (!isSenderTrusted(event)) return { ok: false };
    const senderContext = getWindowContextByEventSender(event.sender);
    const profileId = senderContext?.profileId || defaultProfileId;
    if (!profileId) return { ok: false };
    ensureProfile(profileId);
    createWindow({ profileId, stealthWindow: true });
    return { ok: true };
});

/** When the last stealth tab is closed, the shell asks to close the whole window (Chrome-like incognito). */
ipcMain.handle(C.IPC_INVOKE.WINDOW_CLOSE_IF_STEALTH, (event) => {
    if (!isSenderTrusted(event)) return { ok: false };
    const context = getWindowContextByEventSender(event.sender);
    if (!context?.stealthWindow) return { ok: false };
    try {
        if (!context.window.isDestroyed()) context.window.close();
    } catch (_) {
        return { ok: false };
    }
    return { ok: true };
});

/** Close the browser shell window that owns the sender (normal or stealth). */
ipcMain.handle(C.IPC_INVOKE.WINDOW_CLOSE_CURRENT, (event) => {
    if (!isSenderTrusted(event)) return { ok: false };
    const context = getWindowContextByEventSender(event.sender);
    if (!context?.window || context.window.isDestroyed()) return { ok: false };
    try {
        context.window.close();
    } catch (_) {
        return { ok: false };
    }
    return { ok: true };
});

ipcMain.handle(C.IPC_INVOKE.WINDOW_GET_BOOTSTRAP, (event) => {
    if (!isSenderTrusted(event)) return null;
    const context = getWindowContextByEventSender(event.sender);
    if (!context) return null;
    const payload = windowBootstrapById.get(context.windowId) || null;
    windowBootstrapById.delete(context.windowId);
    return payload;
});

ipcMain.handle(C.IPC_INVOKE.PROFILE_LIST, (event) => {
    if (!isSenderTrusted(event)) return [];
    return Array.from(profilesById.values());
});

ipcMain.handle(C.IPC_INVOKE.PROFILE_GET_CURRENT, (event) => {
    if (!isSenderTrusted(event)) return null;
    const context = getWindowContextByEventSender(event.sender);
    if (!context) return null;
    return profilesById.get(context.profileId) || null;
});

ipcMain.handle(C.IPC_INVOKE.PROFILE_CREATE, (event, payload = {}) => {
    if (!isSenderTrusted(event)) return null;
    const displayName = typeof payload.displayName === 'string' && payload.displayName.trim()
        ? payload.displayName.trim()
        : `Profile ${profilesById.size + 1}`;
    const profileId = `profile-${crypto.randomUUID()}`;
    const profile = ensureProfile(profileId, displayName);
    saveProfiles();
    return profile;
});

ipcMain.handle(C.IPC_INVOKE.PROFILE_UPDATE, (event, payload = {}) => {
    if (!isSenderTrusted(event)) return null;
    if (!payload || typeof payload.profileId !== 'string') return null;
    const sid = String(payload.profileId).trim().replace(/[^a-zA-Z0-9-_]/g, '_');
    const p = profilesById.get(sid);
    if (!p) return null;
    const name = typeof payload.displayName === 'string' ? payload.displayName.trim() : '';
    if (!name || name.length > 128) return null;
    p.displayName = name;
    p.updatedAt = Date.now();
    saveProfiles();
    return p;
});

ipcMain.handle(C.IPC_INVOKE.PROFILE_SET_AVATAR_DATA, (event, payload = {}) => {
    if (!isSenderTrusted(event)) return { ok: false, error: 'Unauthorized' };
    if (!payload || typeof payload.profileId !== 'string' || typeof payload.dataUrl !== 'string') {
        return { ok: false, error: 'Invalid payload' };
    }
    return setProfileAvatarFromDataUrl(payload.profileId, payload.dataUrl);
});

ipcMain.handle(C.IPC_INVOKE.PROFILE_SET_AVATAR_PRESET, (event, payload = {}) => {
    if (!isSenderTrusted(event)) return { ok: false, error: 'Unauthorized' };
    if (!payload || typeof payload.profileId !== 'string' || typeof payload.fileName !== 'string') {
        return { ok: false, error: 'Invalid payload' };
    }
    return setProfileAvatarFromPresetPngFile(payload.profileId, payload.fileName);
});

ipcMain.handle(C.IPC_INVOKE.PROFILE_VALIDATE_AVATAR, (event, payload = {}) => {
    if (!isSenderTrusted(event)) return { ok: false, error: 'Unauthorized' };
    if (!payload || typeof payload.dataUrl !== 'string') {
        return { ok: false, error: 'No image' };
    }
    const r = validateAvatarDataUrl(payload.dataUrl);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true };
});

/** Lists `<index>.png` files under renderer/assets/images/profiles (numeric basename only). */
ipcMain.handle(C.IPC_INVOKE.PROFILE_LIST_PRESETS, (event) => {
    if (!isSenderTrusted(event)) return { ok: false, error: 'Unauthorized', files: [] };
    const dir = PRESET_AVATAR_PNG_DIR;
    try {
        if (!fs.existsSync(dir)) return { ok: true, files: [] };
        const names = fs.readdirSync(dir);
        const pngs = names.filter((n) => /^\d+\.png$/i.test(n));
        pngs.sort((a, b) => parseInt(a.replace(/\.png$/i, ''), 10) - parseInt(b.replace(/\.png$/i, ''), 10));
        return { ok: true, files: pngs };
    } catch (err) {
        console.error(C.IPC_INVOKE.PROFILE_LIST_PRESETS, err);
        return { ok: false, error: String(err?.message || err), files: [] };
    }
});

ipcMain.handle(C.IPC_INVOKE.PROFILE_CLEAR_AVATAR, (event, payload = {}) => {
    if (!isSenderTrusted(event)) return { ok: false };
    if (!payload || typeof payload.profileId !== 'string') return { ok: false };
    const sid = String(payload.profileId).trim().replace(/[^a-zA-Z0-9-_]/g, '_');
    const p = profilesById.get(sid);
    if (!p) return { ok: false };
    removeAvatarFilesForProfile(payload.profileId);
    p.hasCustomAvatar = false;
    p.avatarExt = null;
    p.avatarSource = null;
    p.updatedAt = Date.now();
    saveProfiles();
    return { ok: true, profile: p };
});

ipcMain.handle(C.IPC_INVOKE.PROFILE_GET_AVATAR, (event, payload = {}) => {
    if (!isSenderTrusted(event)) return { dataUrl: null };
    if (!payload || typeof payload.profileId !== 'string') return { dataUrl: null };
    const dataUrl = getProfileAvatarDataUrl(payload.profileId);
    return { dataUrl: dataUrl || null };
});

ipcMain.handle(C.IPC_INVOKE.PROFILE_DELETE, (event, payload = {}) => {
    if (!isSenderTrusted(event)) return { ok: false, error: 'Unauthorized' };
    if (!payload || typeof payload.profileId !== 'string') return { ok: false, error: 'Invalid request' };
    const sid = String(payload.profileId).trim().replace(/[^a-zA-Z0-9-_]/g, '_');
    if (!profilesById.has(sid)) return { ok: false, error: 'Profile not found' };
    if (profilesById.size <= 1) {
        return { ok: false, error: 'You can’t delete the last profile' };
    }
    for (const ctx of windowContextsById.values()) {
        if (ctx.profileId === sid) {
            return { ok: false, error: 'Close all browser windows for this profile first' };
        }
    }
    removeAvatarFilesForProfile(sid);
    profilesById.delete(sid);
    if (defaultProfileId === sid) {
        defaultProfileId = Array.from(profilesById.keys())[0] || null;
    }
    saveProfiles();
    return { ok: true };
});

ipcMain.handle(C.IPC_INVOKE.PROFILE_OPEN_WINDOW, (event, payload = {}) => {
    if (!isSenderTrusted(event)) return null;
    if (!payload || typeof payload.profileId !== 'string') return null;
    const profile = ensureProfile(payload.profileId);
    saveProfiles();
    const closePicker = payload.closeProfilePicker === true;
    const closedWindow = closePicker ? consumeRecentlyClosedWindowForProfile(profile.profileId) : null;
    const sessionForWindowId = closePicker && !closedWindow
        ? (startupSessionDoc || readDecodedSessionDoc())
        : null;
    const resolvedWindowId = findSessionWindowIdForProfile(sessionForWindowId, profile.profileId);
    const created = createWindow({ profileId: profile.profileId, windowId: resolvedWindowId });
    if (closedWindow) {
        windowBootstrapById.set(created.windowId, {
            restoreWindow: {
                tabs: closedWindow.tabs,
                activeTabId: closedWindow.activeTabId,
            },
        });
    }
    if (closePicker) {
        startupSessionDoc = null;
        if (profilePickerWindow && !profilePickerWindow.isDestroyed()) {
            profilePickerWindow.close();
        }
    }
    return { windowId: created.windowId, profileId: profile.profileId };
});

ipcMain.handle(C.IPC_INVOKE.PROFILE_PICKER_OPEN, (event) => {
    if (!isSenderTrusted(event)) return { ok: false };
    createProfilePickerWindow();
    return { ok: true };
});

ipcMain.handle(C.IPC_INVOKE.PROFILE_CLOSE_CURRENT, (event) => {
    if (!isSenderTrusted(event)) return { ok: false };
    const context = getWindowContextByEventSender(event.sender);
    const profileId = context?.profileId;
    if (!profileId) return { ok: false };
    const targets = Array.from(windowContextsById.values()).filter((ctx) => (
        ctx?.profileId === profileId &&
        ctx.window &&
        !ctx.window.isDestroyed()
    ));
    if (targets.length === 0) {
        return { ok: true };
    }
    for (const target of targets) {
        try {
            target.window.close();
        } catch (err) {
            console.error(C.IPC_INVOKE.PROFILE_CLOSE_CURRENT, err?.message || err);
        }
    }
    return { ok: true, closed: targets.length };
});

ipcMain.handle(C.IPC_INVOKE.RECENTLY_CLOSED_LIST, (event) => {
    if (!isSenderTrusted(event)) return [];
    const context = getWindowContextByEventSender(event.sender) || getWindowContextForShellFallback();
    if (!context?.profileId) return [];
    const stack = getOrCreateRecentlyClosedForProfile(context.profileId);
    return stack.slice(0, 15).map((entry) => ({
        type: entry?.type === 'window' ? 'window' : 'tab',
        label: recentlyClosedEntryLabel(entry),
        subtitle: entry?.type === 'window'
            ? `${entry?.tabs?.length || 0} tabs`
            : (entry?.url || ''),
        closedAt: entry?.closedAt || null,
    }));
});

ipcMain.handle(C.IPC_INVOKE.RECENTLY_CLOSED_RESTORE, (event, payload = {}) => {
    if (!isSenderTrusted(event)) return { ok: false };
    const closedAt = typeof payload?.closedAt === 'number' ? payload.closedAt : null;
    restoreRecentlyClosed(closedAt);
    return { ok: true };
});


ipcMain.on(C.IPC_SEND.TOOLTIP_SHOW, (e, { title, url, memory, x, y, width, height }) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context?.tooltipView) return;

    ensureChromeOverlayOnTop(context);

    // Position and size the overlay view
    context.tooltipView.setBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
    });
    context.tooltipView.webContents.send(C.IPC_EVENT.TOOLTIP_UPDATE, { title, url, memory });
});

ipcMain.on(C.IPC_SEND.TOOLTIP_HIDE, (e) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (context?.tooltipView) {
        context.tooltipView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
});

// ─── Chrome overlay layer (HTML above tab WebContentsView, no tab detach) ───
const CHROME_OVERLAY_POST_MAX_BYTES = 256 * 1024;

const SHELL_MENU_OVERLAY_KINDS = new Set([
    'appMenu',
    'profileMenu',
    'bookmarkContextMenu',
    'bookmarkFolderMenu',
    'bookmarkEditor',
    'siteInfo',
    'cookieControls',
    'downloadPanel',
]);

function isShellMenuOverlayKind(kind) {
    return typeof kind === 'string' && SHELL_MENU_OVERLAY_KINDS.has(kind);
}

function ensureChromeShellMenuOverlayLayer(context) {
    if (!context) return;
    createChromeShellMenuOverlayLayer(context);
}

function ensureChromeOmniboxOverlayLayer(context) {
    if (!context) return;
    createChromeOmniboxOverlayLayer(context);
}

/** Clear omnibox popup only; never touch the Lens overlay surface. */
ipcMain.handle(C.IPC_INVOKE.CHROME_OVERLAY_RESET, (e) => {
    if (!isSenderTrusted(e)) return { ok: false };
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return { ok: false };
    ensureChromeOmniboxOverlayLayer(context);
    context.chromeOmniboxOverlayAcquireCount = 0;
    context.chromeOverlayOmniboxMode = false;
    context.lastOmniboxOverlayPatch = null;
    context.chromeOverlayBlurDismissPending = false;
    try {
        if (context.chromeOmniboxOverlayView && !context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
            context.chromeOmniboxOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
            context.chromeOmniboxOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        }
    } catch (err) {
        console.error(C.IPC_INVOKE.CHROME_OVERLAY_RESET, err?.message || err);
    }
    try {
        if (context.window?.webContents && !context.window.webContents.isDestroyed()) {
            context.window.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_SUPERSEDED);
        }
    } catch (err) {
        console.error('chrome-overlay:v1:superseded send', err?.message || err);
    }
    return { ok: true };
});

ipcMain.handle(C.IPC_INVOKE.CHROME_OVERLAY_ACQUIRE, (e) => {
    if (!isSenderTrusted(e)) return { ok: false };
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return { ok: false };
    ensureChromeOmniboxOverlayLayer(context);
    context.chromeOmniboxOverlayAcquireCount = (context.chromeOmniboxOverlayAcquireCount || 0) + 1;
    ensureChromeOverlayOnTop(context);
    return { ok: true };
});

ipcMain.handle(C.IPC_INVOKE.CHROME_OVERLAY_RELEASE, (e) => {
    if (!isSenderTrusted(e)) return { ok: false };
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return { ok: false };
    if (context.chromeOmniboxOverlayAcquireCount > 0) {
        context.chromeOmniboxOverlayAcquireCount -= 1;
    }
    if (context.chromeOmniboxOverlayAcquireCount <= 0) {
        context.chromeOmniboxOverlayAcquireCount = 0;
        context.chromeOverlayOmniboxMode = false;
        context.lastOmniboxOverlayPatch = null;
        context.chromeOverlayBlurDismissPending = false;
        try {
            if (context.chromeOmniboxOverlayView && !context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
                context.chromeOmniboxOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
                context.chromeOmniboxOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            }
        } catch (err) {
            console.error(C.IPC_INVOKE.CHROME_OVERLAY_RELEASE, err?.message || err);
        }
    }
    ensureChromeOverlayOnTop(context);
    return { ok: true };
});

ipcMain.handle(C.IPC_INVOKE.CHROME_OVERLAY_POST, (e, payload) => {
    if (!isSenderTrusted(e)) return { ok: false };
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return { ok: false };
    if ((context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return { ok: false };
    try {
        const json = JSON.stringify(payload ?? {});
        if (json.length > CHROME_OVERLAY_POST_MAX_BYTES) return { ok: false };
    } catch {
        return { ok: false };
    }
    const patch = payload ?? {};
    if (patch.kind !== 'omniboxSuggestions') return { ok: false };
    ensureChromeOmniboxOverlayLayer(context);
    if (!context.chromeOmniboxOverlayView || context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
        return { ok: false };
    }
    return deliverOmniboxOverlayPatch(context, patch);
});

ipcMain.handle(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_RESET, (e) => {
    if (!isSenderTrusted(e)) return { ok: false };
    const context = getWindowContextByEventSender(e.sender);
    if (!context?.chromeShellMenuOverlayView) return { ok: false };
    context.chromeShellMenuOverlayAcquireCount = 0;
    try {
        if (!context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
            context.chromeShellMenuOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
            context.chromeShellMenuOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        }
    } catch (err) {
        console.error(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_RESET, err?.message || err);
    }
    try {
        if (context.window?.webContents && !context.window.webContents.isDestroyed()) {
            context.window.webContents.send(C.IPC_EVENT.CHROME_SHELL_MENU_OVERLAY_SUPERSEDED);
        }
    } catch (err) {
        console.error('chrome-shell-menu-overlay:v1:superseded send', err?.message || err);
    }
    return { ok: true };
});

ipcMain.handle(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_ACQUIRE, (e) => {
    if (!isSenderTrusted(e)) return { ok: false };
    const context = getWindowContextByEventSender(e.sender);
    if (!context?.chromeShellMenuOverlayView) return { ok: false };
    ensureChromeShellMenuOverlayLayer(context);
    context.chromeShellMenuOverlayAcquireCount = (context.chromeShellMenuOverlayAcquireCount || 0) + 1;
    ensureChromeOverlayOnTop(context);
    return { ok: true };
});

ipcMain.handle(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_RELEASE, (e) => {
    if (!isSenderTrusted(e)) return { ok: false };
    const context = getWindowContextByEventSender(e.sender);
    if (!context?.chromeShellMenuOverlayView) return { ok: false };
    if (context.chromeShellMenuOverlayAcquireCount > 0) {
        context.chromeShellMenuOverlayAcquireCount -= 1;
    }
    if (context.chromeShellMenuOverlayAcquireCount <= 0) {
        context.chromeShellMenuOverlayAcquireCount = 0;
        try {
            if (!context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
                context.chromeShellMenuOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
                context.chromeShellMenuOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            }
        } catch (err) {
            console.error(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_RELEASE, err?.message || err);
        }
    }
    ensureChromeOverlayOnTop(context);
    return { ok: true };
});

ipcMain.handle(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_POST, (e, payload) => {
    if (!isSenderTrusted(e)) return { ok: false };
    const context = getWindowContextByEventSender(e.sender);
    if (!context?.chromeShellMenuOverlayView || context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
        return { ok: false };
    }
    if ((context.chromeShellMenuOverlayAcquireCount || 0) <= 0) return { ok: false };
    const patch = payload ?? {};
    if (!isShellMenuOverlayKind(patch.kind)) return { ok: false };
    try {
        const json = JSON.stringify(patch);
        if (json.length > CHROME_OVERLAY_POST_MAX_BYTES) {
            console.error('CHROME_OVERLAY_POST_MAX_BYTES exceeded! Size:', json.length, 'Kind:', patch.kind);
            return { ok: false };
        }
    } catch {
        return { ok: false };
    }
    try {
        const overlayBounds = computeMenuOverlayBounds(context, patch);
        if (overlayBounds) {
            context.chromeShellMenuOverlayView.setBounds({
                x: overlayBounds.x,
                y: overlayBounds.y,
                width: overlayBounds.width,
                height: overlayBounds.height,
            });
            patch.overlayBounds = overlayBounds;
            patch.overlayViewport = {
                width: overlayBounds.viewportWidth,
                height: overlayBounds.viewportHeight,
            };
        }
        ensureChromeOverlayOnTop(context);
        context.chromeShellMenuOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, patch);

        if (patch.focusInput !== false) {
            setImmediate(() => {
                focusChromeShellMenuOverlayWebContents(context);
            });
        }
    } catch (err) {
        console.error(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_POST, err?.message || err);
        return { ok: false };
    }
    return { ok: true };
});

ipcMain.on(C.IPC_SEND.CHROME_OVERLAY_FROM_OVERLAY, (e, data) => {
    const context = getWindowContextByChromeOverlaySender(e.sender);
    if (!context?.window?.webContents || context.window.webContents.isDestroyed()) return;
    if (data?.type === 'lensSelectionCapture') {
        captureGoogleLensSelection(context, data.rect).catch((err) => {
            console.error('lensSelectionCapture', err?.message || err);
        });
        return;
    }
    if (data?.type === 'lensSelectionCancel') {
        closeGoogleLensSelection(context, { closeSidebar: data.closeSidebar === true });
        return;
    }
    if (data?.type === 'lensSidebarResize') {
        resizeGoogleLensSidebar(context, data.width);
        return;
    }
    if (data?.type === 'lensSidebarResizeCommit') {
        commitGoogleLensSidebarResize(context, data.width);
        return;
    }
    if (data?.type === 'lensCopyImage') {
        copyLensSelectionImage(context);
        return;
    }
    if (data?.type === 'lensCopyText') {
        copyLensSelectionText(context).catch((err) => {
            console.error('lensCopyText', err?.message || err);
        });
        return;
    }
    try {
        context.window.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_HOST, data ?? {});
    } catch (err) {
        console.error(C.IPC_SEND.CHROME_OVERLAY_FROM_OVERLAY, err?.message || err);
    }
});

ipcMain.on(C.IPC_SEND.APP_LOG, (e, payload = {}) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender) || getWindowContextByChromeOverlaySender(e.sender);
    const level = payload.level === 'fatal' || payload.level === 'error' || payload.level === 'warn'
        ? payload.level
        : 'info';
    const event = typeof payload.event === 'string' && payload.event.trim()
        ? payload.event.trim()
        : 'renderer:log';
    const data = {
        ...(payload.data && typeof payload.data === 'object' ? payload.data : {}),
        windowId: context?.windowId || null,
        profileId: context?.profileId || null,
        senderUrl: e.senderFrame?.url || e.sender?.getURL?.() || '',
    };
    appLogger[level](event, data);
});

// Helper to handle keyboard shortcuts across different WebContents
function handleShortcuts(event, input) {
    if (input.type !== 'keyDown') return;

    const key = input.key.toLowerCase();
    const isCommandOrControlPressed = input.control || input.meta;

    const context = getWindowContextForShellFallback();
    const lensSelectionActive = getLensSession(context, context?.activeTabId, false)?.selectionActive;
    if (lensSelectionActive) {
        if (key === ' ' || key === 'space' || input.code === 'Space') {
            event.preventDefault();
            return;
        }
        if (key === 'escape') {
            event.preventDefault();
            closeGoogleLensSelection(context, { closeSidebar: true });
            return;
        }
    }

    if (isCommandOrControlPressed && key === 'y') {
        event.preventDefault();
        focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_HISTORY);
        return;
    }

    if (isCommandOrControlPressed && input.shift && key === 't') {
        event.preventDefault();
        restoreRecentlyClosed();
        return;
    }

    if (isCommandOrControlPressed && !input.shift && key === 'p') {
        event.preventDefault();
        printActiveTab();
        return;
    }

    // Only handle Ctrl+Tab here, as others are handled by the Menu
    if (input.control && input.key === 'Tab') {
        event.preventDefault();
        focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_SWITCH_TAB, { direction: input.shift ? -1 : 1 });
    }
}

function buildDevToolsTypographyCss() {
    let monoStack;
    if (process.platform === C.PLATFORM.DARWIN) {
        monoStack = "ui-monospace, 'SF Mono', Menlo, Monaco, 'Courier New', monospace";
    } else if (process.platform === 'win32') {
        monoStack = "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace";
    } else {
        monoStack = "'Liberation Mono', 'DejaVu Sans Mono', 'Ubuntu Mono', monospace";
    }
    return `:root {
  --monospace-font-family: ${monoStack} !important;
  --source-code-font-family: ${monoStack} !important;
}
body {
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}`;
}

function installDevToolsTypographyOnOpen(webContents) {
    webContents.on('devtools-opened', () => {
        const devTools = webContents.devToolsWebContents;
        if (!devTools || devTools.isDestroyed()) return;
        devTools.insertCSS(buildDevToolsTypographyCss(), { cssOrigin: 'user' }).catch(() => { });
    });
}

// Logic to create a new Tab View
function createTab(context, id, url = C.URL.NTP_DISPLAY, isStealth = false, options = {}) {
    if (!context) return;
    const shouldActivate = options.activate !== false;
    /** Stealth windows: one in-memory partition per window (Chrome-like incognito). Normal windows never use per-tab stealth. */
    const effectiveStealth = !!context.stealthWindow;
    const tabPartition = context.stealthWindow ? context.stealthTabsPartition : context.partition;
    const view = new WebContentsView({
        webPreferences: buildSecureWebPreferences({ partition: tabPartition }),
    });

    context.tabs[id] = view;
    tabIdToWindowId.set(id, context.window.id);
    appLogger.info('tab:create', {
        windowId: context.windowId,
        profileId: context.profileId,
        tabId: id,
        url,
        isStealth: !!isStealth,
        shouldActivate,
        restoresHistory: !!options.navigationHistory,
    });
    // Active tabs are attached via activateTabInContext() so only one tab view is in the
    // hierarchy at a time (avoids stacked views stealing hit-testing until switch-tab runs).
    if (!shouldActivate) {
        addTabContentChildView(context, view);
        view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }

    const webContentsNumericId = view.webContents.id;
    webContentsIdToTabId.set(webContentsNumericId, id);
    resetTabWebContentsScale(view);
    view.webContents.on('destroyed', () => {
        appLogger.info('tab:webcontents-destroyed', {
            windowId: context.windowId,
            profileId: context.profileId,
            tabId: id,
            webContentsId: webContentsNumericId,
        });
        webContentsIdToTabId.delete(webContentsNumericId);
        clearTabTopLevelRegisterableDomain(webContentsNumericId);
    });

    applyIdentityToWebContents(view.webContents);
    installSessionNetworkGuards(view.webContents.session, {
        profileId: context.profileId,
        isStealthSession: !!context.stealthWindow,
    });
    installDevToolsTypographyOnOpen(view.webContents);

    // ─── Security guards for tab content (Rules 13, 14) ────
    // Convert safe popup/new-tab intents into app tabs; block everything else.
    view.webContents.setWindowOpenHandler(({ url: targetUrl, disposition }) => {
        appLogger.info('tab:window-open-request', {
            windowId: context.windowId,
            profileId: context.profileId,
            tabId: id,
            url: targetUrl,
            disposition,
        });
        if (!isAllowedTabNavigationUrl(targetUrl)) {
            console.warn(`[Security] Blocked popup/open to: ${targetUrl}`);
            appLogger.warn('security:blocked-window-open', {
                windowId: context.windowId,
                profileId: context.profileId,
                tabId: id,
                url: targetUrl,
            });
            return { action: 'deny' };
        }

        const isBackgroundTab = disposition === 'background-tab';
        openUrlInNewTab(targetUrl, { background: isBackgroundTab, context });

        return { action: 'deny' };
    });

    // Block navigations to non-http(s) URLs (prevents file:// exfiltration)
    view.webContents.on('will-navigate', (event, targetUrl) => {
        const allowed = isAllowedTabNavigationUrl(targetUrl);
        if (!allowed) {
            console.warn(`[Security] Blocked navigation to: ${targetUrl}`);
            appLogger.warn('security:blocked-navigation', {
                windowId: context.windowId,
                profileId: context.profileId,
                tabId: id,
                url: targetUrl,
            });
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
        appLogger.warn('security:blocked-redirect', {
            windowId: context.windowId,
            profileId: context.profileId,
            tabId: id,
            fromUrl: view.webContents.getURL(),
            targetUrl,
            reason: reasonText,
        });
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
        htmlFullscreenTabId = id;
        const host = getHostWindowForTabId(id);
        host.setFullScreen(true);
        const { width, height } = host.getContentBounds();
        view.setBounds({ x: 0, y: 0, width, height });
    });

    view.webContents.on('leave-html-full-screen', () => {
        htmlFullscreenTabId = null;
        const host = getHostWindowForTabId(id);
        host.setFullScreen(false);
        const { width, height } = host.getContentBounds();
        const detached = detachedTabWindows.has(id);
        view.setBounds(
            detached
                ? { x: 0, y: 0, width, height }
                : { x: 0, y: UI_HEIGHT, width, height: height - UI_HEIGHT },
        );
    });

    // --- SYNCING METADATA TO UI ---
    view.webContents.on('context-menu', (_event, params) => {
        const contextTemplate = [];
        const hasSelection = Boolean(params.selectionText && params.selectionText.trim());
        const linkUrl = params.linkURL || '';
        const imageUrl = params.srcURL || '';
        const isLinkContext = Boolean(linkUrl);
        const isImageContext = params.mediaType === 'image' && Boolean(imageUrl);

        if (isLinkContext) {
            contextTemplate.push(
                {
                    label: 'Open link in new tab',
                    click: () => openUrlInNewTab(linkUrl, { background: false }),
                },
                {
                    label: 'Open link in new tab in background',
                    click: () => openUrlInNewTab(linkUrl, { background: true }),
                },
                {
                    label: 'Open link in current tab',
                    click: () => view.webContents.loadURL(linkUrl),
                },
                {
                    type: 'separator',
                },
                {
                    label: 'Copy link address',
                    click: () => clipboard.writeText(linkUrl),
                },
            );
        }

        if (isImageContext) {
            if (contextTemplate.length > 0) contextTemplate.push({ type: 'separator' });
            contextTemplate.push(
                {
                    label: 'Open image in new tab',
                    click: () => openUrlInNewTab(imageUrl, { background: false }),
                },
                {
                    label: 'Copy image address',
                    click: () => clipboard.writeText(imageUrl),
                },
            );
        }

        if (params.isEditable) {
            if (contextTemplate.length > 0) contextTemplate.push({ type: 'separator' });
            contextTemplate.push(
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
            );
        } else if (hasSelection) {
            if (contextTemplate.length > 0) contextTemplate.push({ type: 'separator' });
            contextTemplate.push({ role: 'copy' });
        }

        if (!params.isEditable) {
            if (contextTemplate.length > 0) contextTemplate.push({ type: 'separator' });
            contextTemplate.push(
                {
                    label: 'Back',
                    enabled: view.webContents.canGoBack(),
                    click: () => view.webContents.goBack(),
                },
                {
                    label: 'Forward',
                    enabled: view.webContents.canGoForward(),
                    click: () => view.webContents.goForward(),
                },
                {
                    label: 'Reload',
                    click: () => view.webContents.reload(),
                },
            );
        }

        if (contextTemplate.length > 0) contextTemplate.push({ type: 'separator' });
        contextTemplate.push({
            label: 'Inspect Element',
            click: () => view.webContents.inspectElement(params.x, params.y),
        });

        const contextMenu = Menu.buildFromTemplate(contextTemplate);
        contextMenu.popup();
    });

    view.webContents.on('before-input-event', handleShortcuts);

    const getDisplayUrl = toDisplayUrl;

    view.webContents.on('page-title-updated', (e, title) => {
        if (!context.window || context.window.isDestroyed() || context.window.webContents.isDestroyed()) return;
        const currentDisplayUrl = getDisplayUrl(view.webContents.getURL());
        context.window.webContents.send(C.IPC_EVENT.TAB_UPDATE, { id, title, url: currentDisplayUrl });
        if (!effectiveStealth && currentDisplayUrl && !currentDisplayUrl.startsWith('data:') && !isInternalPageUrl(currentDisplayUrl)) {
            historyService.updateTitle(context.profileId, currentDisplayUrl, title).catch((err) => {
                console.error('Failed to update history title:', err);
            });
        }
    });

    view.webContents.on('page-favicon-updated', (e, favicons) => {
        if (!context.window || context.window.isDestroyed() || context.window.webContents.isDestroyed()) return;
        context.window.webContents.send(C.IPC_EVENT.TAB_UPDATE, { id, favicon: favicons[0] || null, url: getDisplayUrl(view.webContents.getURL()) });
    });

    view.webContents.on('did-start-loading', () => {
        if (!context.window || context.window.isDestroyed() || context.window.webContents.isDestroyed()) return;
        resetTabWebContentsScale(view);
        context.window.webContents.send(C.IPC_EVENT.TAB_UPDATE, { id, isLoading: true, url: getDisplayUrl(view.webContents.getURL()) });
    });

    view.webContents.on('did-stop-loading', () => {
        if (!context.window || context.window.isDestroyed() || context.window.webContents.isDestroyed()) return;
        context.window.webContents.send(C.IPC_EVENT.TAB_UPDATE, { id, isLoading: false, url: getDisplayUrl(view.webContents.getURL()) });
    });

    // Guard: after the Google homepage finishes loading its JS may attempt to
    // steal keyboard focus (e.g. to its search box). Re-assert omnibox focus so
    // the user's typing is never interrupted on blank/NTP tabs.
    // selectAll is false here because the user may already be mid-query.
    view.webContents.on('did-finish-load', () => {
        resetTabWebContentsScale(view);
        const loadedUrl = view.webContents.getURL();
        if (context.activeTabId !== id) return;

        // Google homepage: scripts steal focus from the omnibox after load.
        if (shouldReassertOmniboxAfterPageLoad(loadedUrl)) {
            setImmediate(() => {
                if (context.activeTabId !== id) return;
                sendOmniboxFocusToShell(context, id, false, false);
            });
            return;
        }

        // Bundled NTP: early omnibox IPC can lose to guest focus after paint/load;
        // re-assert once when the document finishes (does not use omniboxFocusGen).
        if (isCustomNewTabDocumentUrl(loadedUrl) && isBlankTab(loadedUrl)) {
            setImmediate(() => {
                if (context.activeTabId !== id) return;
                sendOmniboxFocusToShell(context, id, true, false);
            });
        }
    });

    // Use these flags to temporarily hold the title until page load completes or URL changes
    view.webContents.on('did-navigate', (event, targetUrl) => {
        resetTabWebContentsScale(view);
        let displayUrl = getDisplayUrl(targetUrl);
        appLogger.info('tab:navigate', {
            windowId: context.windowId,
            profileId: context.profileId,
            tabId: id,
            url: displayUrl,
        });
        recordCompatEvent(id, { type: 'navigated', url: displayUrl, rawUrl: targetUrl });
        context.window.webContents.send(C.IPC_EVENT.URL_CHANGED, { id, url: displayUrl });
        if (!effectiveStealth && !targetUrl.startsWith('data:') && !isInternalPageUrl(targetUrl)) {
            historyService.recordVisit(context.profileId, {
                tabId: id,
                url: displayUrl,
                title: view.webContents.getTitle() || displayUrl,
                transition: consumeNextNavigationTransition(id),
            }).catch((err) => {
                console.error('Failed to record history:', err);
            });
        }
    });

    view.webContents.on('did-navigate-in-page', (event, targetUrl) => {
        resetTabWebContentsScale(view);
        let displayUrl = getDisplayUrl(targetUrl);
        appLogger.info('tab:navigate-in-page', {
            windowId: context.windowId,
            profileId: context.profileId,
            tabId: id,
            url: displayUrl,
        });
        context.window.webContents.send(C.IPC_EVENT.URL_CHANGED, { id, url: displayUrl });
        if (!effectiveStealth && !targetUrl.startsWith('data:') && !isInternalPageUrl(targetUrl)) {
            historyService.recordVisit(context.profileId, {
                tabId: id,
                url: displayUrl,
                title: view.webContents.getTitle() || displayUrl,
                transition: consumeNextNavigationTransition(id),
            }).catch((err) => {
                console.error('Failed to record in-page history:', err);
            });
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
        appLogger.warn('tab:load-failed', {
            windowId: context.windowId,
            profileId: context.profileId,
            tabId: id,
            url: validatedURL,
            errorCode,
            errorDescription,
        });

        recordCompatEvent(id, {
            type: 'load-failed',
            validatedURL,
            errorCode,
            errorDescription,
        });

        // If it's a DNS resolution error (likely just typed a search term), fallback to search engine
        if (errorCode === -105) { // ERR_NAME_NOT_RESOLVED
            const searchQuery = validatedURL.replace(/^https?:\/\//, '').replace(/\/$/, '');
            const activeEngine = (loadSettings().searchEngine) || 'google';
            const searchFallbackUrl = buildSearchUrl(activeEngine, searchQuery);
            recordCompatEvent(id, {
                type: 'dns-fallback',
                query: searchQuery,
                fallbackUrl: searchFallbackUrl,
            });
            setImmediate(() => {
                if (!view.webContents.isDestroyed()) {
                    view.webContents.loadURL(searchFallbackUrl);
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
                    <img src="app://localhost/assets/images/exclamation.svg" width="64" height="64" alt="" style="margin-bottom: 20px;" />
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

    const restoreHistory = options.navigationHistory;
    if (restoreHistory?.entries?.length && view.webContents.navigationHistory?.restore) {
        view.webContents.navigationHistory.restore({
            entries: restoreHistory.entries,
            index: restoreHistory.index,
        }).catch((err) => {
            console.warn('Failed to restore tab navigation history:', err?.message || err);
            if (!view.webContents.isDestroyed()) {
                view.webContents.loadURL(resolveTabLoadUrl(url));
            }
        });
    } else {
        view.webContents.loadURL(resolveTabLoadUrl(url));
    }

    if (shouldActivate) {
        activateTabInContext(context, id);
    }
}

// ─── HISTORY STORAGE ───────────────────────────────────────────────────────────
const pendingTransitionsByTab = new Map();

function transitionFromNavigationSource(source) {
    switch (String(source || '').toLowerCase()) {
        case C.NAV_SOURCE.TYPED:
        case C.NAV_SOURCE.SEARCH:
        case C.NAV_SOURCE.KEYWORD:
            return C.HISTORY_TRANSITION.TYPED;
        case C.NAV_SOURCE.BOOKMARK:
            return C.HISTORY_TRANSITION.BOOKMARK;
        case C.NAV_SOURCE.RELOAD:
            return C.HISTORY_TRANSITION.RELOAD;
        case C.NAV_SOURCE.HISTORY:
        case C.NAV_SOURCE.TOP_SITE:
        case C.NAV_SOURCE.TOPSITE:
        case C.NAV_SOURCE.LINK:
        default:
            return C.HISTORY_TRANSITION.LINK;
    }
}

function markNextNavigationTransition(tabId, source) {
    if (!tabId) return;
    pendingTransitionsByTab.set(String(tabId), transitionFromNavigationSource(source));
}

function consumeNextNavigationTransition(tabId) {
    if (!tabId) return C.HISTORY_TRANSITION.LINK;
    const key = String(tabId);
    const transition = pendingTransitionsByTab.get(key) || C.HISTORY_TRANSITION.LINK;
    pendingTransitionsByTab.delete(key);
    return transition;
}

/**
 * Returns true for any internal browser page (history, settings, NTP, etc.) that
 * should never be recorded in browsing history.
 */
function isInternalPageUrl(url) {
    if (!url) return false;
    const ul = url.toLowerCase();
    if (ul.startsWith(C.URL.SCHEME_STEALTH) || ul.startsWith(C.URL.SCHEME_INVISURF)) return true;
    if (url.startsWith(C.URL.SCHEME_APP) && url.includes(C.URL.PATH_HISTORY_HTML)) return true;
    if (url.startsWith(C.URL.SCHEME_APP) && url.includes(C.URL.PATH_SETTINGS_HTML)) return true;
    if (url.startsWith(C.URL.SCHEME_APP) && url.includes(C.URL.FRAGMENT_NEWTAB)) return true;
    return false;
}

// ─── SETTINGS STORAGE ────────────────────────────────────────────────────────
let settingsPath;

const COOKIE_CONFIG_DEFAULTS = {
    globalPolicy: 'allow',
    exceptions: [],
};
const cookiePolicyCacheByProfileId = new Map();
const defaultCompiledCookiePolicy = compileCookieConfig(COOKIE_CONFIG_DEFAULTS);
const cookieStoreGuardedSessions = new WeakSet();
const cookieModifiedAtBySession = new WeakMap();

const SETTINGS_DEFAULTS = {
    contentProtection: true,
    startupBehavior: 'continue', // 'fresh' | 'continue' | 'clearHistory'
    compatibilityDiagnosticsEnabled: false,
    searchEngine: 'google', // 'google' | 'bing' | 'brave' | 'duckDuckGo'
    /** 'automatic' = follow OS · 'dark' | 'light' = forced appearance (see nativeTheme.themeSource) */
    colorTheme: 'automatic',
    /** Preset id from chromeTheme.ACCENT_PRESETS, or 'custom' with accentCustomHex */
    accentTheme: 'default',
    accentCustomHex: null,
    cookieConfig: COOKIE_CONFIG_DEFAULTS,
    cookieConfigByProfile: {},
};

const SEARCH_ENGINES = {
    google: 'https://www.google.com/search?q=',
    bing: 'https://www.bing.com/search?q=',
    brave: 'https://search.brave.com/search?q=',
    duckDuckGo: 'https://duckduckgo.com/?q=',
};

/**
 * Builds a search URL for the given engine key and query string.
 * Falls back to Google if the engine key is unrecognised.
 */
function buildSearchUrl(engine, query) {
    const base = SEARCH_ENGINES[engine] || SEARCH_ENGINES.google;
    return base + encodeURIComponent(query);
}

function getSettingsPath() {
    if (!settingsPath) {
        settingsPath = path.join(app.getPath('userData'), 'settings.json');
    }
    return settingsPath;
}

function normalizeColorTheme(value) {
    if (value === 'automatic' || value === 'dark' || value === 'light') return value;
    return 'automatic';
}

function normalizeProfileId(profileId) {
    return String(profileId || '').trim().replace(/[^a-zA-Z0-9-_]/g, '_');
}

function getProfileIdForEventSender(sender) {
    return getWindowContextByEventSender(sender)?.profileId || defaultProfileId || null;
}

function resolveAuthorizedProfileIdForSender(sender, requestedProfileId = null) {
    const actualProfileId = getProfileIdForEventSender(sender);
    const safeRequested = normalizeProfileId(requestedProfileId);
    if (safeRequested && safeRequested !== normalizeProfileId(actualProfileId)) return null;
    return actualProfileId;
}

function normalizeCookieSettingsFields(settings, profileId = null) {
    const merged = settings && typeof settings === 'object' ? { ...settings } : {};
    const byProfile = merged.cookieConfigByProfile && typeof merged.cookieConfigByProfile === 'object'
        ? { ...merged.cookieConfigByProfile }
        : {};
    const baseConfig = normalizeCookieConfig(merged.cookieConfig || COOKIE_CONFIG_DEFAULTS);
    const safeProfileId = normalizeProfileId(profileId);
    const profileConfig = safeProfileId && byProfile[safeProfileId]
        ? normalizeCookieConfig(byProfile[safeProfileId])
        : baseConfig;
    if (safeProfileId) byProfile[safeProfileId] = profileConfig;
    merged.cookieConfig = profileConfig;
    merged.cookieConfigByProfile = byProfile;
    return merged;
}

function setCachedCookieConfig(profileId, config) {
    const safeProfileId = normalizeProfileId(profileId);
    if (!safeProfileId) return;
    cookiePolicyCacheByProfileId.set(safeProfileId, compileCookieConfig(config));
}

function getCachedCookieConfig(profileId) {
    const safeProfileId = normalizeProfileId(profileId);
    if (!safeProfileId) return defaultCompiledCookiePolicy;
    return cookiePolicyCacheByProfileId.get(safeProfileId) || defaultCompiledCookiePolicy;
}

function hydrateCookiePolicyCacheFromSettings(settings) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const byProfile = source.cookieConfigByProfile && typeof source.cookieConfigByProfile === 'object'
        ? source.cookieConfigByProfile
        : {};
    for (const [profileId, config] of Object.entries(byProfile)) {
        setCachedCookieConfig(profileId, config);
    }
    if (defaultProfileId) {
        setCachedCookieConfig(defaultProfileId, source.cookieConfig || COOKIE_CONFIG_DEFAULTS);
    }
}

function colorThemeSettingToElectronSource(setting) {
    if (setting === 'dark') return 'dark';
    if (setting === 'light') return 'light';
    return 'system';
}

function getTitleBarOverlayOptionsForNativeTheme() {
    const prefs = loadSettings();
    if (!nativeTheme || typeof nativeTheme.shouldUseDarkColors !== 'boolean') {
        return chromeTheme.getTitleBarOverlayFromSettings(prefs, true);
    }
    return chromeTheme.getTitleBarOverlayFromSettings(prefs, nativeTheme.shouldUseDarkColors);
}

function syncTitleBarOverlaysToNativeTheme() {
    if (process.platform === 'darwin') return;
    const overlayOptions = getTitleBarOverlayOptionsForNativeTheme();
    const stealthOverlayOptions = chromeTheme.getTitleBarOverlayFromSettings(
        { colorTheme: 'dark', accentTheme: 'default', accentCustomHex: null },
        true,
    );
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win || win.isDestroyed?.()) continue;
        try {
            const ctx = windowContextsById.get(win.id);
            win.setTitleBarOverlay(ctx?.stealthWindow ? stealthOverlayOptions : overlayOptions);
        } catch (_) {
            // Window uses a standard title bar (e.g. profile picker) — no overlay.
        }
    }
}

let nativeThemeTitleBarListenersAttached = false;
function ensureNativeThemeTitleBarListeners() {
    if (nativeThemeTitleBarListenersAttached || !nativeTheme || typeof nativeTheme.on !== 'function') return;
    nativeThemeTitleBarListenersAttached = true;
    nativeTheme.on('updated', () => {
        syncTitleBarOverlaysToNativeTheme();
        broadcastThemeApply();
    });
}

/** Push resolved chrome CSS variables to the chrome-overlay WebContentsView (matches shell theme). */
function getChromeOverlayThemePatchForContext(context) {
    const settings = loadSettings();
    const prefersDark = nativeTheme && typeof nativeTheme.shouldUseDarkColors === 'boolean'
        ? nativeTheme.shouldUseDarkColors
        : true;
    const stealth = !!(context && context.stealthWindow);
    const effectiveDark = stealth
        ? true
        : chromeTheme.resolveEffectiveDarkFromSettings(settings, prefersDark);
    const tokenSource = stealth
        ? { colorTheme: 'dark', accentTheme: 'default', accentCustomHex: null }
        : settings;
    const tokens = chromeTheme.resolveAppliedTokens(tokenSource, effectiveDark);
    let forcedAppearance = null;
    if (!stealth) {
        const ct = chromeTheme.normalizeColorTheme(settings.colorTheme);
        if (ct === 'light') forcedAppearance = 'light';
        else if (ct === 'dark') forcedAppearance = 'dark';
    }
    return {
        kind: 'chromeTheme',
        tokens,
        effectiveDark: !!effectiveDark,
        forcedAppearance,
    };
}

function sendChromeOverlayThemePatch(context) {
    const ov = context?.chromeOverlayView;
    if (!isViewWebContentsAlive(ov)) return;
    try {
        ov.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, getChromeOverlayThemePatchForContext(context));
    } catch (_) {
        /* overlay may be tearing down */
    }
}

function sendChromeShellMenuOverlayThemePatch(context) {
    const ov = context?.chromeShellMenuOverlayView;
    if (!isViewWebContentsAlive(ov)) return;
    try {
        ov.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, getChromeOverlayThemePatchForContext(context));
    } catch (_) {
        /* overlay may be tearing down */
    }
}

function sendChromeOmniboxOverlayThemePatch(context) {
    const ov = context?.chromeOmniboxOverlayView;
    if (!isViewWebContentsAlive(ov)) return;
    try {
        ov.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, getChromeOverlayThemePatchForContext(context));
    } catch (_) {
        /* overlay may be tearing down */
    }
}

function broadcastThemeApply() {
    const settings = loadSettings();
    const payload = { settings };
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win || win.isDestroyed?.()) continue;
        try {
            win.webContents.send(C.IPC_EVENT.THEME_APPLY, payload);
        } catch (_) {
            /* window may be closing */
        }
    }
    for (const ctx of windowContextsById.values()) {
        for (const view of Object.values(ctx.tabs || {})) {
            if (!view || view.webContents.isDestroyed()) continue;
            try {
                view.webContents.send(C.IPC_EVENT.THEME_APPLY, payload);
            } catch (_) {
                /* tab view may be navigating or closing */
            }
        }
        sendChromeOverlayThemePatch(ctx);
        sendChromeOmniboxOverlayThemePatch(ctx);
        sendChromeShellMenuOverlayThemePatch(ctx);
    }
}

function applyColorThemeFromSettings() {
    if (!nativeTheme || typeof nativeTheme !== 'object') return;
    const prefs = loadSettings();
    nativeTheme.themeSource = colorThemeSettingToElectronSource(normalizeColorTheme(prefs.colorTheme));
    syncTitleBarOverlaysToNativeTheme();
    ensureNativeThemeTitleBarListeners();
    broadcastThemeApply();
}

function loadSettings(profileId = null) {
    try {
        const p = getSettingsPath();
        if (fs.existsSync(p)) {
            const merged = { ...SETTINGS_DEFAULTS, ...JSON.parse(fs.readFileSync(p, 'utf-8')) };
            merged.colorTheme = normalizeColorTheme(merged.colorTheme);
            const normalized = chromeTheme.normalizeAccentFields(normalizeCookieSettingsFields(merged, profileId));
            hydrateCookiePolicyCacheFromSettings(normalized);
            if (profileId) setCachedCookieConfig(profileId, normalized.cookieConfig);
            return normalized;
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    const defaults = { ...SETTINGS_DEFAULTS };
    defaults.colorTheme = normalizeColorTheme(defaults.colorTheme);
    const normalizedDefaults = chromeTheme.normalizeAccentFields(normalizeCookieSettingsFields(defaults, profileId));
    hydrateCookiePolicyCacheFromSettings(normalizedDefaults);
    if (profileId) setCachedCookieConfig(profileId, normalizedDefaults.cookieConfig);
    return normalizedDefaults;
}

function recordCompatEvent(tabId, entry) {
    if (!tabId) return;
    if (!loadSettings().compatibilityDiagnosticsEnabled) return;
    compatDiagnostics.push(tabId, { ...entry, timestamp: Date.now() });
}

function saveSettings(data) {
    try {
        fs.writeFileSync(getSettingsPath(), JSON.stringify(data, null, 2), 'utf-8');
        hydrateCookiePolicyCacheFromSettings(data);
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

function getProfilePartition(profileId) {
    const safeProfileId = normalizeProfileId(profileId);
    if (!safeProfileId) return null;
    return `persist:profile-${safeProfileId}`;
}

function getProfileSession(profileId) {
    const partition = getProfilePartition(profileId);
    return partition ? session.fromPartition(partition) : null;
}

function getProfileSessionForSender(sender, requestedProfileId = null) {
    return getProfileSession(resolveAuthorizedProfileIdForSender(sender, requestedProfileId));
}

function cookieDomainToHost(domain) {
    return String(domain || '').trim().toLowerCase().replace(/^\.+/, '');
}

function cookieMatchesDomain(cookie, domain) {
    const host = cookieDomainToHost(cookie?.domain);
    const target = cookieDomainToHost(domain);
    if (!host || !target) return false;
    return host === target || host.endsWith(`.${target}`) || target.endsWith(`.${host}`);
}

function cookieUrlForRemoval(cookie) {
    const host = cookieDomainToHost(cookie?.domain);
    const protocol = cookie?.secure ? 'https' : 'http';
    const pathPart = cookie?.path || '/';
    return `${protocol}://${host}${pathPart.startsWith('/') ? pathPart : `/${pathPart}`}`;
}

function cookieStoreKey(cookie) {
    const host = cookieDomainToHost(cookie?.domain);
    const pathPart = cookie?.path || '/';
    return `${host}\n${pathPart}\n${String(cookie?.name || '')}`;
}

function getCookieModifiedAtMap(targetSession) {
    if (!targetSession) return null;
    let map = cookieModifiedAtBySession.get(targetSession);
    if (!map) {
        map = new Map();
        cookieModifiedAtBySession.set(targetSession, map);
    }
    return map;
}

function getCookieModifiedAt(targetSession, cookie) {
    return getCookieModifiedAtMap(targetSession)?.get(cookieStoreKey(cookie)) || 0;
}

function forgetCookieModifiedAt(targetSession, cookie) {
    getCookieModifiedAtMap(targetSession)?.delete(cookieStoreKey(cookie));
}

function normalizeSinceTimestamp(value) {
    if (value == null) return null;
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function isCookieBlockedByStoredPolicy(cookie, profileId, options = {}) {
    const host = cookieDomainToHost(cookie?.domain);
    if (!host) return false;
    return shouldBlockStoredCookie(host, getCachedCookieConfig(profileId), {
        isStealthSession: !!options.isStealthSession,
    });
}

function installCookieStoreGuard(targetSession, options = {}) {
    if (!targetSession?.cookies || cookieStoreGuardedSessions.has(targetSession)) return;
    cookieStoreGuardedSessions.add(targetSession);
    const profileId = normalizeProfileId(options.profileId);
    const isStealthSession = !!options.isStealthSession;
    targetSession.cookies.on('changed', (_event, cookie, cause, removed) => {
        if (!cookie) return;
        if (removed || cause === 'expired' || cause === 'evicted') {
            forgetCookieModifiedAt(targetSession, cookie);
            return;
        }
        getCookieModifiedAtMap(targetSession)?.set(cookieStoreKey(cookie), Date.now());
        if (!isCookieBlockedByStoredPolicy(cookie, profileId, { isStealthSession })) return;
        Promise.resolve()
            .then(() => targetSession.cookies.remove(cookieUrlForRemoval(cookie), cookie.name))
            .catch((error) => {
                appLogger.warn('cookies:store-guard-remove-failed', {
                    domain: cookieDomainToHost(cookie.domain),
                    name: cookie.name,
                    error: appLogger.serializeError(error),
                });
            });
    });
}

async function removeCookiesMatching(targetSession, predicate) {
    if (!targetSession?.cookies) return 0;
    const cookies = await targetSession.cookies.get({});
    let removed = 0;
    for (const cookie of cookies) {
        if (!predicate(cookie)) continue;
        try {
            await targetSession.cookies.remove(cookieUrlForRemoval(cookie), cookie.name);
            forgetCookieModifiedAt(targetSession, cookie);
            removed += 1;
        } catch (_) {
            /* cookie may have been removed already */
        }
    }
    return removed;
}

async function removeCookiesModifiedSince(targetSession, since) {
    const normalizedSince = normalizeSinceTimestamp(since);
    if (normalizedSince == null) {
        return removeCookiesMatching(targetSession, () => true);
    }
    return removeCookiesMatching(
        targetSession,
        (cookie) => getCookieModifiedAt(targetSession, cookie) >= normalizedSince,
    );
}

async function cleanupBlockedCookiesForProfile(profileId) {
    const safeProfileId = normalizeProfileId(profileId);
    if (!safeProfileId) return 0;
    return removeCookiesMatching(
        getProfileSession(safeProfileId),
        (cookie) => isCookieBlockedByStoredPolicy(cookie, safeProfileId, { isStealthSession: false }),
    );
}

async function cleanupStealthCookiesForContext(context) {
    if (!context?.stealthWindow || !context.stealthTabsPartition) return 0;
    return removeCookiesMatching(session.fromPartition(context.stealthTabsPartition), () => true);
}

async function cleanupStealthCookiesForAllContexts() {
    const stealthContexts = Array.from(windowContextsById.values()).filter((ctx) => ctx?.stealthWindow);
    const results = await Promise.all(stealthContexts.map((ctx) => cleanupStealthCookiesForContext(ctx)));
    return results.reduce((sum, count) => sum + count, 0);
}

async function getCookieSummaryForSession(targetSession) {
    if (!targetSession?.cookies) return [];
    const cookies = await targetSession.cookies.get({});
    const byDomain = new Map();
    for (const cookie of cookies) {
        const domain = cookieDomainToHost(cookie.domain);
        if (!domain) continue;
        const row = byDomain.get(domain) || {
            domain,
            count: 0,
            storageBytes: 0,
        };
        row.count += 1;
        row.storageBytes += Math.max(JSON.stringify(cookie).length, 512);
        byDomain.set(domain, row);
    }
    return Array.from(byDomain.values()).sort((a, b) => a.domain.localeCompare(b.domain));
}

async function cleanupSessionOnlyCookiesForProfile(profileId) {
    const safeProfileId = normalizeProfileId(profileId);
    const targetSession = getProfileSession(safeProfileId);
    if (!targetSession) return 0;
    const config = loadSettings(safeProfileId).cookieConfig;
    const sessionOnlyRules = (config.exceptions || []).filter((rule) => rule.setting === 'session_only');
    if (sessionOnlyRules.length === 0) return 0;
    return removeCookiesMatching(targetSession, (cookie) => {
        const host = cookieDomainToHost(cookie.domain);
        return sessionOnlyRules.some((rule) => cookiePatternMatchesHost(rule.pattern, host));
    });
}

async function cleanupSessionOnlyCookiesForAllProfiles() {
    const profileIds = new Set();
    for (const ctx of windowContextsById.values()) {
        if (ctx?.profileId) profileIds.add(ctx.profileId);
    }
    if (defaultProfileId) profileIds.add(defaultProfileId);
    for (const profile of profilesById.values()) {
        if (profile?.profileId) profileIds.add(profile.profileId);
    }
    const results = await Promise.all(Array.from(profileIds).map((profileId) => cleanupSessionOnlyCookiesForProfile(profileId)));
    return results.reduce((sum, count) => sum + count, 0);
}

function updateCookieConfigForProfile(profileId, patch) {
    const safeProfileId = normalizeProfileId(profileId);
    const current = loadSettings(safeProfileId);
    const nextConfig = normalizeCookieConfig({
        ...current.cookieConfig,
        ...(patch && typeof patch === 'object' ? patch : {}),
    });
    const next = normalizeCookieSettingsFields({
        ...current,
        cookieConfig: nextConfig,
        cookieConfigByProfile: {
            ...(current.cookieConfigByProfile || {}),
            ...(safeProfileId ? { [safeProfileId]: nextConfig } : {}),
        },
    }, safeProfileId);
    saveSettings(chromeTheme.normalizeAccentFields(next));
    return nextConfig;
}

ipcMain.handle(C.IPC_INVOKE.SETTINGS_GET, (e) => {
    if (!isSenderTrusted(e)) return SETTINGS_DEFAULTS;
    return loadSettings(getProfileIdForEventSender(e.sender));
});

ipcMain.handle(C.IPC_INVOKE.SETTINGS_SAVE, async (e, data) => {
    if (!isSenderTrusted(e)) return false;
    const profileId = getProfileIdForEventSender(e.sender);
    const current = loadSettings(profileId);
    const patch = typeof data === 'object' && data ? data : {};
    const next = { ...current, ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, 'colorTheme')) {
        next.colorTheme = normalizeColorTheme(patch.colorTheme);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'accentTheme')) {
        next.accentTheme = chromeTheme.normalizeAccentTheme(patch.accentTheme);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'accentCustomHex')) {
        const raw = patch.accentCustomHex;
        next.accentCustomHex = raw == null || raw === '' ? null : chromeTheme.normalizeAccentHex(raw);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'cookieConfig')) {
        const normalizedCookieConfig = normalizeCookieConfig(patch.cookieConfig);
        const byProfile = next.cookieConfigByProfile && typeof next.cookieConfigByProfile === 'object'
            ? { ...next.cookieConfigByProfile }
            : {};
        const safeProfileId = normalizeProfileId(profileId);
        if (safeProfileId) byProfile[safeProfileId] = normalizedCookieConfig;
        next.cookieConfig = normalizedCookieConfig;
        next.cookieConfigByProfile = byProfile;
    }
    saveSettings(chromeTheme.normalizeAccentFields(normalizeCookieSettingsFields(next, profileId)));
    if (Object.prototype.hasOwnProperty.call(patch, 'cookieConfig')) {
        await cleanupBlockedCookiesForProfile(profileId);
    }
    applyColorThemeFromSettings();
    broadcastSettingsUpdate(next);
    return true;
});

ipcMain.handle(C.IPC_INVOKE.COOKIE_SUMMARY, async (e, { profileId } = {}) => {
    if (!isSenderTrusted(e)) return [];
    const authorizedProfileId = resolveAuthorizedProfileIdForSender(e.sender, profileId);
    if (!authorizedProfileId) return [];
    return getCookieSummaryForSession(getProfileSession(authorizedProfileId));
});

ipcMain.handle(C.IPC_INVOKE.COOKIE_DELETE_DOMAIN, async (e, { profileId, domain } = {}) => {
    if (!isSenderTrusted(e)) return { ok: false, deleted: 0 };
    const authorizedProfileId = resolveAuthorizedProfileIdForSender(e.sender, profileId);
    if (!authorizedProfileId) return { ok: false, deleted: 0 };
    const targetSession = getProfileSession(authorizedProfileId);
    const deleted = await removeCookiesMatching(targetSession, (cookie) => cookieMatchesDomain(cookie, domain));
    return { ok: true, deleted };
});

ipcMain.handle(C.IPC_INVOKE.COOKIE_CLEAR_ALL, async (e, { profileId, since } = {}) => {
    if (!isSenderTrusted(e)) return { ok: false, deleted: 0 };
    const authorizedProfileId = resolveAuthorizedProfileIdForSender(e.sender, profileId);
    if (!authorizedProfileId) return { ok: false, deleted: 0 };
    const deleted = await removeCookiesModifiedSince(getProfileSession(authorizedProfileId), since);
    return { ok: true, deleted };
});

ipcMain.handle(C.IPC_INVOKE.COOKIE_SETTINGS_GET, (e, { profileId } = {}) => {
    if (!isSenderTrusted(e)) return COOKIE_CONFIG_DEFAULTS;
    const authorizedProfileId = resolveAuthorizedProfileIdForSender(e.sender, profileId);
    if (!authorizedProfileId) return COOKIE_CONFIG_DEFAULTS;
    return loadSettings(authorizedProfileId).cookieConfig;
});

ipcMain.handle(C.IPC_INVOKE.COOKIE_SETTINGS_UPDATE, async (e, payload) => {
    if (!isSenderTrusted(e)) return COOKIE_CONFIG_DEFAULTS;
    const profileId = payload?.profileId;
    const config = payload?.config || payload;
    const authorizedProfileId = resolveAuthorizedProfileIdForSender(e.sender, profileId);
    if (!authorizedProfileId) return COOKIE_CONFIG_DEFAULTS;
    const savedConfig = updateCookieConfigForProfile(authorizedProfileId, config);
    await cleanupBlockedCookiesForProfile(authorizedProfileId);
    return savedConfig;
});

ipcMain.handle(C.IPC_INVOKE.CLIPBOARD_WRITE, (e, { text } = {}) => {
    if (!isSenderTrusted(e)) return false;
    clipboard.writeText(String(text || ''));
    return true;
});

ipcMain.handle(C.IPC_INVOKE.APP_RELAUNCH, (e) => {
    if (!isSenderTrusted(e)) return;
    appLogger.info('app:relaunch-requested', {});
    app.relaunch();
    app.quit();
});

ipcMain.handle(C.IPC_INVOKE.APP_LOG_INFO, (e) => {
    if (!isSenderTrusted(e)) return null;
    return {
        encrypted: true,
        directory: appLogger.getLogDir(),
        currentFile: appLogger.getCurrentLogFile(),
        retentionDaysApprox: 14,
    };
});

ipcMain.handle(C.IPC_INVOKE.APP_LOG_FILES, (e) => {
    if (!isSenderTrusted(e)) return { files: [] };
    return {
        encrypted: true,
        directory: appLogger.getLogDir(),
        files: appLogger.listLogFiles(),
    };
});

ipcMain.handle(C.IPC_INVOKE.APP_LOG_READ, (e, { filePath } = {}) => {
    if (!isSenderTrusted(e)) return { ok: false, error: 'Untrusted sender' };
    try {
        const records = appLogger.readEncryptedLogFile(filePath);
        const text = JSON.stringify(records, null, 2);
        return {
            ok: true,
            filePath,
            records,
            text,
        };
    } catch (error) {
        return {
            ok: false,
            error: error?.message || String(error),
        };
    }
});

ipcMain.handle(C.IPC_INVOKE.APP_LOG_REVEAL, (e, { filePath } = {}) => {
    if (!isSenderTrusted(e)) return { ok: false };
    if (!appLogger.isLogFilePath(filePath) || !fs.existsSync(filePath)) {
        return { ok: false, error: 'Log file not found' };
    }
    try {
        shell?.showItemInFolder?.(filePath);
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    }
});

ipcMain.handle(C.IPC_INVOKE.APP_LOG_DELETE, (e, { filePath } = {}) => {
    if (!isSenderTrusted(e)) return { ok: false, error: 'Untrusted sender' };
    if (!appLogger.isLogFilePath(filePath)) {
        return { ok: false, error: 'Invalid log file path' };
    }
    const deleted = appLogger.deleteLogFile(filePath);
    return { ok: deleted };
});

ipcMain.handle(C.IPC_INVOKE.APP_LOG_CLEAR, (e, { since = null } = {}) => {
    if (!isSenderTrusted(e)) return { ok: false, error: 'Untrusted sender' };
    try {
        const result = appLogger.clearLogFiles({ since });
        return { ok: true, ...result };
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    }
});

function resolveWebContentsForIdentityProbe(context, { tabIdOverride = null, sender = null } = {}) {
    const senderTabId = sender && !sender.isDestroyed?.()
        ? webContentsIdToTabId.get(sender.id)
        : null;

    const tabId = tabIdOverride || senderTabId || context?.activeTabId || null;

    let wc = null;
    if (sender && !sender.isDestroyed?.() && senderTabId) {
        wc = sender;
    } else if (tabId && context?.tabs?.[tabId]) {
        const view = context.tabs[tabId];
        if (view?.webContents && !view.webContents.isDestroyed()) {
            wc = view.webContents;
        }
    }

    return { tabId, webContents: wc, senderTabId };
}

async function resolveIdentityReportForContext(context, tabIdOverride, sender = null) {
    const { tabId, webContents: wc } = resolveWebContentsForIdentityProbe(context, {
        tabIdOverride,
        sender,
    });
    const targetSession = context?.partition && session
        ? session.fromPartition(context.partition)
        : session?.defaultSession || null;
    return identityDiagnostics.buildIdentityReport({
        app,
        context,
        webContents: wc,
        tabId,
        session: targetSession,
    });
}

ipcMain.handle(C.IPC_INVOKE.IDENTITY_DIAG_GET_REPORT, async (e, payload = {}) => {
    if (!isSenderTrusted(e)) return null;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return null;
    const tabId = payload && payload.tabId != null ? String(payload.tabId) : undefined;
    try {
        const report = await resolveIdentityReportForContext(context, tabId, e.sender);
        appLogger.info('identity-diag:report-generated', {
            tabId: report.tabId,
            profileId: report.profileId,
            userAgentMatchesConfigured: report.analysis?.userAgentMatchesConfigured,
        });
        return report;
    } catch (err) {
        appLogger.error('identity-diag:report-failed', {
            error: appLogger.serializeError(err),
        });
        return { error: String(err?.message || err), generatedAt: Date.now() };
    }
});

ipcMain.handle(C.IPC_INVOKE.COMPAT_GET_REPORT, async (e, payload = {}) => {
    if (!isSenderTrusted(e)) return null;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return null;
    const tabId = payload && payload.tabId != null ? String(payload.tabId) : undefined;
    const report = compatDiagnostics.getReport(tabId);
    let identitySummary = null;
    try {
        const identityReport = await resolveIdentityReportForContext(
            context,
            tabId || context.activeTabId,
            e.sender,
        );
        identitySummary = identityDiagnostics.getCompactSummary(identityReport);
    } catch (_) {
        identitySummary = null;
    }
    return { ...report, activeTabId: context.activeTabId, identitySummary };
});

ipcMain.handle(C.IPC_INVOKE.COMPAT_CLEAR, (e, payload = {}) => {
    if (!isSenderTrusted(e)) return false;
    const tabId = payload && payload.tabId != null ? String(payload.tabId) : undefined;
    compatDiagnostics.clear(tabId);
    return true;
});

ipcMain.handle(C.IPC_INVOKE.DEVTOOLS_UNDOCKED, (e) => {
    if (!isSenderTrusted(e)) return false;
    const { sender } = e;
    if (!sender || sender.isDestroyed()) return false;
    if (sender.isDevToolsOpened()) {
        sender.devToolsWebContents?.focus();
        return true;
    }
    sender.openDevTools({ mode: 'undocked', activate: true });
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

function readDecodedSessionDoc() {
    try {
        const sessionDocPath = getSessionPath();
        if (!fs.existsSync(sessionDocPath)) return null;
        const parsed = JSON.parse(fs.readFileSync(sessionDocPath, 'utf-8'));
        const decoded = (parsed && parsed.encrypted !== undefined)
            ? (() => {
                const dec = encryption.decrypt(parsed);
                return dec ? JSON.parse(dec) : null;
            })()
            : parsed;
        if (decoded?.schemaVersion === 2 && decoded.windowsById && typeof decoded.windowsById === 'object') {
            return decoded;
        }
        return null;
    } catch (error) {
        console.error('Failed to read session document:', error);
        return null;
    }
}

function findSessionWindowIdForProfile(decoded, profileId) {
    if (!decoded?.windowsById || !profileId) return undefined;
    for (const [windowId, windowData] of Object.entries(decoded.windowsById)) {
        if (windowData?.profileId === profileId) return windowId;
    }
    return undefined;
}

ipcMain.handle(C.IPC_INVOKE.SESSION_LOAD, async (e) => {
    if (!isSenderTrusted(e)) return null;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return null;
    if (context.stealthWindow) return null;

    const { startupBehavior } = loadSettings();

    // 'clearHistory': wipe history file, then start fresh (no session restore)
    if (startupBehavior === 'clearHistory') {
        try {
            await historyService.clear(context.profileId, { since: null });
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
            const decoded = (parsed && parsed.encrypted !== undefined)
                ? (() => {
                    const dec = encryption.decrypt(parsed);
                    return dec ? JSON.parse(dec) : null;
                })()
                : parsed;
            if (!decoded) return null;
            if (decoded.schemaVersion === 2 && decoded.windowsById) {
                return decoded.windowsById[context.windowId] || null;
            }
            // Legacy v1 fallback
            if (decoded.tabs) return decoded;
            return null;
        }
    } catch (e) {
        console.error('Failed to load session:', e);
    }
    return null;
});

ipcMain.handle(C.IPC_INVOKE.SESSION_SAVE, (e, data) => {
    if (!isSenderTrusted(e)) return false;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return false;
    if (context.stealthWindow) return true;

    const { startupBehavior } = loadSettings();

    // In fresh/clearHistory modes, do not persist tab snapshots.
    if (startupBehavior === 'fresh' || startupBehavior === 'clearHistory') {
        clearSessionSnapshot();
        return true;
    }

    try {
        const currentRaw = fs.existsSync(getSessionPath()) ? fs.readFileSync(getSessionPath(), 'utf-8') : null;
        let doc = { schemaVersion: 2, profiles: [], windowsById: {} };
        if (currentRaw) {
            try {
                const parsed = JSON.parse(currentRaw);
                const decoded = (parsed && parsed.encrypted !== undefined)
                    ? (() => {
                        const dec = encryption.decrypt(parsed);
                        return dec ? JSON.parse(dec) : null;
                    })()
                    : parsed;
                if (decoded && typeof decoded === 'object') {
                    if (decoded.schemaVersion === 2) {
                        doc = {
                            schemaVersion: 2,
                            profiles: Array.isArray(decoded.profiles) ? decoded.profiles : [],
                            windowsById: decoded.windowsById || {},
                        };
                    } else if (decoded.tabs) {
                        // migrate legacy document once
                        doc.windowsById = {};
                    }
                }
            } catch (_) { }
        }
        doc.windowsById[context.windowId] = {
            profileId: context.profileId,
            tabs: Array.isArray(data?.tabs) ? data.tabs : [],
            activeTabId: data?.activeTabId || null,
        };
        doc.profiles = Array.from(profilesById.values()).map((p) => ({
            profileId: p.profileId,
            displayName: p.displayName,
            createdAt: p.createdAt,
            updatedAt: Date.now(),
            hasCustomAvatar: !!p.hasCustomAvatar,
            avatarExt: p.avatarExt || null,
            avatarSource: p.avatarSource === 'preset' || p.avatarSource === 'upload' ? p.avatarSource : null,
        }));
        const payload = encryption.encrypt(JSON.stringify(doc));
        fs.writeFileSync(getSessionPath(), JSON.stringify(payload, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save session:', e);
    }
    return true;
});

ipcMain.handle(C.IPC_INVOKE.HISTORY_SEARCH, async (e, payload = {}) => {
    if (!isSenderTrusted(e)) return { items: [], nextCursor: null, hasMore: false };
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return { items: [], nextCursor: null, hasMore: false };
    try {
        return await historyService.search(context.profileId, payload || {});
    } catch (error) {
        console.error('Failed to search history:', error);
        return { items: [], nextCursor: null, hasMore: false };
    }
});

ipcMain.handle(C.IPC_INVOKE.HISTORY_SUGGESTIONS, async (e, query) => {
    if (!isSenderTrusted(e)) return [];
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return [];
    try {
        return await historyService.getSuggestions(context.profileId, { query, limit: 8 });
    } catch (error) {
        console.error('Failed to get history suggestions:', error);
        return [];
    }
});

ipcMain.handle(C.IPC_INVOKE.HISTORY_DELETE_VISITS, async (e, visitIds) => {
    if (!isSenderTrusted(e)) return false;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return false;
    try {
        return await historyService.deleteVisits(context.profileId, visitIds);
    } catch (error) {
        console.error('Failed to delete history visits:', error);
        return false;
    }
});

ipcMain.handle(C.IPC_INVOKE.HISTORY_DELETE_URLS, async (e, urls) => {
    if (!isSenderTrusted(e)) return false;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return false;
    try {
        return await historyService.deleteUrls(context.profileId, urls);
    } catch (error) {
        console.error('Failed to delete history URLs:', error);
        return false;
    }
});

ipcMain.handle(C.IPC_INVOKE.HISTORY_CLEAR, async (e, payload = {}) => {
    if (!isSenderTrusted(e)) return false;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return false;
    try {
        return await historyService.clear(context.profileId, payload || {});
    } catch (error) {
        console.error('Failed to clear history:', error);
        return false;
    }
});

// ─── NEW TAB PAGE IPC ─────────────────────────────────────────────────────────

/**
 * omnibox:steal-focus — legacy NTP fakebox focus bridge.
 * The NTP now has an in-page search box, so do not open the chrome overlay here;
 * on transparent-overlay builds that can visually cover the New Tab content.
 */
ipcMain.on(C.IPC_SEND.OMNIBOX_STEAL_FOCUS, (e) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context?.activeTabId) return;
    sendOmniboxFocusToShell(context, context.activeTabId, true, false);
});

/**
 * newtab:get-top-sites — returns up to 8 frequently visited sites from history.
 * Groups history entries by eTLD+1 domain, counts visits, and returns the top
 * entries with { url, title, domain } objects (deduplicated by domain).
 */
ipcMain.handle(C.IPC_INVOKE.NTP_TOP_SITES, async (e) => {
    if (!isSenderTrusted(e)) return [];
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return [];

    try {
        return await historyService.getTopSites(context.profileId, 8);
    } catch (err) {
        console.error('Failed to get top sites:', err);
        return [];
    }
});

// ─── BOOKMARK STORAGE ────────────────────────────────────────────────────────
let bookmarksPath;

function getBookmarksPath(profileId = defaultProfileId || 'default') {
    const safeProfileId = String(profileId || 'default').replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(app.getPath('userData'), `bookmarks-${safeProfileId}.json`);
}

function loadBookmarks(profileId) {
    try {
        const p = getBookmarksPath(profileId);
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

function saveBookmarks(profileId, data) {
    try {
        const payload = encryption.encrypt(JSON.stringify(data));
        fs.writeFileSync(getBookmarksPath(profileId), JSON.stringify(payload, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save bookmarks:', e);
    }
}

function broadcastBookmarks(profileId) {
    for (const context of windowContextsById.values()) {
        if (context.profileId !== profileId) continue;
        if (!context.window.webContents.isDestroyed()) {
            context.window.webContents.send('bookmarks:updated');
        }
    }
}

ipcMain.handle('webauthn:getCookieUsage', async (event) => {
    if (!isSenderTrusted(event)) return { main: null, embedded: [] };
    const context = getWindowContextByEventSender(event.sender);
    if (!context || !context.activeTabId) return { main: null, embedded: [] };

    const tabView = context.tabs[context.activeTabId];
    if (!tabView) return { main: null, embedded: [] };

    const { getTabNetworkDomains } = require('./runtime/sessionPolicy');
    const domains = getTabNetworkDomains(tabView.webContents.id);

    let mainDomain = '';
    try {
        mainDomain = new URL(tabView.webContents.getURL()).hostname;
    } catch (e) { }

    const session = tabView.webContents.session;
    const result = { main: null, embedded: [] };

    for (const domain of domains) {
        try {
            const cookies = await session.cookies.get({ domain });
            const count = cookies.length;
            if (count > 0) {
                if (domain === mainDomain || (mainDomain && domain.endsWith(mainDomain))) {
                    if (!result.main) {
                        result.main = { domain, count };
                    } else {
                        result.main.count += count;
                    }
                } else {
                    result.embedded.push({ domain, count });
                }
            }
        } catch (e) {
            // ignore
        }
    }

    if (!result.main && mainDomain) {
        result.main = { domain: mainDomain, count: 0 };
    }

    return result;
});

ipcMain.handle('webauthn:deleteCookies', async (event, domain) => {
    if (!isSenderTrusted(event) || !domain) return false;
    const context = getWindowContextByEventSender(event.sender);
    if (!context || !context.activeTabId) return false;

    const tabView = context.tabs[context.activeTabId];
    if (!tabView) return false;

    const session = tabView.webContents.session;
    try {
        const cookies = await session.cookies.get({ domain });
        for (const cookie of cookies) {
            let url = 'http' + (cookie.secure ? 's' : '') + '://' + cookie.domain + cookie.path;
            await session.cookies.remove(url, cookie.name);
        }
        return true;
    } catch (e) {
        return false;
    }
});

ipcMain.handle('webauthn:blockCookies', async (event, domain) => {
    if (!isSenderTrusted(event) || !domain) return false;
    const { addToCookieBlocklist } = require('./runtime/sessionPolicy');
    addToCookieBlocklist(domain);

    // Also delete existing cookies
    const context = getWindowContextByEventSender(event.sender);
    if (context && context.activeTabId) {
        const tabView = context.tabs[context.activeTabId];
        if (tabView) {
            const session = tabView.webContents.session;
            try {
                const cookies = await session.cookies.get({ domain });
                for (const cookie of cookies) {
                    let url = 'http' + (cookie.secure ? 's' : '') + '://' + cookie.domain + cookie.path;
                    await session.cookies.remove(url, cookie.name);
                }
            } catch (e) { }
        }
    }
    return true;
});

ipcMain.handle(C.IPC_INVOKE.BOOKMARKS_GET, (e) => {
    if (!isSenderTrusted(e)) return { bar: [] };
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return { bar: [] };
    return loadBookmarks(context.profileId);
});

ipcMain.handle(C.IPC_INVOKE.BOOKMARKS_SAVE, (e, data) => {
    if (!isSenderTrusted(e)) return false;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return false;
    saveBookmarks(context.profileId, data);
    broadcastBookmarks(context.profileId);
    return true;
});

ipcMain.handle(C.IPC_INVOKE.BOOKMARKS_ADD, (event, item) => {
    if (!isSenderTrusted(event)) return { bar: [] };
    const context = getWindowContextByEventSender(event.sender);
    if (!context) return { bar: [] };
    const data = loadBookmarks(context.profileId);

    const normUrl = (u) => u.toLowerCase().replace(/\/$/, '');
    const itemNorm = normUrl(item.url || '');

    // Remove if already exists (by ID or URL) to handle "Edit" or "Move"
    const removeFromList = (list) => {
        return list.filter(b => {
            if (b.id === item.id) return false;
            if (b.type === 'bookmark' && normUrl(b.url || '') === itemNorm) return false;

            if (b.type === C.BOOKMARK.TYPE_FOLDER && b.children) {
                b.children = removeFromList(b.children);
            }
            return true;
        });
    };
    data.bar = removeFromList(data.bar);

    // Add to root
    data.bar.push(item);
    saveBookmarks(context.profileId, data);
    broadcastBookmarks(context.profileId);
    return data;
});

ipcMain.handle(C.IPC_INVOKE.BOOKMARKS_REMOVE, (event, id) => {
    if (!isSenderTrusted(event)) return { bar: [] };
    const context = getWindowContextByEventSender(event.sender);
    if (!context) return { bar: [] };
    const data = loadBookmarks(context.profileId);
    const removeFromList = (list) => {
        return list.filter(item => {
            if (item.id === id) return false;
            if (item.type === C.BOOKMARK.TYPE_FOLDER && item.children) {
                item.children = removeFromList(item.children);
            }
            return true;
        });
    };
    data.bar = removeFromList(data.bar);
    saveBookmarks(context.profileId, data);
    broadcastBookmarks(context.profileId);
    return data;
});

ipcMain.handle(C.IPC_INVOKE.BOOKMARKS_REORDER, (e, bar) => {
    if (!isSenderTrusted(e)) return false;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return false;
    const data = loadBookmarks(context.profileId);
    data.bar = bar;
    saveBookmarks(context.profileId, data);
    broadcastBookmarks(context.profileId);
    return true;
});

ipcMain.handle(C.IPC_INVOKE.BOOKMARKS_ADD_FOLDER, (e, name) => {
    if (!isSenderTrusted(e)) return { bar: [] };
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return { bar: [] };
    const data = loadBookmarks(context.profileId);
    const folder = { id: 'f-' + Date.now(), type: 'folder', title: name, children: [] };
    data.bar.push(folder);
    saveBookmarks(context.profileId, data);
    broadcastBookmarks(context.profileId);
    return data;
});

ipcMain.handle(C.IPC_INVOKE.BOOKMARKS_ADD_TO_FOLDER, (e, folderId, item) => {
    if (!isSenderTrusted(e)) return { bar: [] };
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return { bar: [] };
    const data = loadBookmarks(context.profileId);

    const normUrl = (u) => u.toLowerCase().replace(/\/$/, '');
    const itemNorm = normUrl(item.url || '');

    // 1. Remove from old position (by ID or URL)
    const removeFromList = (list) => {
        return list.filter(b => {
            if (b.id === item.id) return false;
            if (b.type === 'bookmark' && normUrl(b.url || '') === itemNorm) return false;

            if (b.type === C.BOOKMARK.TYPE_FOLDER && b.children) {
                b.children = removeFromList(b.children);
            }
            return true;
        });
    };
    data.bar = removeFromList(data.bar);

    // 2. Find target folder and add
    const findFolder = (list) => {
        for (const b of list) {
            if (b.id === folderId && b.type === C.BOOKMARK.TYPE_FOLDER) return b;
            if (b.type === C.BOOKMARK.TYPE_FOLDER && b.children) {
                const found = findFolder(b.children);
                if (found) return found;
            }
        }
        return null;
    };
    const folder = findFolder(data.bar);
    if (folder) {
        folder.children.push(item);
        saveBookmarks(context.profileId, data);
        broadcastBookmarks(context.profileId);
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
ipcMain.on(C.IPC_SEND.TAB_SLEEP_REGISTER, (e, { id, url, title, favicon, history } = {}) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    context.sleepingTabs[id] = {
        url: url || C.URL.NTP_DISPLAY,
        title: title || null,
        favicon: favicon || null,
        history: history || null,
    };
    tabIdToWindowId.set(id, context.window.id);
});

// Hide / restore the active tab view so React modals can appear above it.
// WebContentsViews composite above the BrowserWindow shell HTML; shrinking bounds
// is not always enough — removeChildView clears the native layer so portaled UIs
// (tab context menu, bookmark editor, etc.) paint on top.
ipcMain.handle(C.IPC_INVOKE.TAB_HIDE_ACTIVE, (e) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    hideActiveTabViewForShellOverlay(context);
});

ipcMain.handle(C.IPC_INVOKE.TAB_RESTORE_ACTIVE, (e) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    restoreActiveTabViewFromShellOverlay(context);
});

/** JPEG snapshot of the active tab for shell overlay (profile menu freeze). */
ipcMain.handle(C.IPC_INVOKE.TAB_CAPTURE_SNAPSHOT, async (e) => {
    if (!isSenderTrusted(e)) return { dataUrl: null };
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return { dataUrl: null };
    const id = context.activeTabId;
    if (!id || detachedTabWindows.has(id)) return { dataUrl: null };
    const view = context.tabs[id];
    if (!view || view.webContents.isDestroyed()) return { dataUrl: null };
    try {
        const image = await view.webContents.capturePage();
        if (!image || image.isEmpty()) return { dataUrl: null };
        const buf = image.toJPEG(85);
        return { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` };
    } catch (err) {
        console.error(C.IPC_INVOKE.TAB_CAPTURE_SNAPSHOT, err);
        return { dataUrl: null };
    }
});

/**
 * Captures the visible tab, then hides its WebContentsView in one main-process turn.
 * Keeps the thumbnail correct while ensuring shell UI (omnibox dropdown) is never
 * covered by the native tab layer.
 */
ipcMain.handle(C.IPC_INVOKE.TAB_PREPARE_SHELL_OVERLAY, async (e) => {
    if (!isSenderTrusted(e)) return { dataUrl: null };
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return { dataUrl: null };
    const id = context.activeTabId;
    if (!id || detachedTabWindows.has(id)) return { dataUrl: null };
    const view = context.tabs[id];
    if (!view || view.webContents.isDestroyed()) return { dataUrl: null };
    let dataUrl = null;
    try {
        const image = await view.webContents.capturePage();
        if (image && !image.isEmpty()) {
            const buf = image.toJPEG(85);
            dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
        }
    } catch (err) {
        console.error('tab:prepare-shell-overlay capture', err);
    }
    try {
        hideActiveTabViewForShellOverlay(context);
    } catch (err) {
        console.error('tab:prepare-shell-overlay hide', err);
    }
    return { dataUrl };
});

ipcMain.handle(C.IPC_INVOKE.TAB_MOVE_NEW_WINDOW, async (e, { id, fallbackTabId }) => {
    if (!isSenderTrusted(e)) return { ok: false };
    if (!id || typeof id !== 'string') return { ok: false };
    try {
        return moveTabToDetachedWindow(id, fallbackTabId);
    } catch (err) {
        console.error(C.IPC_INVOKE.TAB_MOVE_NEW_WINDOW, err);
        return { ok: false };
    }
});

const TAB_STRIP_CONTEXT_MENU_MAX_ITEMS = 30;
const TAB_STRIP_CONTEXT_MENU_ACTION_IDS = new Set([
    'newTabRight',
    'moveNewWindow',
    C.IPC_SEND.RELOAD,
    'duplicate',
    'togglePin',
    'toggleMuteSite',
    'close',
    'closeOthers',
    'closeRight',
]);

/** Native tab strip context menu: Menu.popup above WebContentsView; actions round-trip to shell. */
ipcMain.handle(C.IPC_INVOKE.TAB_STRIP_CONTEXT_MENU, (e, payload = {}) => {
    if (!isSenderTrusted(e)) return { ok: false };
    const sender = e.sender;
    if (!sender || sender.isDestroyed()) return { ok: false };
    const tabId = payload.tabId;
    if (!tabId || typeof tabId !== 'string') return { ok: false };
    const x = Number(payload.x);
    const y = Number(payload.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false };
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const items = rawItems.slice(0, TAB_STRIP_CONTEXT_MENU_MAX_ITEMS);
    const win = BrowserWindow.fromWebContents(sender);
    if (!win || win.isDestroyed()) return { ok: false };

    const template = [];
    for (const raw of items) {
        if (!raw || typeof raw !== 'object') continue;
        if (raw.type === 'separator') {
            template.push({ type: 'separator' });
            continue;
        }
        if (raw.type !== 'item') continue;
        const actionId = raw.id;
        if (!actionId || typeof actionId !== 'string' || !TAB_STRIP_CONTEXT_MENU_ACTION_IDS.has(actionId)) {
            continue;
        }
        const label = truncateMenuLabel(String(raw.label || ''), 80);
        if (!label) continue;
        const enabled = raw.enabled !== false;
        const capturedTabId = tabId;
        const capturedActionId = actionId;
        template.push({
            label,
            enabled,
            click: () => {
                try {
                    if (!sender.isDestroyed()) {
                        sender.send(C.IPC_EVENT.TAB_STRIP_MENU_ACTION, {
                            tabId: capturedTabId,
                            id: capturedActionId,
                        });
                    }
                } catch (err) {
                    console.error(C.IPC_EVENT.TAB_STRIP_MENU_ACTION, err?.message || err);
                }
            },
        });
    }
    if (template.length === 0) return { ok: false };
    try {
        const menu = Menu.buildFromTemplate(template);
        menu.popup({ window: win, x: Math.round(x), y: Math.round(y) });
    } catch (err) {
        console.error(C.IPC_INVOKE.TAB_STRIP_CONTEXT_MENU, err?.message || err);
        return { ok: false };
    }
    return { ok: true };
});

ipcMain.handle(C.IPC_INVOKE.TAB_GET_INFO, async (e, { id }) => {
    if (!isSenderTrusted(e)) return null;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return null;

    // For sleeping tabs return their stored metadata without accessing a WebContentsView.
    if (!context.tabs[id] && context.sleepingTabs[id]) {
        return { url: context.sleepingTabs[id].url, title: null, memory: 0, isSleeping: true };
    }

    const view = context.tabs[id];
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
ipcMain.on(C.IPC_SEND.NEW_TAB, (e, { id, isStealth, url, source, history } = {}) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    dismissChromeShellMenuOverlay(context, 'browser-action');

    const resolvedUrl = resolveTabLoadUrl(url);
    appLogger.info('ipc:new-tab', {
        windowId: context.windowId,
        profileId: context.profileId,
        tabId: id,
        url: resolvedUrl,
        source,
        restoresHistory: !!history,
    });
    if (url && !isInternalPageUrl(url)) {
        markNextNavigationTransition(id, source || 'link');
    }

    const stealthTab = !!context.stealthWindow;
    createTab(context, id, resolvedUrl, stealthTab, {
        navigationHistory: history || null,
    });

    // Notify the main React shell so it can add the tab to its state
    if (context.window && !context.window.webContents.isDestroyed()) {
        context.window.webContents.send(C.IPC_EVENT.TAB_CREATED, { id, isStealth: stealthTab, url: resolvedUrl });
    }
    // Omnibox autofocus for blank/NTP is handled inside activateTabInContext() at the end of createTab().
});

ipcMain.on(C.IPC_SEND.SWITCH_TAB, (e, { id }) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    if (!context.tabs[id] && !context.sleepingTabs[id]) return; // Truly unknown tab — don't blank the window
    dismissChromeShellMenuOverlay(context, 'browser-action');
    appLogger.info('ipc:switch-tab', {
        windowId: context.windowId,
        profileId: context.profileId,
        tabId: id,
        wasSleeping: !!context.sleepingTabs[id],
    });
    activateOrWakeTab(id);
});

ipcMain.on(C.IPC_SEND.TAB_MENU_SYNC, (e, payload = {}) => {
    if (!isSenderTrusted(e)) return;
    if (typeof payload.muteSiteShowsUnmute === 'boolean') {
        tabMenuMuteSiteShowsUnmute = payload.muteSiteShowsUnmute;
    }
    if (typeof payload.pinShowsUnpin === 'boolean') {
        tabMenuPinShowsUnpin = payload.pinShowsUnpin;
    }
    rebuildApplicationMenu();
});

ipcMain.on(C.IPC_SEND.TAB_SET_AUDIO_MUTED, (e, { id, muted }) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    if (!id || typeof muted !== 'boolean') return;
    if (!context.tabs[id] || context.tabs[id].webContents.isDestroyed()) return;
    try {
        context.tabs[id].webContents.setAudioMuted(muted);
    } catch (_) { }
});

ipcMain.on(C.IPC_SEND.CLOSE_TAB, (e, payload = {}) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    const id = payload?.id;
    const closeWindowIfLast = payload?.closeWindowIfLast === true;
    if (!id || typeof id !== 'string') return;
    dismissChromeShellMenuOverlay(context, 'browser-action');

    const tabSnapshot = captureClosedTabSnapshot(context, id);
    appLogger.info('ipc:close-tab', {
        windowId: context.windowId,
        profileId: context.profileId,
        tabId: id,
        captured: !!tabSnapshot,
        url: tabSnapshot?.url || null,
    });

    // Clean up sleeping metadata regardless of whether a view was ever created.
    delete context.sleepingTabs[id];

    if (detachedTabWindows.has(id)) {
        const w = detachedTabWindows.get(id);
        if (w && !w.isDestroyed()) {
            w.close();
        }
        return;
    }

    if (context.tabs[id]) {
        removeTabContentChildView(context, context.tabs[id]);
        context.tabs[id].webContents.destroy();
        delete context.tabs[id];
        tabIdToWindowId.delete(id);
        destroyLensSession(context, id);
        if (context.activeTabId === id) context.activeTabId = null;
    }
    pendingTransitionsByTab.delete(String(id));
    historyService.clearTab(id);
    compatDiagnostics.clear(id);
    if (tabSnapshot) {
        pushRecentlyClosedEntry(context.profileId, {
            type: 'tab',
            title: tabSnapshot.title,
            url: tabSnapshot.url,
            history: tabSnapshot.history,
        });
    }

    const tabsRemaining =
        Object.keys(context.tabs).length + Object.keys(context.sleepingTabs).length;
    if (closeWindowIfLast && tabsRemaining === 0) {
        try {
            if (!context.window.isDestroyed()) context.window.close();
        } catch (err) {
            appLogger.error('ipc:close-tab:close-window', {
                windowId: context.windowId,
                error: appLogger.serializeError(err),
            });
        }
    }
});

ipcMain.on(C.IPC_SEND.GO_BACK, (e, { id }) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    dismissChromeShellMenuOverlay(context, 'browser-action');
    const targetId = id === 'current' ? context.activeTabId : id;
    appLogger.info('ipc:go-back', {
        windowId: context.windowId,
        profileId: context.profileId,
        tabId: targetId,
    });
    if (context.tabs[targetId]) context.tabs[targetId].webContents.navigationHistory.goBack();
});

ipcMain.on(C.IPC_SEND.GO_FORWARD, (e, { id }) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    dismissChromeShellMenuOverlay(context, 'browser-action');
    const targetId = id === 'current' ? context.activeTabId : id;
    appLogger.info('ipc:go-forward', {
        windowId: context.windowId,
        profileId: context.profileId,
        tabId: targetId,
    });
    if (context.tabs[targetId]) context.tabs[targetId].webContents.navigationHistory.goForward();
});

ipcMain.on(C.IPC_SEND.RELOAD, (e, { id }) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    dismissChromeShellMenuOverlay(context, 'browser-action');
    const targetId = id === 'current' ? context.activeTabId : id;
    if (context.tabs[targetId]) {
        appLogger.info('ipc:reload', {
            windowId: context.windowId,
            profileId: context.profileId,
            tabId: targetId,
            url: context.tabs[targetId].webContents.getURL(),
        });
        markNextNavigationTransition(targetId, C.IPC_SEND.RELOAD);
        resetTabWebContentsScale(context.tabs[targetId]);
        context.tabs[targetId].webContents.reload();
    }
});

ipcMain.on(C.IPC_SEND.NAVIGATE, (e, { id, url, source } = {}) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    if (!url) return; // Guard against undefined/null url
    dismissChromeShellMenuOverlay(context, 'browser-action');

    const targetId = id === 'current' ? context.activeTabId : id;
    if (!context.tabs[targetId]) return;
    appLogger.info('ipc:navigate-request', {
        windowId: context.windowId,
        profileId: context.profileId,
        tabId: targetId,
        url,
        source,
    });

    if (targetId === context.activeTabId && getLensSession(context, targetId, false)?.selectionActive) {
        closeGoogleLensSelection(context, { closeSidebar: true });
    }
    resetTabWebContentsScale(context.tabs[targetId]);

    let formattedUrl = url.trim();

    // Internal invisurf:// (and legacy stealth://) pages
    const resolvedInternalUrl = resolveInternalPageUrl(formattedUrl);
    if (resolvedInternalUrl !== formattedUrl) {
        resetTabWebContentsScale(context.tabs[targetId]);
        context.tabs[targetId]?.webContents.loadURL(resolvedInternalUrl);
        return;
    }

    // Heuristic for search query
    const looksLikeUrl = (str) => {
        if (str.includes('://')) return true;
        if (str.includes(' ') || !str.includes('.')) return false;
        return true;
    };

    const activeEngine = (loadSettings().searchEngine) || 'google';
    if (!looksLikeUrl(formattedUrl)) {
        formattedUrl = buildSearchUrl(activeEngine, formattedUrl);
    } else if (!formattedUrl.includes('://')) {
        formattedUrl = `https://${formattedUrl}`;
    }

    markNextNavigationTransition(targetId, source || 'link');
    resetTabWebContentsScale(context.tabs[targetId]);
    context.tabs[targetId]?.webContents.loadURL(formattedUrl);
});

// ─── CUSTOM PROTOCOL (Rule 18 — no file://) ─────────────────────────────────
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }
]);

function applyDockIconForSystemAppearance() {
    if (process.platform !== 'darwin' || !app.dock || !nativeTheme) return;
    // Packaged builds: Dock uses embedded .icns from electron-builder; setIcon(PNG) rescales
    // slightly vs neighbors. Dev-only override keeps custom icon under `electron .`.
    if (app.isPackaged) return;
    const iconFile = nativeTheme.shouldUseDarkColors ? 'icon-dark.png' : 'icon.png';
    const dockIconPath = path.join(__dirname, 'renderer', 'assets', 'logo', iconFile);
    if (!fs.existsSync(dockIconPath)) return;
    try {
        app.dock.setIcon(dockIconPath);
    } catch (error) {
        console.warn('Could not set Dock icon:', error?.message || error);
    }
}

app.whenReady().then(async () => {
    setupWebAuthn();
    appLogger.info('app:ready', {
        logDir: appLogger.getLogDir(),
        logFile: appLogger.getCurrentLogFile(),
        isPackaged: app.isPackaged,
    });
    registerAppProtocolForSession(session.defaultSession, 'default');
    installSessionNetworkGuards(session.defaultSession, { profileId: defaultProfileId, isStealthSession: false });
    logStartupIdentity(app, appLogger);

    applyColorThemeFromSettings();

    // macOS dev only: override Electron Dock tile + light/dark PNGs. Packaged app keeps bundle .icns.
    if (process.platform === 'darwin' && app.dock && nativeTheme && !app.isPackaged) {
        applyDockIconForSystemAppearance();
        nativeTheme.on('updated', applyDockIconForSystemAppearance);
    }

    const existingProfiles = loadProfiles();
    if (existingProfiles.length > 0) {
        for (const profile of existingProfiles) {
            ensureProfile(profile.profileId, profile.displayName);
            const sid = String(profile.profileId || '').trim().replace(/[^a-zA-Z0-9-_]/g, '_');
            const p = profilesById.get(sid);
            if (p) {
                if (profile.displayName) p.displayName = profile.displayName;
                if (typeof profile.createdAt === 'number') p.createdAt = profile.createdAt;
                if (typeof profile.updatedAt === 'number') p.updatedAt = profile.updatedAt;
                p.hasCustomAvatar = !!profile.hasCustomAvatar;
                p.avatarExt = profile.avatarExt || null;
                p.avatarSource =
                    profile.avatarSource === 'preset' || profile.avatarSource === 'upload'
                        ? profile.avatarSource
                        : null;
            }
        }
    } else {
        ensureProfile(`profile-${crypto.randomUUID()}`, 'Default');
        saveProfiles();
    }

    for (const profile of profilesById.values()) {
        try {
            const result = await historyService.migrateOldHistory(profile.profileId);
            if (result.didRun) {
                console.log(`Migrated history for ${profile.profileId}: ${result.migrated} rows, ${result.skipped} skipped`);
            }
        } catch (error) {
            console.error(`Failed to migrate history for ${profile.profileId}:`, error);
        }
    }

    const decodedSession = readDecodedSessionDoc();
    startupSessionDoc = decodedSession;
    createProfilePickerWindow();
});

/** macOS: dock icon click with no browser windows opens the profile picker (not on cold start). */
app.on('activate', () => {
    if (process.platform !== C.PLATFORM.DARWIN) return;
    if (appIsQuitting) return;
    if (windowContextsById.size > 0) return;
    if (profilePickerWindow && !profilePickerWindow.isDestroyed()) {
        profilePickerWindow.show();
        profilePickerWindow.focus();
        return;
    }
    createProfilePickerWindow();
});

/** Windows/Linux: quit when all windows are closed; macOS stays alive with zero windows. */
app.on('window-all-closed', () => {
    if (process.platform === C.PLATFORM.DARWIN) return;
    if (!appIsQuitting) app.quit();
});

app.on('before-quit', (event) => {
    appIsQuitting = true;
    appLogger.info('app:before-quit', {
        windowCount: BrowserWindow.getAllWindows().length,
        historyClosed: appHistoryClosed,
        historyCloseStarted: appHistoryCloseStarted,
    });
    if (appHistoryClosed && appCookieCleanupClosed) return;
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (appHistoryCloseStarted) return;
    appHistoryCloseStarted = true;
    appCookieCleanupStarted = true;
    Promise.all([
        historyService.closeAll()
            .then(() => {
                appHistoryClosed = true;
            }),
        cleanupSessionOnlyCookiesForAllProfiles()
            .then((deleted) => {
                appCookieCleanupClosed = true;
                if (deleted > 0) {
                    appLogger.info('cookies:session-only-cleanup', { deleted });
                }
            }),
        cleanupStealthCookiesForAllContexts()
            .then((deleted) => {
                if (deleted > 0) {
                    appLogger.info('cookies:stealth-cleanup', { deleted });
                }
            }),
    ])
        .catch((error) => {
            appLogger.error('app:shutdown-cleanup-failed', {
                error: appLogger.serializeError(error),
            });
            console.error('Failed to complete shutdown cleanup:', error);
        })
        .finally(() => {
            appHistoryClosed = true;
            appCookieCleanupClosed = true;
            if (appQuitAfterHistoryClose) return;
            appQuitAfterHistoryClose = true;
            appLogger.info('app:cleanup-closed-before-quit', {
                cookieCleanupStarted: appCookieCleanupStarted,
            });
            app.quit();
        });
});
