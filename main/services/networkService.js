
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const State = require('../state');
const { MAX_MAINFRAME_REDIRECTS, REDIRECT_WINDOW_MS } = require('../constants/defaults');
const { isLikelyTrackingRedirectUrl } = require('../utils/navigation');
const { getCachedCookieConfig } = require('./settingsService');
const { installCookieStoreGuard } = require('./cookieService');
const { configureSession } = require('../../runtime/sessionPolicy');

// Renderer files are immutable for the lifetime of a running app.  Keeping the
// NTP entry documents in memory prevents a Cmd+T from synchronously touching
// the filesystem on Electron's main-process event loop.
const appAssetCache = new Map();
const appAssetReads = new Map();
const NTP_PREWARM_PATHS = Object.freeze([
    'dist/newtab.html',
    'dist/assets/newtab.js',
]);

function appRendererPath(relativePath) {
    return path.join(app.getAppPath(), 'renderer', relativePath);
}

async function readAppAsset(filePath) {
    const cached = appAssetCache.get(filePath);
    if (cached) return cached;
    const pending = appAssetReads.get(filePath);
    if (pending) return pending;

    const read = fs.promises.readFile(filePath)
        .then((data) => {
            appAssetCache.set(filePath, data);
            return data;
        })
        .finally(() => {
            appAssetReads.delete(filePath);
        });
    appAssetReads.set(filePath, read);
    return read;
}

/** Warm only the tiny, self-contained NTP document and its JavaScript bundle. */
function prewarmNewTabAssets() {
    return Promise.all(
        NTP_PREWARM_PATHS.map(async (relativePath) => {
            try {
                await readAppAsset(appRendererPath(relativePath));
            } catch (err) {
                // Development rebuilds can briefly replace an asset.  The
                // protocol handler will retry from disk on the real request.
                console.warn('Failed to prewarm NTP asset', relativePath, err?.message || err);
            }
        }),
    );
}

function registerAppProtocolForSession(targetSession, sessionTag = 'unknown') {
    if (!targetSession || State.appProtocolInstalledSessions.has(targetSession)) return;
    targetSession.protocol.handle('app', async (request) => {
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

        // FIXED: Safely fetch the absolute path to the HTML renderer
        const filePath = appRendererPath(safePath);

        try {
            const data = await readAppAsset(filePath);
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
    State.appProtocolInstalledSessions.add(targetSession);
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

function recordCompatEvent(tabId, entry) {
    if (!tabId) return;
    const { loadSettings } = require('./settingsService');
    const compatDiagnostics = require('../../compatibilityDiagnostics');
    if (!loadSettings().compatibilityDiagnosticsEnabled) return;
    compatDiagnostics.push(tabId, { ...entry, timestamp: Date.now() });
}

function getSessionPolicyDeps({ profileId = null, isStealthSession = false } = {}) {
    const C = require('../../src/constants/conditionStrings.cjs');
    return {
        resourceTypeMainFrame: C.RESOURCE_TYPE.MAIN_FRAME,
        maxMainFrameRedirects: MAX_MAINFRAME_REDIRECTS,
        redirectWindowMs: REDIRECT_WINDOW_MS,
        isLikelyTrackingRedirectUrl,
        webContentsIdToTabId: State.webContentsIdToTabId,
        recordCompatEvent,
        pickResponseHeadersForDiag,
        mainFrameRequestWindowsByWebContents: State.mainFrameRequestWindowsByWebContents,
        profileId,
        isStealthSession,
        getCookieConfig: getCachedCookieConfig,
        logPolicyError: (stage, error) => {
            if (State.appLogger) {
                State.appLogger.warn('cookies:policy-hook-failed', {
                    stage,
                    error: State.appLogger.serializeError(error),
                });
            }
        },
    };
}

function installSessionNetworkGuards(targetSession, options = {}) {
    configureSession(targetSession, getSessionPolicyDeps(options));
    installCookieStoreGuard(targetSession, options);
}

module.exports = {
    registerAppProtocolForSession,
    prewarmNewTabAssets,
    pickResponseHeadersForDiag,
    recordCompatEvent,
    getSessionPolicyDeps,
    installSessionNetworkGuards
};
