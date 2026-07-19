/**
 * InviSurf application path isolation.
 *
 * Must run before app.ready and before any code reads app.getPath('userData').
 * Keeps all Electron storage under an InviSurf-owned directory tree instead of
 * colliding with Google Chrome or other applications.
 */
const path = require('path');

const APP_DISPLAY_NAME = 'InviSurf';

/**
 * Root directory for all InviSurf-owned persistent data on this machine.
 * macOS:   ~/Library/Application Support/InviSurf
 * Windows: %APPDATA%/InviSurf
 * Linux:   ~/.config/InviSurf (via Electron appData)
 */
function resolveInviSurfRootDir(app) {
    const appData = app.getPath('appData');
    return path.join(appData, APP_DISPLAY_NAME);
}

/**
 * Configure Electron path overrides and application branding.
 * @param {import('electron').App} app
 * @returns {{ rootDir: string, userData: string, sessionData: string, logs: string, crashDumps: string }}
 */
function configureAppPaths(app) {
    if (!app) {
        throw new Error('configureAppPaths requires Electron app');
    }

    app.name = APP_DISPLAY_NAME;

    const rootDir = resolveInviSurfRootDir(app);
    const userData = path.join(rootDir, 'User Data');
    const sessionData = path.join(rootDir, 'Session Data');
    const logs = path.join(rootDir, 'Logs');
    const crashDumps = path.join(rootDir, 'Crashpad');

    app.setPath('userData', userData);
    app.setPath('sessionData', sessionData);
    app.setPath('logs', logs);

    try {
        app.setPath('crashDumps', crashDumps);
    } catch {
        // crashDumps path may be unavailable on some Electron builds/platforms.
    }

    return { rootDir, userData, sessionData, logs, crashDumps };
}

module.exports = {
    APP_DISPLAY_NAME,
    configureAppPaths,
    resolveInviSurfRootDir,
};
