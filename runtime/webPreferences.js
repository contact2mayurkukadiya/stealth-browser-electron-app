const path = require('path');
const DEFAULT_PRELOAD = path.join(__dirname, '..', 'preload.js');

function buildSecureWebPreferences(options = {}) {
    const {
        partition,
        preload = DEFAULT_PRELOAD,
        additional = {},
    } = options;

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
