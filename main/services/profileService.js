
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const encryption = require('../../encryption');
const State = require('../state');
const { MAX_PROFILE_AVATAR_BYTES, PRESET_AVATAR_PNG_DIR } = require('../constants/defaults');

let profilesPath;
function getProfilesPath() {
    if (!profilesPath) {
        profilesPath = path.join(app.getPath('userData'), 'profiles.json');
    }
    return profilesPath;
}

function getProfileAvatarsDir() {
    const dir = path.join(app.getPath('userData'), 'profile-avatars');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function loadProfiles() {
    try {
        const p = getProfilesPath();
        if (!fs.existsSync(p)) return [];
        const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const decoded = (parsed && parsed.encrypted !== undefined)
            ? (() => {
                const dec = encryption.decrypt(parsed);
                return dec ? JSON.parse(dec) : null;
            })()
            : parsed;
        return Array.isArray(decoded) ? decoded : [];
    } catch {
        return [];
    }
}

function saveProfiles() {
    try {
        const data = Array.from(State.profilesById.values());
        const payload = encryption.encrypt(JSON.stringify(data));
        fs.writeFileSync(getProfilesPath(), JSON.stringify(payload, null, 2), 'utf-8');
    } catch (error) {
        console.error('Failed to save profiles:', error);
    }
}

function ensureProfile(profileId, displayName = null) {
    const safeProfileId = String(profileId || '').trim().replace(/[^a-zA-Z0-9-_]/g, '_');
    if (!safeProfileId) return null;
    if (!State.profilesById.has(safeProfileId)) {
        State.profilesById.set(safeProfileId, {
            profileId: safeProfileId,
            displayName: displayName || `Profile ${State.profilesById.size + 1}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            hasCustomAvatar: false,
            avatarExt: null,
            avatarSource: null,
        });
    }
    if (!State.defaultProfileId) State.defaultProfileId = safeProfileId;
    return State.profilesById.get(safeProfileId);
}

function safeProfileIdForPath(profileId) {
    return String(profileId || '').trim().replace(/[^a-zA-Z0-9-_]/g, '_');
}

function avatarFilePath(profileId, ext) {
    return path.join(getProfileAvatarsDir(), `${safeProfileIdForPath(profileId)}.${ext}`);
}

function removeAvatarFilesForProfile(profileId) {
    const safeId = safeProfileIdForPath(profileId);
    const dir = path.join(app.getPath('userData'), 'profile-avatars');
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
        if (name === `${safeId}.png` || name === `${safeId}.jpeg` || name === `${safeId}.jpg` || name === `${safeId}.webp` || name === `${safeId}.gif`) {
            try {
                fs.unlinkSync(path.join(dir, name));
            } catch (_) {
                /* ignore */
            }
        }
    }
}

/** Shared rules for profile photo uploads (used by validate IPC and save). */
function validateAvatarDataUrl(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        return { ok: false, error: 'Invalid image' };
    }
    const comma = dataUrl.indexOf(',');
    if (comma < 12) return { ok: false, error: 'Invalid image' };
    const header = dataUrl.slice(0, comma);
    const b64 = dataUrl.slice(comma + 1).replace(/\s/g, '');
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64$/i.test(header)) {
        return {
            ok: false,
            error: 'Unsupported format. Use PNG, JPEG, WebP, or GIF.',
        };
    }
    let buf;
    try {
        buf = Buffer.from(b64, 'base64');
    } catch {
        return { ok: false, error: 'Invalid image data' };
    }
    if (!buf.length || buf.length > MAX_PROFILE_AVATAR_BYTES) {
        return {
            ok: false,
            error: `Image too large (max ${Math.round(MAX_PROFILE_AVATAR_BYTES / 1024)} KB).`,
        };
    }
    return { ok: true, header, buf };
}

function setProfileAvatarFromDataUrl(profileId, dataUrl) {
    const p = State.profilesById.get(safeProfileIdForPath(profileId));
    if (!p) return { ok: false, error: 'Profile not found' };
    const check = validateAvatarDataUrl(dataUrl);
    if (!check.ok) return check;
    const { header, buf } = check;
    let ext = 'png';
    if (/image\/jpe?g/i.test(header)) ext = 'jpeg';
    else if (/image\/webp/i.test(header)) ext = 'webp';
    else if (/image\/gif/i.test(header)) ext = 'gif';
    removeAvatarFilesForProfile(profileId);
    const dest = avatarFilePath(profileId, ext === 'jpeg' ? 'jpeg' : ext);
    fs.writeFileSync(dest, buf);
    p.hasCustomAvatar = true;
    p.avatarExt = ext;
    p.avatarSource = 'upload';
    p.updatedAt = Date.now();
    saveProfiles();
    return { ok: true, profile: p };
}

function setProfileAvatarFromPresetPngFile(profileId, fileName) {
    const p = State.profilesById.get(safeProfileIdForPath(profileId));
    if (!p) return { ok: false, error: 'Profile not found' };
    if (typeof fileName !== 'string' || !/^\d+\.png$/i.test(fileName)) {
        return { ok: false, error: 'Invalid preset' };
    }
    const safeName = path.basename(fileName);
    const resolvedDir = path.resolve(PRESET_AVATAR_PNG_DIR);
    const srcPath = path.join(resolvedDir, safeName);
    const resolvedSrc = path.resolve(srcPath);
    if (resolvedSrc !== resolvedDir && !resolvedSrc.startsWith(resolvedDir + path.sep)) {
        return { ok: false, error: 'Invalid preset' };
    }
    let buf;
    try {
        buf = fs.readFileSync(resolvedSrc);
    } catch {
        return { ok: false, error: 'Preset file not found' };
    }
    if (!buf.length || buf.length > MAX_PROFILE_AVATAR_BYTES) {
        return {
            ok: false,
            error: `Image too large (max ${Math.round(MAX_PROFILE_AVATAR_BYTES / 1024)} KB).`,
        };
    }
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
        return { ok: false, error: 'Invalid image' };
    }
    removeAvatarFilesForProfile(profileId);
    const dest = avatarFilePath(profileId, 'png');
    fs.writeFileSync(dest, buf);
    p.hasCustomAvatar = true;
    p.avatarExt = 'png';
    p.avatarSource = 'preset';
    p.updatedAt = Date.now();
    saveProfiles();
    return { ok: true, profile: p };
}

function getProfileAvatarDataUrl(profileId) {
    const safeId = safeProfileIdForPath(profileId);
    const p = State.profilesById.get(safeId);
    if (!p || !p.hasCustomAvatar || !p.avatarExt) return null;
    const fp = avatarFilePath(profileId, p.avatarExt);
    if (!fs.existsSync(fp)) return null;
    let buf;
    try {
        buf = fs.readFileSync(fp);
    } catch {
        return null;
    }
    const mime = p.avatarExt === 'jpeg' ? 'image/jpeg' : `image/${p.avatarExt}`;
    return `data:${mime};base64,${buf.toString('base64')}`;
}

module.exports = {
    getProfilesPath,
    getProfileAvatarsDir,
    loadProfiles,
    saveProfiles,
    ensureProfile,
    safeProfileIdForPath,
    avatarFilePath,
    removeAvatarFilesForProfile,
    validateAvatarDataUrl,
    setProfileAvatarFromDataUrl,
    setProfileAvatarFromPresetPngFile,
    getProfileAvatarDataUrl
};
