
const { session } = require('electron');
const path = require('path');
const State = require('../state');
const {
    normalizeProfileId,
    resolveAuthorizedProfileIdForSender,
    getCachedCookieConfig,
    loadSettings
} = require('./settingsService');
const {
    cookiePatternMatchesHost,
    shouldBlockStoredCookie,
    addToCookieBlocklist
} = require('../../runtime/sessionPolicy');

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
    let map = State.cookieModifiedAtBySession.get(targetSession);
    if (!map) {
        map = new Map();
        State.cookieModifiedAtBySession.set(targetSession, map);
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
    if (!targetSession?.cookies || State.cookieStoreGuardedSessions.has(targetSession)) return;
    State.cookieStoreGuardedSessions.add(targetSession);

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
                if (State.appLogger) {
                    State.appLogger.warn('cookies:store-guard-remove-failed', {
                        domain: cookieDomainToHost(cookie.domain),
                        name: cookie.name,
                        error: State.appLogger.serializeError(error),
                    });
                }
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
    const stealthContexts = Array.from(State.windowContextsById.values()).filter((ctx) => ctx?.stealthWindow);
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
    for (const ctx of State.windowContextsById.values()) {
        if (ctx?.profileId) profileIds.add(ctx.profileId);
    }
    if (State.defaultProfileId) profileIds.add(State.defaultProfileId);
    for (const profile of State.profilesById.values()) {
        if (profile?.profileId) profileIds.add(profile.profileId);
    }
    const results = await Promise.all(Array.from(profileIds).map((profileId) => cleanupSessionOnlyCookiesForProfile(profileId)));
    return results.reduce((sum, count) => sum + count, 0);
}

module.exports = {
    getProfilePartition,
    getProfileSession,
    getProfileSessionForSender,
    cookieDomainToHost,
    cookieMatchesDomain,
    cookieUrlForRemoval,
    cookieStoreKey,
    getCookieModifiedAtMap,
    getCookieModifiedAt,
    forgetCookieModifiedAt,
    normalizeSinceTimestamp,
    isCookieBlockedByStoredPolicy,
    installCookieStoreGuard,
    removeCookiesMatching,
    removeCookiesModifiedSince,
    cleanupBlockedCookiesForProfile,
    cleanupStealthCookiesForContext,
    cleanupStealthCookiesForAllContexts,
    getCookieSummaryForSession,
    cleanupSessionOnlyCookiesForProfile,
    cleanupSessionOnlyCookiesForAllProfiles,
    addToCookieBlocklist
};