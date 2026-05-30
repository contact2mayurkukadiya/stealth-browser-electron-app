/**
 * Per-session network policy: header sanitization and redirect guards.
 *
 * Installed once per Electron Session (idempotent). Does not mutate page-visible
 * Client Hints via injected JavaScript.
 */
const { getBrowserIdentity } = require('./browserIdentity');

const installedSessions = new WeakSet();

/** @type {Map<number, object[]>} webContentsId -> recent header observations */
const headerObservationsByWebContentsId = new Map();

const MAX_HEADER_OBSERVATIONS_PER_WEB_CONTENTS = 40;

/** Client Hint and identity-related header names to snapshot (values only, redacted if needed). */
const IDENTITY_HEADER_KEYS = new Set([
    'user-agent',
    'accept-language',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'sec-ch-ua-platform-version',
    'sec-ch-ua-arch',
    'sec-ch-ua-bitness',
    'sec-ch-ua-full-version-list',
    'x-requested-with',
]);

/** Headers that identify embedded frameworks and should not reach websites. */
const FRAMEWORK_HEADERS_TO_STRIP = new Set([
    'x-requested-with',
]);

function safeOrigin(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
        return new URL(rawUrl).origin;
    } catch {
        return null;
    }
}

function pickIdentityHeaders(requestHeaders) {
    const picked = {};
    if (!requestHeaders || typeof requestHeaders !== 'object') return picked;
    for (const key of Object.keys(requestHeaders)) {
        const low = key.toLowerCase();
        if (!IDENTITY_HEADER_KEYS.has(low)) continue;
        const val = requestHeaders[key];
        picked[low] = Array.isArray(val) ? val.join(', ') : String(val);
    }
    return picked;
}

function recordHeaderObservation(webContentsId, observation) {
    if (webContentsId == null || webContentsId < 0) return;
    let buffer = headerObservationsByWebContentsId.get(webContentsId);
    if (!buffer) {
        buffer = [];
        headerObservationsByWebContentsId.set(webContentsId, buffer);
    }
    buffer.push(observation);
    while (buffer.length > MAX_HEADER_OBSERVATIONS_PER_WEB_CONTENTS) buffer.shift();
}

/**
 * @param {{ session?: import('electron').Session | null, webContentsId?: number | null, limit?: number }} [options]
 */
function getHeaderObservations(options = {}) {
    const { session = null, webContentsId = null, limit = 20 } = options;
    if (webContentsId != null && webContentsId >= 0) {
        const rows = headerObservationsByWebContentsId.get(webContentsId) || [];
        return rows.slice(-limit);
    }
    if (session) {
        const all = [];
        for (const rows of headerObservationsByWebContentsId.values()) {
            all.push(...rows);
        }
        all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        return all.slice(-limit);
    }
    return [];
}

function isSessionPolicyInstalled(targetSession) {
    return !!(targetSession && installedSessions.has(targetSession));
}

/**
 * Install unified session policy on an Electron session partition.
 *
 * @param {import('electron').Session} targetSession
 * @param {{
 *   resourceTypeMainFrame: string,
 *   maxMainFrameRedirects: number,
 *   redirectWindowMs: number,
 *   isLikelyTrackingRedirectUrl: (url: string) => boolean,
 *   webContentsIdToTabId: Map<number, string>,
 *   recordCompatEvent: (tabId: string | undefined, event: object) => void,
 * }} deps
 */
