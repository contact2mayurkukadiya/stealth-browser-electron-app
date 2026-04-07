/**
 * In-memory ring buffers for compatibility diagnostics (support / troubleshooting).
 * Not a security or fingerprinting facility — only structured navigation/network notes.
 */

const MAX_EVENTS_PER_TAB = 100;

/** @type {Map<string, object[]>} */
const buffersByTabId = new Map();

function push(tabId, entry) {
    if (!tabId) return;
    let buffer = buffersByTabId.get(tabId);
    if (!buffer) {
        buffer = [];
        buffersByTabId.set(tabId, buffer);
    }
    buffer.push(entry);
    while (buffer.length > MAX_EVENTS_PER_TAB) buffer.shift();
}

/**
 * @param {string} [tabId] - If omitted, returns events grouped by tab id.
 */
function getReport(tabId) {
    const environment = {
        platform: process.platform,
        chrome: process.versions.chrome,
        electron: process.versions.electron,
        node: process.versions.node,
    };
    const generatedAt = Date.now();
    if (tabId) {
        return {
            generatedAt,
            tabId,
            environment,
            events: buffersByTabId.get(tabId) ? [...buffersByTabId.get(tabId)] : [],
        };
    }
    const tabs = {};
    for (const [id, events] of buffersByTabId) {
        tabs[id] = [...events];
    }
    return { generatedAt, environment, tabs };
}

/**
 * @param {string} [tabId] - If omitted, clears all tab buffers.
 */
function clear(tabId) {
    if (tabId) buffersByTabId.delete(tabId);
    else buffersByTabId.clear();
}

module.exports = {
    push,
    getReport,
    clear,
    MAX_EVENTS_PER_TAB,
};
