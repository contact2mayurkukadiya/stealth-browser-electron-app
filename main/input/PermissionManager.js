/**
 * macOS accessibility permission helpers for global keyboard monitoring.
 */
const { getNativeModule } = require('../ghostWindow/GhostWindowController');

function getPermissionStatus() {
    const native = getNativeModule();
    if (!native) {
        return {
            supported: false,
            granted: false,
            platform: process.platform,
        };
    }

    let granted = false;
    try {
        granted = !!native.getKeyboardMonitorPermissionGranted?.();
    } catch (_) { /* ignore */ }

    return {
        supported: true,
        granted,
        platform: process.platform,
        requiresPrompt: process.platform === 'darwin' && !granted,
    };
}

function requestPermission() {
    const native = getNativeModule();
    if (!native || typeof native.requestKeyboardMonitorPermission !== 'function') {
        return { ok: false, granted: false };
    }

    let granted = false;
    try {
        granted = !!native.requestKeyboardMonitorPermission();
    } catch (_) { /* ignore */ }

    return { ok: granted, granted };
}

module.exports = {
    getPermissionStatus,
    requestPermission,
};
