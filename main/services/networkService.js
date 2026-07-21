
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const State = require('../state');
const { MAX_MAINFRAME_REDIRECTS, REDIRECT_WINDOW_MS } = require('../constants/defaults');
const { isLikelyTrackingRedirectUrl } = require('../utils/navigation');
const { getCachedCookieConfig } = require('./settingsService');
const { installCookieStoreGuard } = require('./cookieService');
const { configureSession } = require('../../runtime/sessionPolicy');

function registerAppProtocolForSession(targetSession, sessionTag = 'unknown') {
    if (!targetSession || State.appProtocolInstalledSessions.has(targetSession)) return;
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

        // FIXED: Safely fetch the absolute path to the HTML renderer
        const filePath = path.join(app.getAppPath(), 'renderer', safePath);

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
    pickResponseHeadersForDiag,
    recordCompatEvent,
    getSessionPolicyDeps,
    installSessionNetworkGuards
};