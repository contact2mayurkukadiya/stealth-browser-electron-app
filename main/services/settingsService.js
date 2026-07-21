
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, nativeTheme } = require('electron');

const chromeTheme = require('../../src/theme/chromeTheme.cjs');
const C = require('../../src/constants/conditionStrings.cjs');
const { compileCookieConfig, normalizeCookieConfig } = require('../../runtime/sessionPolicy.js');

const State = require('../state');
const { SETTINGS_DEFAULTS, COOKIE_CONFIG_DEFAULTS } = require('../constants/defaults');
const { getWindowContextByEventSender, isViewWebContentsAlive } = require('../windows/windowContextUtils');

let settingsPath;
const defaultCompiledCookiePolicy = compileCookieConfig(COOKIE_CONFIG_DEFAULTS);

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
    return getWindowContextByEventSender(sender)?.profileId || State.defaultProfileId || null;
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
    State.cookiePolicyCacheByProfileId.set(safeProfileId, compileCookieConfig(config));
}

function getCachedCookieConfig(profileId) {
    const safeProfileId = normalizeProfileId(profileId);
    if (!safeProfileId) return defaultCompiledCookiePolicy;
    return State.cookiePolicyCacheByProfileId.get(safeProfileId) || defaultCompiledCookiePolicy;
}

function hydrateCookiePolicyCacheFromSettings(settings) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const byProfile = source.cookieConfigByProfile && typeof source.cookieConfigByProfile === 'object'
        ? source.cookieConfigByProfile
        : {};
    for (const [profileId, config] of Object.entries(byProfile)) {
        setCachedCookieConfig(profileId, config);
    }
    if (State.defaultProfileId) {
        setCachedCookieConfig(State.defaultProfileId, source.cookieConfig || COOKIE_CONFIG_DEFAULTS);
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
            const ctx = State.windowContextsById.get(win.id);
            win.setTitleBarOverlay(ctx?.stealthWindow ? stealthOverlayOptions : overlayOptions);
        } catch (_) {
            // Window uses a standard title bar (e.g. profile picker) — no overlay.
        }
    }
}

function ensureNativeThemeTitleBarListeners() {
    if (State.nativeThemeTitleBarListenersAttached || !nativeTheme || typeof nativeTheme.on !== 'function') return;
    State.nativeThemeTitleBarListenersAttached = true;
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
    for (const ctx of State.windowContextsById.values()) {
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
    for (const ctx of State.windowContextsById.values()) {
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

function saveSettings(data) {
    try {
        fs.writeFileSync(getSettingsPath(), JSON.stringify(data, null, 2), 'utf-8');
        hydrateCookiePolicyCacheFromSettings(data);
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
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

module.exports = {
    getSettingsPath,
    normalizeColorTheme,
    normalizeProfileId,
    getProfileIdForEventSender,
    resolveAuthorizedProfileIdForSender,
    normalizeCookieSettingsFields,
    setCachedCookieConfig,
    getCachedCookieConfig,
    hydrateCookiePolicyCacheFromSettings,
    colorThemeSettingToElectronSource,
    getTitleBarOverlayOptionsForNativeTheme,
    syncTitleBarOverlaysToNativeTheme,
    ensureNativeThemeTitleBarListeners,
    getChromeOverlayThemePatchForContext,
    sendChromeOverlayThemePatch,
    sendChromeShellMenuOverlayThemePatch,
    sendChromeOmniboxOverlayThemePatch,
    broadcastThemeApply,
    broadcastSettingsUpdate,
    applyColorThemeFromSettings,
    loadSettings,
    saveSettings,
    updateCookieConfigForProfile
};