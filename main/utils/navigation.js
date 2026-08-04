const path = require('path');
const State = require('../state');
const C = require('../../src/constants/conditionStrings.cjs');
const {
    TRACKING_REDIRECT_HOST_MARKERS,
    CANONICAL_NTP_HTML,
    SEARCH_ENGINES
} = require('../constants/defaults');

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

function isAllowedTabNavigationUrl(targetUrl) {
    if (!targetUrl || typeof targetUrl !== 'string') return false;
    return targetUrl.startsWith(C.URL.SCHEME_HTTPS) ||
        targetUrl.startsWith(C.URL.SCHEME_HTTP) ||
        targetUrl.startsWith(C.URL.SCHEME_APP) ||
        targetUrl.startsWith(C.URL.SCHEME_VIEW_SOURCE);
}

/**
 * Canonical form for internal pseudo-URLs (omnibox + session). Legacy \`stealth://\`
 * URLs are still accepted and treated the same as \`invisurf://\`.
 */
function normalizeInternalSchemeUrl(displayUrl) {
    if (!displayUrl || typeof displayUrl !== 'string') return '';
    const t = displayUrl.trim().toLowerCase();
    if (t === C.URL.STEALTH_HISTORY || t === C.URL.HISTORY_DISPLAY) return C.URL.HISTORY_DISPLAY;
    if (t === C.URL.STEALTH_BOOKMARK || t === C.URL.BOOKMARK_DISPLAY) return C.URL.BOOKMARK_DISPLAY;
    if (t === C.URL.STEALTH_SETTINGS || t === C.URL.SETTINGS_DISPLAY) return C.URL.SETTINGS_DISPLAY;
    return displayUrl.trim();
}

function resolveInternalPageUrl(rawUrl) {
    if (rawUrl == null || typeof rawUrl !== 'string') return '';
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    const normalizedUrl = trimmed.toLowerCase();
    if (normalizedUrl === C.URL.STEALTH_HISTORY || normalizedUrl === C.URL.HISTORY_DISPLAY) return C.URL.HISTORY_LOAD;
    if (normalizedUrl === C.URL.STEALTH_BOOKMARK || normalizedUrl === C.URL.BOOKMARK_DISPLAY) return C.URL.BOOKMARK_LOAD;
    if (normalizedUrl === C.URL.STEALTH_SETTINGS || normalizedUrl === C.URL.SETTINGS_DISPLAY) return C.URL.SETTINGS_LOAD;
    if (normalizedUrl === C.URL.NTP_DISPLAY) return CANONICAL_NTP_HTML;
    return trimmed;
}

/** Always returns a non-empty loadable URL for tab WebContents (never \`loadURL('')\`). */
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

function toDisplayUrl(rawUrl) {
    if (!rawUrl) return '';
    if (rawUrl.startsWith(C.URL.SCHEME_APP) && rawUrl.includes(C.URL.FRAGMENT_HISTORY)) return C.URL.HISTORY_DISPLAY;
    if (rawUrl.startsWith(C.URL.SCHEME_APP) && rawUrl.includes(C.URL.FRAGMENT_BOOKMARK)) return C.URL.BOOKMARK_DISPLAY;
    if (rawUrl.startsWith(C.URL.SCHEME_APP) && rawUrl.includes(C.URL.FRAGMENT_SETTINGS)) return C.URL.SETTINGS_DISPLAY;
    if (rawUrl.startsWith(C.URL.SCHEME_APP) && rawUrl.includes(C.URL.FRAGMENT_NEWTAB)) return '';
    return rawUrl;
}

function canStoreRecentlyClosedUrl(rawUrl) {
    const displayUrl = toDisplayUrl(rawUrl);
    const resolvedUrl = resolveInternalPageUrl(displayUrl);
    if (!resolvedUrl || resolvedUrl.startsWith(C.URL.SCHEME_DATA)) return false;
    return isAllowedTabNavigationUrl(resolvedUrl);
}

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

/**
 * Returns true for any internal browser page (history, settings, NTP, etc.) that
 * should never be recorded in browsing history.
 */
function isInternalPageUrl(url) {
    if (!url) return false;
    const ul = url.toLowerCase();
    if (ul.startsWith(C.URL.SCHEME_STEALTH) || ul.startsWith(C.URL.SCHEME_INVISURF)) return true;
    if (url.startsWith(C.URL.SCHEME_APP) && url.includes(C.URL.PATH_HISTORY_HTML)) return true;
    if (url.startsWith(C.URL.SCHEME_APP) && url.includes(C.URL.PATH_BOOKMARK_HTML)) return true;
    if (url.startsWith(C.URL.SCHEME_APP) && url.includes(C.URL.PATH_SETTINGS_HTML)) return true;
    if (url.startsWith(C.URL.SCHEME_APP) && url.includes(C.URL.FRAGMENT_NEWTAB)) return true;
    return false;
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

/**
 * Builds a search URL for the given engine key and query string.
 * Falls back to Google if the engine key is unrecognised.
 */
function buildSearchUrl(engine, query) {
    const base = SEARCH_ENGINES[engine] || SEARCH_ENGINES.google;
    return base + encodeURIComponent(query);
}

function markNextNavigationTransition(tabId, source) {
    if (!tabId) return;
    State.pendingTransitionsByTab.set(String(tabId), transitionFromNavigationSource(source));
}

function consumeNextNavigationTransition(tabId) {
    if (!tabId) return C.HISTORY_TRANSITION.LINK;
    const key = String(tabId);
    const transition = State.pendingTransitionsByTab.get(key) || C.HISTORY_TRANSITION.LINK;
    State.pendingTransitionsByTab.delete(key);
    return transition;
}

module.exports = {
    getHostnameSafe,
    isLikelyTrackingRedirectUrl,
    classifyNavigationError,
    buildRedirectBlockedPage,
    isAllowedTabNavigationUrl,
    normalizeInternalSchemeUrl,
    resolveInternalPageUrl,
    resolveTabLoadUrl,
    isBlankTab,
    shouldReassertOmniboxAfterPageLoad,
    isCustomNewTabDocumentUrl,
    isGoogleLensSearchableUrl,
    toDisplayUrl,
    canStoreRecentlyClosedUrl,
    transitionFromNavigationSource,
    isInternalPageUrl,
    isGoogleLensSidebarUrl,
    buildSearchUrl,
    markNextNavigationTransition,
    consumeNextNavigationTransition
};