/**
 * Per-session network policy: header sanitization and redirect guards.
 *
 * Installed once per Electron Session (idempotent). Does not mutate page-visible
 * Client Hints via injected JavaScript.
 */
const { getBrowserIdentity } = require('./browserIdentity');

const installedSessions = new WeakSet();
const sessionPolicyContext = new WeakMap();

/** @type {Map<number, object[]>} webContentsId -> recent header observations */
const headerObservationsByWebContentsId = new Map();

/** @type {Map<number, Set<string>>} webContentsId -> domains loaded in the current page */
const tabNetworkDomains = new Map();

/** @type {Map<number, string>} webContentsId -> top-level registerable domain for the tab */
const tabTopLevelRegisterableDomain = new Map();

/** @type {Set<string>} domains blocked from setting or sending cookies */
const cookieBlocklist = new Set();

const COOKIE_GLOBAL_POLICIES = new Set([
    'allow',
    'block_third_party',
    'block_all',
]);

const COOKIE_EXCEPTION_SETTINGS = new Set(['allow', 'block', 'session_only']);
const MAX_COOKIE_PATTERN_LENGTH = 253;
const DEFAULT_COMPILED_COOKIE_CONFIG = {
    globalPolicy: 'allow',
    blockRules: [],
    allowRules: [],
    sessionOnlyRules: [],
};

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

function safeHostname(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
        return new URL(rawUrl).hostname.toLowerCase();
    } catch {
        return '';
    }
}

function normalizeCookieConfig(config) {
    const input = config && typeof config === 'object' ? config : {};
    const rawGlobalPolicy = input.globalPolicy === 'block_third_party_stealth' ? 'allow' : input.globalPolicy;
    const globalPolicy = COOKIE_GLOBAL_POLICIES.has(rawGlobalPolicy) ? rawGlobalPolicy : 'allow';
    const exceptions = Array.isArray(input.exceptions)
        ? input.exceptions
            .map((rule) => ({
                pattern: String(rule?.pattern || '').trim().toLowerCase(),
                setting: COOKIE_EXCEPTION_SETTINGS.has(rule?.setting) ? rule.setting : null,
            }))
            .filter((rule) => rule.pattern && rule.setting)
        : [];
    return { globalPolicy, exceptions };
}

function escapeRegexExceptWildcard(value) {
    return String(value || '').replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&');
}

function normalizeCookiePattern(pattern) {
    const raw = String(pattern || '').trim().toLowerCase();
    if (!raw || raw.length > MAX_COOKIE_PATTERN_LENGTH) return '';
    if (raw.startsWith('[*.]')) return `*.${raw.slice(4).replace(/^\.+/, '')}`;
    return raw.replace(/^\.+/, '');
}

function patternToRegExp(pattern) {
    try {
        const normalized = normalizeCookiePattern(pattern);
        if (!normalized) return null;
        if (normalized.startsWith('*.')) {
            const domain = escapeRegexExceptWildcard(normalized.slice(2)).replace(/\*/g, '.*');
            return new RegExp(`^(?:[^.]+\\.)*${domain}$`, 'i');
        }
        const escaped = escapeRegexExceptWildcard(normalized).replace(/\*/g, '.*');
        return new RegExp(`^${escaped}$`, 'i');
    } catch {
        return null;
    }
}

function compileCookieConfig(config) {
    const normalized = normalizeCookieConfig(config);
    const compiled = {
        globalPolicy: normalized.globalPolicy,
        blockRules: [],
        allowRules: [],
        sessionOnlyRules: [],
    };

    for (const rule of normalized.exceptions) {
        const regex = patternToRegExp(rule.pattern);
        if (!regex) continue;
        const compiledRule = {
            pattern: rule.pattern,
            setting: rule.setting,
            regex,
        };
        if (rule.setting === 'block') compiled.blockRules.push(compiledRule);
        else if (rule.setting === 'allow') compiled.allowRules.push(compiledRule);
        else if (rule.setting === 'session_only') compiled.sessionOnlyRules.push(compiledRule);
    }

    return compiled;
}

function getCookieConfigForSession(targetSession) {
    const ctx = sessionPolicyContext.get(targetSession) || {};
    if (typeof ctx.getCookieConfig === 'function') {
        const cached = ctx.getCookieConfig(ctx.profileId);
        return cached && typeof cached === 'object' ? cached : DEFAULT_COMPILED_COOKIE_CONFIG;
    }
    return DEFAULT_COMPILED_COOKIE_CONFIG;
}

