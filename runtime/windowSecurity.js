/**
 * Window-level security: content protection, permission policy, navigation guards.
 */
const { buildSecureWebPreferences } = require('./webPreferences');

const DEBUG_SWITCHES = [
    'remote-debugging-port',
    'inspect',
    'inspect-brk',
    'remote-debugging-pipe',
    'enable-automation',
];

/**
 * Read current debug/automation switch presence (diagnostic only).
 * @param {import('electron').App} app
 */
function getProductionGuardStatus(app) {
    const switches = {};
    if (app?.commandLine && typeof app.commandLine.hasSwitch === 'function') {
        for (const name of DEBUG_SWITCHES) {
            switches[name] = app.commandLine.hasSwitch(name);
        }
    }
    return {
        isPackaged: !!app?.isPackaged,
        switches,
        remoteDebuggingActive: !!(switches['remote-debugging-port'] || switches['remote-debugging-pipe']),
        inspectorActive: !!(switches.inspect || switches['inspect-brk']),
    };
}

/**
 * Prevent packaged builds from exposing remote debugging ports by default.
 * @param {import('electron').App} app
 * @param {{ info?: Function }} appLogger
 */
function configureProductionGuards(app, appLogger) {
    const isPackaged = !!app?.isPackaged;
    const before = getProductionGuardStatus(app);

    if (isPackaged && app?.commandLine) {
        app.commandLine.removeSwitch('remote-debugging-port');
        app.commandLine.removeSwitch('inspect');
        app.commandLine.removeSwitch('inspect-brk');
        app.commandLine.removeSwitch('remote-debugging-pipe');
    }

    const after = getProductionGuardStatus(app);

    appLogger?.info?.('security:production-guards', {
        isPackaged,
        remoteDebuggingStripped: isPackaged,
        automationSwitchRemoved: true,
        before,
        after,
    });
}

/**
 * @param {import('electron').BrowserWindow} browserWindow
 * @param {boolean} enabled
 */
function applyContentProtection(browserWindow, enabled = true) {
    if (!browserWindow || browserWindow.isDestroyed?.()) return;
    try {
        browserWindow.setContentProtection(!!enabled);
    } catch (_) {
        // Some platforms may reject content protection in edge cases.
    }
}

/**
 * Standard shell window hardening for the React chrome UI.
 * @param {import('electron').BrowserWindow} window
 * @param {{ permissionFullscreen: string }} options
 */
function applyShellWindowSecurity(window, { permissionFullscreen }) {
    if (!window || window.isDestroyed?.()) return;

    window.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
        if (permission === permissionFullscreen) return callback(true);
        callback(false);
    });

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    window.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('app://')) {
            event.preventDefault();
        }
    });

    window.webContents.on('will-attach-webview', (event) => {
        event.preventDefault();
    });
}

/**
 * Profile picker window: content protection + minimal navigation guard.
 * @param {import('electron').BrowserWindow} picker
 * @param {boolean} contentProtectionEnabled
 */
function applyProfilePickerSecurity(picker, contentProtectionEnabled) {
    if (!picker || picker.isDestroyed?.()) return;

    applyContentProtection(picker, contentProtectionEnabled);

    picker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    picker.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('app://')) {
            event.preventDefault();
        }
    });
}

module.exports = {
    buildSecureWebPreferences,
    configureProductionGuards,
    getProductionGuardStatus,
    applyContentProtection,
    applyShellWindowSecurity,
    applyProfilePickerSecurity,
};