function installSessionPolicy(targetSession, deps) {
    if (!targetSession || installedSessions.has(targetSession)) return;
    installedSessions.add(targetSession);

    const identity = getBrowserIdentity();

    targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const requestHeaders = { ...details.requestHeaders };
        const strippedFrameworkHeaders = [];

        for (const key of Object.keys(requestHeaders)) {
            if (FRAMEWORK_HEADERS_TO_STRIP.has(key.toLowerCase())) {
                strippedFrameworkHeaders.push(key.toLowerCase());
                delete requestHeaders[key];
            }
        }

        requestHeaders['User-Agent'] = identity.userAgent;
        requestHeaders['Accept-Language'] = identity.acceptLanguage;

        // Spoof Client Hints
        const majorVersion = process.versions.chrome.split(".")[0];
        const platform = process.platform === 'darwin' ? 'macOS' : 'Windows';
        const platformVersion = process.platform === 'darwin' ? '14.0.0' : '10.0.0';

        requestHeaders['sec-ch-ua'] = `"Not_A Brand";v="99", "Chromium";v="${majorVersion}", "Google Chrome";v="${majorVersion}"`;
        requestHeaders['sec-ch-ua-mobile'] = '?0';
        requestHeaders['sec-ch-ua-platform'] = `"${platform}"`;
        requestHeaders['sec-ch-ua-platform-version'] = `"${platformVersion}"`;

        recordHeaderObservation(details.webContentsId, {
            timestamp: Date.now(),
            origin: safeOrigin(details.url),
            resourceType: details.resourceType,
            method: details.method,
            strippedFrameworkHeaders,
            outboundHeaders: pickIdentityHeaders(requestHeaders),
        });

        callback({ requestHeaders });
    });

    targetSession.webRequest.onBeforeRequest((details, callback) => {
        if (details.resourceType !== deps.resourceTypeMainFrame) {
            callback({});
            return;
        }

        const webContentsId = details.webContentsId;
        const now = Date.now();
        const stateKey = webContentsId;
        let state = deps.mainFrameRequestWindowsByWebContents.get(stateKey);
        if (!state || now - state.startedAt > deps.redirectWindowMs) {
            state = { startedAt: now, count: 0 };
            deps.mainFrameRequestWindowsByWebContents.set(stateKey, state);
        }
        state.count += 1;

        const trackingRedirect = deps.isLikelyTrackingRedirectUrl(details.url);
        const redirectLoop = state.count > deps.maxMainFrameRedirects;
        if (!trackingRedirect && !redirectLoop) {
            callback({});
            return;
        }

        const reasonText = redirectLoop
            ? `Blocked because this tab requested more than ${deps.maxMainFrameRedirects} top-level pages within ${Math.round(deps.redirectWindowMs / 1000)} seconds.`
            : 'Blocked because the request matched known tracking/csync redirect patterns.';

        const tabIdForRequest = deps.webContentsIdToTabId.get(webContentsId);
        deps.recordCompatEvent(tabIdForRequest, {
            type: 'main-frame-request-blocked',
            url: details.url,
            reason: reasonText,
        });
        callback({ cancel: true });
    });

    targetSession.webRequest.onHeadersReceived((details, callback) => {
        if (details.resourceType !== deps.resourceTypeMainFrame) {
            callback({});
            return;
        }
        const tabIdForHeaders = deps.webContentsIdToTabId.get(details.webContentsId);
        deps.recordCompatEvent(tabIdForHeaders, {
            type: 'main-frame-response',
            url: details.url,
            statusCode: details.statusCode,
            headers: deps.pickResponseHeadersForDiag(details.responseHeaders),
        });
        callback({});
    });
}

/**
 * Configure session identity and install network policy before first navigation.
 * @param {import('electron').Session} targetSession
 * @param {Parameters<typeof installSessionPolicy>[1]} policyDeps
 */
function configureSession(targetSession, policyDeps) {
    applyIdentityToSessionSafe(targetSession);
    installSessionPolicy(targetSession, policyDeps);
}

function applyIdentityToSessionSafe(targetSession) {
    const identity = getBrowserIdentity();
    if (!targetSession || typeof targetSession.setUserAgent !== 'function') return;
    targetSession.setUserAgent(identity.userAgent, identity.acceptLanguage);
}

module.exports = {
    installSessionPolicy,
    configureSession,
    applyIdentityToSessionSafe,
    getHeaderObservations,
    isSessionPolicyInstalled,
};