function normalizeHost(host) {
    return String(host || '').trim().toLowerCase().replace(/^\.+/, '');
}

function normalizePattern(pattern) {
    const normalized = normalizeCookiePattern(pattern);
    if (normalized.startsWith('*.')) return normalized.slice(2);
    return normalized;
}

function cookiePatternMatchesHost(pattern, host) {
    const normalizedHost = normalizeHost(host);
    if (!normalizedHost) return false;
    const regex = patternToRegExp(pattern);
    return !!(regex && regex.test(normalizedHost));
}

function getCookieExceptionForHost(config, host) {
    const policy = config?.blockRules ? config : compileCookieConfig(config);
    return [...policy.blockRules, ...policy.allowRules, ...policy.sessionOnlyRules]
        .find((rule) => rule.regex.test(normalizeHost(host))) || null;
}

const COMMON_SECOND_LEVEL_TLDS = new Set([
    'ac', 'co', 'com', 'edu', 'gov', 'net', 'org',
]);

function getRegisterableDomain(host) {
    const normalizedHost = normalizeHost(host);
    if (!normalizedHost) return '';
    const parts = normalizedHost.split('.').filter(Boolean);
    if (parts.length <= 2) return normalizedHost;
    const tld = parts[parts.length - 1];
    const second = parts[parts.length - 2];
    if (tld.length === 2 && COMMON_SECOND_LEVEL_TLDS.has(second) && parts.length >= 3) {
        return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
}

function isCookieThirdPartyByActiveTabs(host) {
    const targetRd = getRegisterableDomain(host);
    if (!targetRd) return false;
    if (tabTopLevelRegisterableDomain.size === 0) return false;
    for (const topLevelRd of tabTopLevelRegisterableDomain.values()) {
        if (topLevelRd === targetRd) return false;
    }
    return true;
}

function isThirdPartyRequest(details) {
    const targetHost = safeHostname(details?.url);
    if (!targetHost) return false;
    const targetRd = getRegisterableDomain(targetHost);

    // Top-level navigations are first-party for the destination site.
    if (details?.resourceType === 'mainFrame') return false;

    if (details?.webContentsId != null) {
        const topLevelRd = tabTopLevelRegisterableDomain.get(details.webContentsId);
        if (topLevelRd) return targetRd !== topLevelRd;
    }

    // Fallback when top-level context is unavailable (Electron often omits initiator).
    const initiatorHost = safeHostname(details?.initiator);
    if (initiatorHost) {
        return getRegisterableDomain(initiatorHost) !== targetRd;
    }
    const referrerHost = safeHostname(details?.referrer);
    if (referrerHost) {
        return getRegisterableDomain(referrerHost) !== targetRd;
    }
    return false;
}

function shouldBlockStoredCookie(host, policyInput, context = {}) {
    return shouldBlockCookieForHost(host, policyInput, {
        isThirdParty: isCookieThirdPartyByActiveTabs(host),
        isStealthSession: !!context.isStealthSession,
    });
}

function shouldBlockCookies(details, targetSession) {
    const host = safeHostname(details?.url);
    if (!host) return false;

    const legacyBlocked = cookieBlocklist.has(host);
    const policy = getCookieConfigForSession(targetSession);
    if (shouldBlockCookieForHost(host, policy, {
        isThirdParty: isThirdPartyRequest(details),
        isStealthSession: !!(sessionPolicyContext.get(targetSession) || {}).isStealthSession,
    })) return true;
    if (legacyBlocked) return true;
    return false;
}

function shouldBlockCookieForHost(host, policyInput, context = {}) {
    const normalizedHost = normalizeHost(host);
    if (!normalizedHost) return false;
    const policy = policyInput?.blockRules ? policyInput : compileCookieConfig(policyInput);
    if (policy.blockRules.some((rule) => rule.regex.test(normalizedHost))) return true;
    if (policy.allowRules.some((rule) => rule.regex.test(normalizedHost))) return false;
    if (policy.sessionOnlyRules.some((rule) => rule.regex.test(normalizedHost))) return false;
    if (policy.globalPolicy === 'block_all') return true;
    if (policy.globalPolicy === 'block_third_party') return !!context.isThirdParty;
    return false;
}

function stripHeaderByName(headers, headerName) {
    let modified = false;
    for (const key of Object.keys(headers || {})) {
        if (key.toLowerCase() === headerName) {
            delete headers[key];
            modified = true;
        }
    }
    return modified;
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
    if (!targetSession) return;
    sessionPolicyContext.set(targetSession, {
        profileId: deps.profileId || null,
        isStealthSession: !!deps.isStealthSession,
        getCookieConfig: deps.getCookieConfig,
    });
    if (installedSessions.has(targetSession)) return;
    installedSessions.add(targetSession);

    const identity = getBrowserIdentity();

    targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
        let requestHeaders = details.requestHeaders ? { ...details.requestHeaders } : {};
        let strippedFrameworkHeaders = [];

        try {
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

            // Track embedded domains
            if (details.webContentsId != null) {
                const domain = safeHostname(details.url);
                if (details.resourceType === 'mainFrame') {
                    // Reset tracking for new page load
                    tabNetworkDomains.set(details.webContentsId, new Set([domain]));
                    const topLevelRd = getRegisterableDomain(domain);
                    if (topLevelRd) tabTopLevelRegisterableDomain.set(details.webContentsId, topLevelRd);
                } else if (domain) {
                    let domains = tabNetworkDomains.get(details.webContentsId);
                    if (!domains) {
                        domains = new Set();
                        tabNetworkDomains.set(details.webContentsId, domains);
                    }
                    domains.add(domain);
                }

                if (shouldBlockCookies(details, targetSession)) {
                    stripHeaderByName(requestHeaders, 'cookie');
                }
            }
        } catch (error) {
            deps.logPolicyError?.('onBeforeSendHeaders', error);
        }

        try {
            recordHeaderObservation(details.webContentsId, {
                timestamp: Date.now(),
                origin: safeOrigin(details.url),
                resourceType: details.resourceType,
                method: details.method,
                strippedFrameworkHeaders,
                outboundHeaders: pickIdentityHeaders(requestHeaders),
            });
        } catch (_) {
            /* diagnostics must never block network */
        }

        callback({ requestHeaders });
    });

    targetSession.webRequest.onBeforeRequest((details, callback) => {
        if (details.resourceType === deps.resourceTypeMainFrame && details.webContentsId != null) {
            const domain = safeHostname(details.url);
            const topLevelRd = getRegisterableDomain(domain);
            if (topLevelRd) tabTopLevelRegisterableDomain.set(details.webContentsId, topLevelRd);
        }

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
        const responseHeaders = { ...details.responseHeaders };
        let modified = false;

        try {
            if (details.webContentsId != null) {
                if (shouldBlockCookies(details, targetSession)) {
                    modified = stripHeaderByName(responseHeaders, 'set-cookie') || modified;
                }
            }
        } catch (error) {
            deps.logPolicyError?.('onHeadersReceived', error);
        }

        if (details.resourceType !== deps.resourceTypeMainFrame) {
            callback(modified ? { responseHeaders } : {});
            return;
        }
        try {
            const tabIdForHeaders = deps.webContentsIdToTabId.get(details.webContentsId);
            deps.recordCompatEvent(tabIdForHeaders, {
                type: 'main-frame-response',
                url: details.url,
                statusCode: details.statusCode,
                headers: deps.pickResponseHeadersForDiag(details.responseHeaders),
            });
        } catch (error) {
            deps.logPolicyError?.('onHeadersReceived:diagnostics', error);
        }
        callback(modified ? { responseHeaders } : {});
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

function getTabNetworkDomains(webContentsId) {
    if (webContentsId == null) return [];
    const domains = tabNetworkDomains.get(webContentsId);
    return domains ? Array.from(domains) : [];
}

function clearTabTopLevelRegisterableDomain(webContentsId) {
    if (webContentsId == null) return;
    tabTopLevelRegisterableDomain.delete(webContentsId);
    tabNetworkDomains.delete(webContentsId);
}

function getCookieBlocklist() {
    return Array.from(cookieBlocklist);
}

function addToCookieBlocklist(domain) {
    if (domain) cookieBlocklist.add(domain);
}

function removeFromCookieBlocklist(domain) {
    if (domain) cookieBlocklist.delete(domain);
}

module.exports = {
    installSessionPolicy,
    configureSession,
    applyIdentityToSessionSafe,
    getHeaderObservations,
    isSessionPolicyInstalled,
    getTabNetworkDomains,
    clearTabTopLevelRegisterableDomain,
    getRegisterableDomain,
    isCookieThirdPartyByActiveTabs,
    shouldBlockStoredCookie,
    getCookieBlocklist,
    addToCookieBlocklist,
    removeFromCookieBlocklist,
    normalizeCookieConfig,
    compileCookieConfig,
    patternToRegExp,
    cookiePatternMatchesHost,
    getCookieExceptionForHost,
    shouldBlockCookieForHost,
};
