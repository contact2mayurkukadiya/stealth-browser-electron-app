/**
 * Shared secure webPreferences for every BrowserWindow and WebContentsView.
 *
 * Websites must not receive Node, remote, or main-process APIs directly.
 * Internal UI uses preload.js behind contextIsolation + sandbox.
 */
const path = require('path');

const DEFAULT_PRELOAD = path.join(__dirname, '..', 'preload.js');

/**
 * @param {{ partition?: string | null, preload?: string, additional?: Record<string, unknown> }} [options]
 * @returns {import('electron').WebPreferences}
 */
function buildSecureWebPreferences(options = {}) {
    const {
        partition,
        preload = DEFAULT_PRELOAD,
        additional = {},
    } = options;

    /** @type {import('electron').WebPreferences} */
    const prefs = {
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        sandbox: true,
        nodeIntegrationInSubFrames: false,
        preload,
        ...additional,
    };

    if (partition !== undefined && partition !== null) {
        prefs.partition = partition;
    }

    return prefs;
}

module.exports = {
    DEFAULT_PRELOAD,
    buildSecureWebPreferences,
};
