
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

function findFolderNode(nodes, folderId) {
    if (!Array.isArray(nodes)) return null;
    for (const node of nodes) {
        if (!node) continue;
        if (String(node.id) === String(folderId)) return node;
        if (Array.isArray(node.children) && node.children.length > 0) {
            const found = findFolderNode(node.children, folderId);
            if (found) return found;
        }
    }
    return null;
}

function getFolderItems(profileId, folderId = '1', limit = 50, cursor = null) {
    const data = loadBookmarks(profileId);
    let items = [];
    const fid = String(folderId || '1');
    if (fid === '1') {
        items = data.bar || [];
    } else if (fid === '2') {
        items = data.other || [];
    } else if (fid === '3') {
        items = data.mobile || [];
    } else {
        const allRoots = [...(data.bar || []), ...(data.other || []), ...(data.mobile || [])];
        const folder = findFolderNode(allRoots, fid);
        items = folder?.children || [];
    }

    const startIndex = cursor != null ? Math.max(0, Number(cursor) || 0) : 0;
    const pageSize = Math.max(1, Number(limit) || 50);
    const paginated = items.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < items.length;
    const nextCursor = hasMore ? startIndex + pageSize : null;

    return {
        items: paginated,
        hasMore,
        nextCursor,
    };
}

function searchBookmarks(profileId, query = '', limit = 50, cursor = null) {
    const data = loadBookmarks(profileId);
    const q = (query || '').toLowerCase().trim();
    if (!q) {
        return getFolderItems(profileId, '1', limit, cursor);
    }

    const results = [];
    function collectMatches(nodes) {
        if (!Array.isArray(nodes)) return;
        for (const node of nodes) {
            if (!node) continue;
            const titleMatch = (node.title || '').toLowerCase().includes(q);
            const urlMatch = (node.url || '').toLowerCase().includes(q);
            if (titleMatch || urlMatch) {
                results.push(node);
            }
            if (Array.isArray(node.children) && node.children.length > 0) {
                collectMatches(node.children);
            }
        }
    }

    collectMatches([...(data.bar || []), ...(data.other || []), ...(data.mobile || [])]);

    const startIndex = cursor != null ? Math.max(0, Number(cursor) || 0) : 0;
    const pageSize = Math.max(1, Number(limit) || 50);
    const paginated = results.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < results.length;
    const nextCursor = hasMore ? startIndex + pageSize : null;

    return {
        items: paginated,
        hasMore,
        nextCursor,
    };
}

function deleteBookmarks(profileId, ids = []) {
    const idList = Array.isArray(ids) ? ids : [ids];
    if (idList.length === 0) return false;
    const deleteSet = new Set(idList.map(String));
    const data = loadBookmarks(profileId);

    function filterTree(list) {
        if (!Array.isArray(list)) return [];
        return list.filter((item) => {
            if (!item) return false;
            if (deleteSet.has(String(item.id))) return false;
            if (Array.isArray(item.children) && item.children.length > 0) {
                item.children = filterTree(item.children);
            }
            return true;
        });
    }

    data.bar = filterTree(data.bar);
    if (data.other) data.other = filterTree(data.other);
    if (data.mobile) data.mobile = filterTree(data.mobile);

    saveBookmarks(profileId, data);
    broadcastBookmarks(profileId);
    return true;
}

function updateBookmark(profileId, payload = {}) {
    const { id, title, url } = payload;
    if (!id) return false;
    const data = loadBookmarks(profileId);

    function updateInList(list) {
        if (!Array.isArray(list)) return false;
        for (const item of list) {
            if (!item) continue;
            if (String(item.id) === String(id)) {
                if (typeof title === 'string') item.title = title;
                if (typeof url === 'string' && item.url !== undefined) item.url = url;
                return true;
            }
            if (Array.isArray(item.children) && item.children.length > 0) {
                if (updateInList(item.children)) return true;
            }
        }
        return false;
    }

    const updated = updateInList(data.bar) || (data.other && updateInList(data.other)) || (data.mobile && updateInList(data.mobile));
    if (updated) {
        saveBookmarks(profileId, data);
        broadcastBookmarks(profileId);
        return true;
    }
    return false;
}

module.exports = {
    getBookmarksPath,
    loadBookmarks,
    saveBookmarks,
    broadcastBookmarks,
    getFolderItems,
    searchBookmarks,
    deleteBookmarks,
    updateBookmark,
};