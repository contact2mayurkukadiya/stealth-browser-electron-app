/**
 * Stable, uniform Chromium-based browser identity for InviSurf.
 *
 * One identity is applied at boot and kept constant for the process lifetime.
 * No per-domain UA switching or runtime Client Hints patching.
 */
const C = require('../src/constants/conditionStrings.cjs');

/** @type {{ userAgent: string, acceptLanguage: string, chromeVersion: string, chromeMajor: string } | null} */
let cachedIdentity = null;

/**
 * Build a Chrome-aligned User-Agent from the bundled Chromium version and host OS.
 * Strips Electron/framework tokens from the UA string.
 */
function buildBrowserIdentity() {
    const chromeVersion = process.versions.chrome || '120.0.0.0';
    const chromeMajor = String(chromeVersion).split('.')[0] || '120';
    const reducedVersion = `${chromeMajor}.0.0.0`;
    const acceptLanguage = 'en-US,en;q=0.9';

    const platform = process.platform;
    let userAgent;
    if (platform === C.PLATFORM.DARWIN) {
        userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${reducedVersion} Safari/537.36`;
    } else if (platform === C.PLATFORM.WIN32) {
        userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${reducedVersion} Safari/537.36`;
    } else {
        userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${reducedVersion} Safari/537.36`;
    }

    return {
        userAgent,
        acceptLanguage,
        chromeVersion,
        chromeMajor,
    };
}

function getBrowserIdentity() {
    if (!cachedIdentity) {
        cachedIdentity = buildBrowserIdentity();
    }
    return cachedIdentity;
}

/**
 * Apply command-line hardening and global UA fallback once at process start.
 * @param {import('electron').App} app
 */
function configureBrowserIdentity(app) {
    const identity = getBrowserIdentity();

    if (app?.commandLine) {
        app.commandLine.removeSwitch('enable-automation');
        app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
        app.commandLine.appendSwitch('disable-site-isolation-trials');
        app.commandLine.appendSwitch('lang', 'en-US,en');
    }

    if (app) {
        app.userAgentFallback = identity.userAgent;
    }

    return identity;
}

/**
 * Apply stable identity defaults to an Electron session partition.
 * @param {import('electron').Session} targetSession
 */
function applyIdentityToSession(targetSession, identity = getBrowserIdentity()) {
    if (!targetSession || typeof targetSession.setUserAgent !== 'function') return;
    targetSession.setUserAgent(identity.userAgent, identity.acceptLanguage);
}

/**
 * Apply stable identity to a WebContents instance.
 * @param {import('electron').WebContents} webContents
 */
function applyIdentityToWebContents(webContents, identity = getBrowserIdentity()) {
    if (!webContents || webContents.isDestroyed?.()) return;
    try {
        webContents.setUserAgent(identity.userAgent);
    } catch (_) {
        // WebContents may be mid-destruction.
    }
}

/**
 * Startup diagnostic log for identity and storage paths (no secrets).
 * @param {import('electron').App} app
 * @param {{ info?: Function }} appLogger
 */
function logStartupIdentity(app, appLogger) {
    const identity = getBrowserIdentity();
    appLogger?.info?.('browser-identity:startup', {
        appName: app?.name,
        userData: typeof app?.getPath === 'function' ? app.getPath('userData') : null,
        sessionData: typeof app?.getPath === 'function' ? app.getPath('sessionData') : null,
        userAgent: identity.userAgent,
        acceptLanguage: identity.acceptLanguage,
        chromiumVersion: identity.chromeVersion,
        electronVersion: process.versions.electron,
        isPackaged: app?.isPackaged,
    });
}

module.exports = {
    buildBrowserIdentity,
    getBrowserIdentity,
    configureBrowserIdentity,
    applyIdentityToSession,
    applyIdentityToWebContents,
    logStartupIdentity,
};
