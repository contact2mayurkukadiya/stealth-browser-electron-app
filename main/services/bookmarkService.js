
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const encryption = require('../../encryption');
const State = require('../state');

let bookmarksPath;

function getBookmarksPath(profileId) {
    const effectiveProfileId = profileId || State.defaultProfileId || 'default';
    const safeProfileId = String(effectiveProfileId).replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(app.getPath('userData'), `bookmarks-${safeProfileId}.json`);
}

function loadBookmarks(profileId) {
    try {
        const p = getBookmarksPath(profileId);
        if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && parsed.encrypted !== undefined) {
                const dec = encryption.decrypt(parsed);
                return dec ? JSON.parse(dec) : { bar: [] };
            }
            return parsed; // Fallback to legacy plaintext
        }
    } catch (e) {
        console.error('Failed to load bookmarks:', e);
    }
    return { bar: [] };
}

function saveBookmarks(profileId, data) {
    try {
        const payload = encryption.encrypt(JSON.stringify(data));
        fs.writeFileSync(getBookmarksPath(profileId), JSON.stringify(payload, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save bookmarks:', e);
    }
}

function broadcastBookmarks(profileId) {
    for (const context of State.windowContextsById.values()) {
        if (context.profileId !== profileId) continue;
        if (!context.window.webContents.isDestroyed()) {
            context.window.webContents.send('bookmarks:updated');
        }
    }
}

module.exports = {
    getBookmarksPath,
    loadBookmarks,
    saveBookmarks,
    broadcastBookmarks
};