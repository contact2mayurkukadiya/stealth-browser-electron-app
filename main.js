const electron = require('electron');
const electronMain = (() => {
    try {
        return require('electron/main');
    } catch {
        return {};
    }
})();
const app = electron.app || electronMain.app;
const BrowserWindow = electron.BrowserWindow;
const WebContentsView = electron.WebContentsView;
const ipcMain = electron.ipcMain;
const Menu = electron.Menu;
const MenuItem = electron.MenuItem;
const dialog = electron.dialog || electronMain.dialog;
const protocol = electron.protocol || electronMain.protocol;
const net = electron.net || electronMain.net;
const clipboard = electron.clipboard;
const webContents = electron.webContents;
const session = electron.session || electronMain.session;
const screen = electron.screen;
const nativeTheme = electron.nativeTheme;
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const encryption = require('./encryption');
const compatDiagnostics = require('./compatibilityDiagnostics');
const authPolicy = require('./authPolicy'); // <--- ADD THIS
const { HistoryService } = require('./historyService');
const chromeTheme = require(path.join(__dirname, 'src', 'theme', 'chromeTheme.cjs'));
const C = require(path.join(__dirname, 'src', 'constants', 'conditionStrings.cjs'));

process.on('uncaughtException', (error) => {
    const message = error?.stack || error?.message || String(error);
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

const UI_HEIGHT = 122; // Height of our tabs + nav bar + bookmark bar
let generatedTabCounter = 0;
const MAX_RECENTLY_CLOSED_TABS = 25;
const recentlyClosedTabsByProfile = new Map();

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

// app.name = 'Google Chrome'; // Mimics OS execution signature matching processes exactly.
app.name = 'Google Chrome'; // Mimics OS execution signature matching processes exactly.


function getBrowserLikeUserAgent() {
    // const chromeVersion = process.versions.chrome || '120.0.0.0';
    const chromeMajor = process.versions.chrome.split('.')[0] || '120';
    const reducedVersion = `${chromeMajor}.0.0.0`;


    const platform = process.platform;
    if (platform === C.PLATFORM.DARWIN) {
        return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${reducedVersion} Safari/537.36`;
    }
    if (platform === C.PLATFORM.WIN32) {
        return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${reducedVersion} Safari/537.36`;
    }
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${reducedVersion} Safari/537.36`;
}


// Reduce obvious automation fingerprints and align with Chromium browser signals.
if (app?.commandLine) {
    app.commandLine.removeSwitch('enable-automation');

    app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
    // app.commandLine.appendSwitch('disable-features', 'UserAgentClientHint');

    app.commandLine.appendSwitch('disable-site-isolation-trials');
    app.commandLine.appendSwitch('lang', 'en-US,en');
}

app.userAgentFallback = getBrowserLikeUserAgent();

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
    const chromeVer = process.versions.chrome.split('.')[0];
    const nativeCHUA = `"Google Chrome";v="${chromeVer}", "Chromium";v="${chromeVer}", "Not_A Brand";v="99"`;


    // session.webRequest.onBeforeSendHeaders((details, callback) => {
    //     const { requestHeaders } = details;
    //     let finalHeaders = {};

    //     // Loop seamlessly to keep structural header parity for HTTP2
    //     for (const [key, value] of Object.entries(requestHeaders)) {
    //         const loweredKey = key.toLowerCase();

    //         // Rewrite the internal network user-agent to the unified version.
    //         if (loweredKey === 'user-agent') {
    //             finalHeaders[key] = getBrowserLikeUserAgent();
    //         }
    //         // Aggressively map 'Electron' completely out of Client Hints
    //         else if (loweredKey === 'sec-ch-ua') {
    //             finalHeaders[key] = nativeCHUA;
    //         }
    //         else if (loweredKey === 'sec-ch-ua-mobile') {
    //             finalHeaders[key] = '?0';
    //         }
    //         else {
    //             finalHeaders[key] = value;
    //         }
    //     }

    //     callback({ requestHeaders: finalHeaders });
    // });

    // Network-layer redirect/loop guard (more robust than will-redirect alone).

    session.webRequest.onBeforeRequest((details, callback) => {
        if (details.resourceType !== C.RESOURCE_TYPE.MAIN_FRAME) {
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
        if (details.resourceType !== C.RESOURCE_TYPE.MAIN_FRAME) {
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
                    app.exit(0);
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
    for (const watcher of devFileWatchers) {
        try { watcher.close(); } catch (_) { }
    }
    devFileWatchers.length = 0;
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
    // mappedSession.setUserAgent(getBrowserLikeUserAgent(), 'en-US,en;q=0.9');
    registerAppProtocolForSession(mappedSession, partition);
    authPolicy.applyGoogleAuthPolicy(mappedSession); // Force auth checks for the profile session

    /** One shared in-memory session per stealth window (all tabs incognito; discarded with the window). */
    let stealthTabsPartition = null;
    if (stealthWindow) {
        stealthTabsPartition = `in-memory:stealth-win-${crypto.randomUUID()}`;
        const stealthTabSession = session.fromPartition(stealthTabsPartition);
        registerAppProtocolForSession(stealthTabSession, stealthTabsPartition);
        authPolicy.applyGoogleAuthPolicy(stealthTabSession);
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
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            partition,
        }
    });

    // Keep main renderer UA/browser identity close to Chrome.
    window.webContents.setUserAgent(getBrowserLikeUserAgent());

    // Security constraints for main window
    window.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === C.PERMISSION.FULLSCREEN) return callback(true);
        callback(false); // Deny all other permissions safely
    });

    window.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' }; // Block popups
    });

    window.webContents.on('will-navigate', (event, url) => {
        // Only allow staying on the app:// UI page
        if (!url.startsWith('app://')) {
            event.preventDefault();
        }
    });

    window.webContents.on('will-attach-webview', (event) => {
        event.preventDefault(); // Prevent unexpected webview attachments
    });

    // mainWindow.webContents.openDevTools();


    // --- STEALTH MODE: apply persisted setting (defaults to true) ---
    window.setContentProtection(loadSettings().contentProtection);

    // Load renderer through app:// so IPC sender validation stays consistent.
    const shellEntryUrl = 'app://dist/index.html';
    window.loadURL(shellEntryUrl).catch((error) => {
        console.error('Failed to load shell entry URL:', shellEntryUrl, error);
    });

    // Custom Application Menu for robust shortcuts and tab actions
    rebuildApplicationMenu();

    // Global Shortcut Interception (for Ctrl+Tab, which is not easy in menu)
    window.webContents.on('before-input-event', handleShortcuts);

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
        tooltipView: null,
        /** Full-window WebContentsView for HTML menus above tab layer (no tab detach). */
        chromeOverlayView: null,
        /** Ref-count for chrome-overlay:v1 acquire/release from trusted shell. */
        chromeOverlayAcquireCount: 0,
    };
    windowContextsById.set(window.id, context);

    if (stealthWindow) {
        window.setTitle('InviSurf — Stealth');
        windowBootstrapById.set(context.windowId, { stealthWindow: true });
    }

    window.on('resize', () => {
        if (!context.activeTabId || detachedTabWindows.has(context.activeTabId)) return;
        const view = context.tabs[context.activeTabId];
        if (!view) return;
        if (context.isActiveTabTemporarilyHidden) {
            if (!context.activeTabViewRemovedForShellOverlay) {
                view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            }
            return;
        }
        const { width, height } = window.getContentBounds();
        const fs = htmlFullscreenTabId === context.activeTabId;
        view.setBounds({
            x: 0,
            y: fs ? 0 : UI_HEIGHT,
            width,
            height: fs ? height : height - UI_HEIGHT,
        });
        layoutChromeOverlayBounds(context);
        ensureChromeOverlayOnTop(context);
    });

    window.on('close', () => {
        // Destroy all tab WebContentsViews before the parent window is torn down.
        // On Windows, leaving live child views attached when the native window handle
        // is destroyed causes a native (C++) crash.
        for (const tabId of Object.keys(context.tabs)) {
            const view = context.tabs[tabId];
            try { context.window.contentView.removeChildView(view); } catch (_) { }
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
        context.chromeOverlayAcquireCount = 0;
    });

    window.on('closed', () => {
        windowContextsById.delete(window.id);
        windowBootstrapById.delete(context.windowId);
        if (mainWindow === window) {
            mainWindow = BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) || null;
        }
    });

    createChromeOverlayLayer(context);
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
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    picker.loadURL('app://dist/profile-picker.html').catch((error) => {
        console.error('Failed to load profile picker:', error);
    });
    profilePickerWindow = picker;
    picker.on('closed', () => {
        profilePickerWindow = null;
        if (windowContextsById.size === 0) {
            app.quit();
        }
    });
}

function createChromeOverlayLayer(context) {
    if (context.chromeOverlayView) return;
    const overlayView = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
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

/**
 * Tab WebContentsView must stay below the chrome overlay; tooltip stays topmost.
 * Call after tab attach/detach and whenever z-order may have changed.
 */
function ensureChromeOverlayOnTop(context) {
    if (!context?.window?.contentView) return;
    const cv = context.window.contentView;
    const activeId = context.activeTabId;
    const tabView =
        activeId && !detachedTabWindows.has(activeId) ? context.tabs[activeId] : null;
    try {
        if (tabView && !tabView.webContents.isDestroyed()) {
            cv.addChildView(tabView);
        }
        if (context.chromeOverlayView && !context.chromeOverlayView.webContents.isDestroyed()) {
            cv.addChildView(context.chromeOverlayView);
        }
        if (context.tooltipView && !context.tooltipView.webContents.isDestroyed()) {
            cv.addChildView(context.tooltipView);
        }
    } catch (err) {
        console.error('ensureChromeOverlayOnTop', err?.message || err);
    }
}

function layoutChromeOverlayBounds(context) {
    if (!context?.chromeOverlayView || context.chromeOverlayView.webContents.isDestroyed()) return;
    if (context.chromeOverlayAcquireCount <= 0) return;
    const { width, height } = context.window.getContentBounds();
    try {
        context.chromeOverlayView.setBounds({ x: 0, y: 0, width, height });
    } catch (err) {
        console.error('layoutChromeOverlayBounds', err?.message || err);
    }
}

function getWindowContextByChromeOverlaySender(sender) {
    if (!sender || sender.isDestroyed?.()) return null;
    for (const ctx of windowContextsById.values()) {
        const ov = ctx.chromeOverlayView;
        if (ov && !ov.webContents.isDestroyed() && ov.webContents === sender) {
            return ctx;
        }
    }
    return null;
}

function createTooltipOverlay(context) {
    const tooltipView = new WebContentsView({
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
        context.window.contentView.removeChildView(view);
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
            context.window.contentView.addChildView(view);
            context.activeTabViewRemovedForShellOverlay = false;
        } catch (err) {
            console.error('restoreActiveTabViewFromShellOverlay addChildView:', err?.message || err);
        }
    }
    const { width, height } = context.window.getContentBounds();
    const fs = htmlFullscreenTabId === context.activeTabId;
    try {
        view.setBounds({
            x: 0,
            y: fs ? 0 : UI_HEIGHT,
            width,
            height: fs ? height : height - UI_HEIGHT,
        });
    } catch (err) {
        console.error('restoreActiveTabViewFromShellOverlay setBounds:', err?.message || err);
    }
    ensureChromeOverlayOnTop(context);
}

function activateTabInContext(context, id) {
    if (!context || !context.tabs[id]) return false;
    const skipSameTab =
        context.activeTabId === id &&
        !detachedTabWindows.has(id) &&
        !context.isActiveTabTemporarilyHidden;
    // Re-activating the already-visible tab only removes/re-attaches every view and
    // re-sends omnibox:focus — causes NTP flicker when clicking the active tab repeatedly.
    if (skipSameTab) {
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
            context.window.contentView.removeChildView(context.tabs[tid]);
        } catch (_) {
            // View may already be detached from the shell.
        }
    }
    context.window.contentView.addChildView(context.tabs[id]);
    const { width, height } = context.window.getContentBounds();
    const fs = htmlFullscreenTabId === id;
    context.tabs[id].setBounds({
        x: 0,
        y: fs ? 0 : UI_HEIGHT,
        width,
        height: fs ? height : height - UI_HEIGHT,
    });
    const activeUrl = context.tabs[id]?.webContents.getURL() ?? '';
    const blankActive = isBlankTab(activeUrl);
    // For blank/NTP tabs we move keyboard focus straight to the shell + omnibox (below).
    // Focusing the tab WebContentsView first caused a visible focus flash before setImmediate.
    if (!blankActive) {
        context.tabs[id].webContents.focus();
    }
    context.activeTabId = id;
    if (context.window && !context.window.webContents.isDestroyed()) {
        context.window.webContents.send(C.IPC_EVENT.TAB_SWITCHED, { id });
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
            sendOmniboxFocusToShell(context, id, true);
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
    const movedTabUrl = view.webContents.getURL();
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
        context.window.contentView.removeChildView(view);
    } catch (_) {
        // Not attached (e.g. inactive tab) — continue cleanup.
    }
    try {
        view.webContents.destroy();
    } catch (_) {
        /* ignore */
    }
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
            isStealth: false,
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

/** Focus shell omnibox — shared by activateTabInContext and load handlers. */
function sendOmniboxFocusToShell(context, tabId, selectAll) {
    if (!context.window || context.window.isDestroyed()) return;
    try {
        context.window.focus();
    } catch (_) {
        /* ignore */
    }
    if (context.window.webContents.isDestroyed()) return;
    context.window.webContents.focus();
    context.window.webContents.send(C.IPC_EVENT.OMNIBOX_FOCUS, { tabId, selectAll });
}

function toDisplayUrl(rawUrl) {
    if (!rawUrl) return '';
    if (rawUrl.startsWith(C.URL.SCHEME_APP) && rawUrl.includes(C.URL.FRAGMENT_HISTORY)) return C.URL.HISTORY_DISPLAY;
    if (rawUrl.startsWith(C.URL.SCHEME_APP) && rawUrl.includes(C.URL.FRAGMENT_SETTINGS)) return C.URL.SETTINGS_DISPLAY;
    if (rawUrl.startsWith(C.URL.SCHEME_APP) && rawUrl.includes(C.URL.FRAGMENT_NEWTAB)) return C.URL.NTP_DISPLAY;
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
        const resolvedUrl = resolveTabLoadUrl(context.sleepingTabs[id].url);
        delete context.sleepingTabs[id];
        createTab(context, id, resolvedUrl, !!context.stealthWindow);

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
    const activeView = getActiveTabView();
    if (!activeView || activeView.webContents.isDestroyed()) return;
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

function canStoreRecentlyClosedUrl(rawUrl) {
    const displayUrl = toDisplayUrl(rawUrl);
    const resolvedUrl = resolveInternalPageUrl(displayUrl);
    if (!resolvedUrl || resolvedUrl.startsWith(C.URL.SCHEME_DATA)) return false;
    return isAllowedTabNavigationUrl(resolvedUrl);
}

function pushRecentlyClosedTab(profileId, entry) {
    if (!entry || !canStoreRecentlyClosedUrl(entry.url)) return;
    const recentlyClosedTabs = getOrCreateRecentlyClosedForProfile(profileId);
    const normalizedEntry = {
        title: (entry.title || '').trim(),
        url: toDisplayUrl(entry.url),
        closedAt: Date.now(),
    };

    const previousEntry = recentlyClosedTabs[0];
    if (previousEntry && previousEntry.url === normalizedEntry.url && previousEntry.title === normalizedEntry.title) {
        return;
    }

    recentlyClosedTabs.unshift(normalizedEntry);
    if (recentlyClosedTabs.length > MAX_RECENTLY_CLOSED_TABS) {
        recentlyClosedTabs.length = MAX_RECENTLY_CLOSED_TABS;
    }
    rebuildApplicationMenu();
}

function restoreRecentlyClosedTab(closedAt) {
    const context = getWindowContextByBrowserWindow(mainWindow);
    if (!context) return;
    const recentlyClosedTabs = getOrCreateRecentlyClosedForProfile(context.profileId);
    const targetIndex = recentlyClosedTabs.findIndex(entry => entry.closedAt === closedAt);
    if (targetIndex < 0) return;
    const [entry] = recentlyClosedTabs.splice(targetIndex, 1);
    rebuildApplicationMenu();
    if (!entry?.url) return;
    openUrlInNewTab(entry.url, { background: false });
}

function buildRecentlyClosedMenuItems() {
    const context = getWindowContextByBrowserWindow(mainWindow);
    if (!context) return [{ label: 'No recently closed tabs', enabled: false }];
    const recentlyClosedTabs = getOrCreateRecentlyClosedForProfile(context.profileId);
    if (recentlyClosedTabs.length === 0) {
        return [{ label: 'No recently closed tabs', enabled: false }];
    }

    return recentlyClosedTabs.map(entry => ({
        label: truncateMenuLabel(entry.title || entry.url),
        toolTip: entry.url,
        click: () => restoreRecentlyClosedTab(entry.closedAt),
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
    const sessionForWindowId = closePicker ? startupSessionDoc : null;
    const resolvedWindowId = findSessionWindowIdForProfile(sessionForWindowId, profile.profileId);
    const created = createWindow({ profileId: profile.profileId, windowId: resolvedWindowId });
    if (closePicker) {
        startupSessionDoc = null;
        if (profilePickerWindow && !profilePickerWindow.isDestroyed()) {
            profilePickerWindow.close();
        }
    }
    return { windowId: created.windowId, profileId: profile.profileId };
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

/** Clear overlay session so another feature can take the surface (ref count → 0, hide, notify shell). */
ipcMain.handle(C.IPC_INVOKE.CHROME_OVERLAY_RESET, (e) => {
    if (!isSenderTrusted(e)) return { ok: false };
    const context = getWindowContextByEventSender(e.sender);
    if (!context?.chromeOverlayView) return { ok: false };
    context.chromeOverlayAcquireCount = 0;
    try {
        if (!context.chromeOverlayView.webContents.isDestroyed()) {
            context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
        }
        context.chromeOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
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
    if (!context?.chromeOverlayView) return { ok: false };
    context.chromeOverlayAcquireCount = (context.chromeOverlayAcquireCount || 0) + 1;
    if (context.chromeOverlayAcquireCount === 1) {
        layoutChromeOverlayBounds(context);
        ensureChromeOverlayOnTop(context);
    }
    return { ok: true };
});

ipcMain.handle(C.IPC_INVOKE.CHROME_OVERLAY_RELEASE, (e) => {
    if (!isSenderTrusted(e)) return { ok: false };
    const context = getWindowContextByEventSender(e.sender);
    if (!context?.chromeOverlayView) return { ok: false };
    if (context.chromeOverlayAcquireCount > 0) {
        context.chromeOverlayAcquireCount -= 1;
    }
    if (context.chromeOverlayAcquireCount <= 0) {
        context.chromeOverlayAcquireCount = 0;
        try {
            if (!context.chromeOverlayView.webContents.isDestroyed()) {
                context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
            }
            context.chromeOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        } catch (err) {
            console.error(C.IPC_INVOKE.CHROME_OVERLAY_RELEASE, err?.message || err);
        }
    }
    return { ok: true };
});

ipcMain.handle(C.IPC_INVOKE.CHROME_OVERLAY_POST, (e, payload) => {
    if (!isSenderTrusted(e)) return { ok: false };
    const context = getWindowContextByEventSender(e.sender);
    if (!context?.chromeOverlayView || context.chromeOverlayView.webContents.isDestroyed()) {
        return { ok: false };
    }
    if (context.chromeOverlayAcquireCount <= 0) return { ok: false };
    try {
        const json = JSON.stringify(payload ?? {});
        if (json.length > CHROME_OVERLAY_POST_MAX_BYTES) return { ok: false };
    } catch {
        return { ok: false };
    }
    try {
        context.chromeOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, payload ?? {});
    } catch (err) {
        console.error(C.IPC_INVOKE.CHROME_OVERLAY_POST, err?.message || err);
        return { ok: false };
    }
    return { ok: true };
});

ipcMain.on(C.IPC_SEND.CHROME_OVERLAY_FROM_OVERLAY, (e, data) => {
    const context = getWindowContextByChromeOverlaySender(e.sender);
    if (!context?.window?.webContents || context.window.webContents.isDestroyed()) return;
    try {
        context.window.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_HOST, data ?? {});
    } catch (err) {
        console.error(C.IPC_SEND.CHROME_OVERLAY_FROM_OVERLAY, err?.message || err);
    }
});

// Helper to handle keyboard shortcuts across different WebContents
function handleShortcuts(event, input) {
    if (input.type !== 'keyDown') return;

    const key = input.key.toLowerCase();
    const isCommandOrControlPressed = input.control || input.meta;

    if (isCommandOrControlPressed && key === 'y') {
        event.preventDefault();
        focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_HISTORY);
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
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            partition: tabPartition,
        }
    });

    context.tabs[id] = view;
    tabIdToWindowId.set(id, context.window.id);
    // Active tabs are attached via activateTabInContext() so only one tab view is in the
    // hierarchy at a time (avoids stacked views stealing hit-testing until switch-tab runs).
    if (!shouldActivate) {
        context.window.contentView.addChildView(view);
        view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }

    const webContentsNumericId = view.webContents.id;
    webContentsIdToTabId.set(webContentsNumericId, id);
    view.webContents.on('destroyed', () => {
        webContentsIdToTabId.delete(webContentsNumericId);
    });

    // Make tab requests look like a regular Chrome browser, not Electron.
    view.webContents.setUserAgent(getBrowserLikeUserAgent());
    // view.webContents.session.setUserAgent(getBrowserLikeUserAgent(), 'en-US,en;q=0.9');
    authPolicy.setupTabForGoogleAuth(view.webContents, getBrowserLikeUserAgent);

    installSessionNetworkGuards(view.webContents.session);
    installDevToolsTypographyOnOpen(view.webContents);

    // ─── Security guards for tab content (Rules 13, 14) ────
    // Convert safe popup/new-tab intents into app tabs; block everything else.
    view.webContents.setWindowOpenHandler(({ url: targetUrl, disposition }) => {
        if (!isAllowedTabNavigationUrl(targetUrl)) {
            console.warn(`[Security] Blocked popup/open to: ${targetUrl}`);
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

    // A subset of anti-automation checks look at navigator.webdriver.
    // This mirrors mainstream browser behavior for regular tabs.
    // view.webContents.on('dom-ready', () => {
    //     view.webContents.executeJavaScript(`
    //         try {
    //             Object.defineProperty(navigator, 'webdriver', {
    //                 get: () => undefined,
    //                 configurable: true
    //             });
    //         } catch (_) {}
    //     `).catch(() => { });
    // });

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
        const loadedUrl = view.webContents.getURL();
        if (context.activeTabId !== id) return;

        // Google homepage: scripts steal focus from the omnibox after load.
        if (shouldReassertOmniboxAfterPageLoad(loadedUrl)) {
            setImmediate(() => {
                if (context.activeTabId !== id) return;
                sendOmniboxFocusToShell(context, id, false);
            });
            return;
        }

        // Bundled NTP: early omnibox IPC can lose to guest focus after paint/load;
        // re-assert once when the document finishes (does not use omniboxFocusGen).
        if (isCustomNewTabDocumentUrl(loadedUrl) && isBlankTab(loadedUrl)) {
            setImmediate(() => {
                if (context.activeTabId !== id) return;
                sendOmniboxFocusToShell(context, id, true);
            });
        }
    });

    // Use these flags to temporarily hold the title until page load completes or URL changes
    view.webContents.on('did-navigate', (event, targetUrl) => {
        let displayUrl = getDisplayUrl(targetUrl);
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
        let displayUrl = getDisplayUrl(targetUrl);
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
                    <img src="app://localhost/assets/images/error-page-alert.svg" width="64" height="64" alt="" style="margin-bottom: 20px;" />
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

    view.webContents.loadURL(resolveTabLoadUrl(url));

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
    if (!ov || ov.webContents.isDestroyed()) return;
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
        sendChromeOverlayThemePatch(ctx);
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

function loadSettings() {
    try {
        const p = getSettingsPath();
        if (fs.existsSync(p)) {
            const merged = { ...SETTINGS_DEFAULTS, ...JSON.parse(fs.readFileSync(p, 'utf-8')) };
            merged.colorTheme = normalizeColorTheme(merged.colorTheme);
            return chromeTheme.normalizeAccentFields(merged);
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    const defaults = { ...SETTINGS_DEFAULTS };
    defaults.colorTheme = normalizeColorTheme(defaults.colorTheme);
    return chromeTheme.normalizeAccentFields(defaults);
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

ipcMain.handle(C.IPC_INVOKE.SETTINGS_GET, (e) => {
    if (!isSenderTrusted(e)) return SETTINGS_DEFAULTS;
    return loadSettings();
});

ipcMain.handle(C.IPC_INVOKE.SETTINGS_SAVE, (e, data) => {
    if (!isSenderTrusted(e)) return false;
    const current = loadSettings();
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
    saveSettings(chromeTheme.normalizeAccentFields(next));
    applyColorThemeFromSettings();
    return true;
});

ipcMain.handle(C.IPC_INVOKE.APP_RELAUNCH, (e) => {
    if (!isSenderTrusted(e)) return;
    app.relaunch();
    app.exit(0);
});

ipcMain.handle(C.IPC_INVOKE.COMPAT_GET_REPORT, (e, payload = {}) => {
    if (!isSenderTrusted(e)) return null;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return null;
    const tabId = payload && payload.tabId != null ? String(payload.tabId) : undefined;
    const report = compatDiagnostics.getReport(tabId);
    return { ...report, activeTabId: context.activeTabId };
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
 * omnibox:steal-focus — sent by the NTP fakebox when clicked.
 * Forwards an omnibox:focus event to the browser shell so the real address bar
 * receives keyboard focus instead of the cosmetic NTP element.
 */
ipcMain.on(C.IPC_SEND.OMNIBOX_STEAL_FOCUS, (e) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context?.activeTabId) return;
    sendOmniboxFocusToShell(context, context.activeTabId, true);
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
ipcMain.on(C.IPC_SEND.TAB_SLEEP_REGISTER, (e, { id, url }) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    context.sleepingTabs[id] = { url: url || 'https://www.google.com' };
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
ipcMain.on(C.IPC_SEND.NEW_TAB, (e, { id, isStealth, url, source } = {}) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;

    const resolvedUrl = resolveTabLoadUrl(url);
    if (url && !isInternalPageUrl(url)) {
        markNextNavigationTransition(id, source || 'link');
    }

    const stealthTab = !!context.stealthWindow;
    createTab(context, id, resolvedUrl, stealthTab);

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

ipcMain.on(C.IPC_SEND.CLOSE_TAB, (e, { id }) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;

    let recentlyClosedCandidate = null;
    if (context.sleepingTabs[id]) {
        recentlyClosedCandidate = {
            title: context.sleepingTabs[id].url,
            url: context.sleepingTabs[id].url,
        };
    } else if (context.tabs[id] && !context.tabs[id].webContents.isDestroyed()) {
        recentlyClosedCandidate = {
            title: context.tabs[id].webContents.getTitle(),
            url: context.tabs[id].webContents.getURL(),
        };
    }

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
        try {
            context.window.contentView.removeChildView(context.tabs[id]);
        } catch (_) {
            /* view may not be attached to the main shell */
        }
        context.tabs[id].webContents.destroy();
        delete context.tabs[id];
        tabIdToWindowId.delete(id);
        if (context.activeTabId === id) context.activeTabId = null;
    }
    pendingTransitionsByTab.delete(String(id));
    historyService.clearTab(id);
    compatDiagnostics.clear(id);
    pushRecentlyClosedTab(context.profileId, recentlyClosedCandidate);
});

ipcMain.on(C.IPC_SEND.GO_BACK, (e, { id }) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    const targetId = id === 'current' ? context.activeTabId : id;
    if (context.tabs[targetId]) context.tabs[targetId].webContents.navigationHistory.goBack();
});

ipcMain.on(C.IPC_SEND.GO_FORWARD, (e, { id }) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    const targetId = id === 'current' ? context.activeTabId : id;
    if (context.tabs[targetId]) context.tabs[targetId].webContents.navigationHistory.goForward();
});

ipcMain.on(C.IPC_SEND.RELOAD, (e, { id }) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    const targetId = id === 'current' ? context.activeTabId : id;
    if (context.tabs[targetId]) {
        markNextNavigationTransition(targetId, C.IPC_SEND.RELOAD);
        context.tabs[targetId].webContents.reload();
    }
});

ipcMain.on(C.IPC_SEND.NAVIGATE, (e, { id, url, source } = {}) => {
    if (!isSenderTrusted(e)) return;
    const context = getWindowContextByEventSender(e.sender);
    if (!context) return;
    if (!url) return; // Guard against undefined/null url

    const targetId = id === 'current' ? context.activeTabId : id;
    if (!context.tabs[targetId]) return;

    let formattedUrl = url.trim();

    // Internal invisurf:// (and legacy stealth://) pages
    const resolvedInternalUrl = resolveInternalPageUrl(formattedUrl);
    if (resolvedInternalUrl !== formattedUrl) {
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
    console.log("YOUR DATA IS HERE:", app.getPath('userData'));
    registerAppProtocolForSession(session.defaultSession, 'default');
    authPolicy.applyGoogleAuthPolicy(session.defaultSession); // Force auth checks for the default session

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

app.on('before-quit', () => {
    historyService.closeAll().catch((error) => {
        console.error('Failed to close history databases:', error);
    });
});
