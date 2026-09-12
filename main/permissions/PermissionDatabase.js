'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { normalizeOrigin, isValidPermission, isValidState } = require('./types');

function getDefaultStoragePath() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'permissions.json');
    }
  } catch (_) {}
  return path.join(process.cwd(), 'permissions.json');
}

/**
 * Enterprise-Grade PermissionDatabase
 * 
 * Provides high-performance in-memory caching with atomic disk persistence.
 * Supports persistent profiles and strictly in-memory storage for incognito/stealth profiles.
 */
class PermissionDatabase {
  /**
   * @param {Object} options
   * @param {string} [options.storagePath] Custom storage path (defaults to userData/permissions.json)
   */
  constructor(options = {}) {
    this.storagePath = options.storagePath || getDefaultStoragePath();
    // Map<profileId, Map<origin, Map<permissionName, { state, lastUpdated }>>>
    this.persistentData = new Map();
    // Ephemeral Map<profileId, Map<origin, Map<permissionName, { state, lastUpdated }>>>
    this.ephemeralData = new Map();
    // Set of profile IDs marked as ephemeral / incognito
    this.ephemeralProfiles = new Set();
    this.saveTimer = null;
    this.isDirty = false;

    this.loadFromDisk();
  }

  /**
   * Registers a profile as incognito/ephemeral. Permissions for this profile
   * are kept strictly in-memory and discarded upon teardown.
   * @param {string} profileId
   */
  registerEphemeralProfile(profileId) {
    if (!profileId) return;
    this.ephemeralProfiles.add(profileId);
    if (!this.ephemeralData.has(profileId)) {
      this.ephemeralData.set(profileId, new Map());
    }
  }

  /**
   * Unregisters and clears all ephemeral permissions for a profile.
   * @param {string} profileId
   */
  unregisterEphemeralProfile(profileId) {
    if (!profileId) return;
    this.ephemeralProfiles.delete(profileId);
    this.ephemeralData.delete(profileId);
  }

  /**
   * Loads persisted permissions from disk synchronously during initialization.
   */
  loadFromDisk() {
    try {
      if (!fs.existsSync(this.storagePath)) return;
      const raw = fs.readFileSync(this.storagePath, 'utf-8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw);

      if (parsed && typeof parsed === 'object') {
        for (const [profileId, origins] of Object.entries(parsed)) {
          if (!origins || typeof origins !== 'object') continue;
          const profileMap = new Map();
          for (const [origin, perms] of Object.entries(origins)) {
            const normOrigin = normalizeOrigin(origin);
            if (!normOrigin || !perms || typeof perms !== 'object') continue;
            const permsMap = new Map();
            for (const [permName, record] of Object.entries(perms)) {
              if (isValidPermission(permName) && record && isValidState(record.state)) {
                permsMap.set(permName, {
                  state: record.state,
                  lastUpdated: typeof record.lastUpdated === 'number' ? record.lastUpdated : Date.now(),
                });
              }
            }
            if (permsMap.size > 0) {
              profileMap.set(normOrigin, permsMap);
            }
          }
          if (profileMap.size > 0) {
            this.persistentData.set(profileId, profileMap);
          }
        }
      }
    } catch (err) {
      console.error('[PermissionDatabase] Failed to load permissions from disk:', err);
    }
  }

  /**
   * Debounced atomic write to disk.
   */
  scheduleSave() {
    if (this.saveTimer) return;
    this.isDirty = true;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushToDisk();
    }, 500);
  }

  /**
   * Immediately flushes persistent data to disk.
   */
  flushToDisk() {
    if (!this.isDirty) return;
    this.isDirty = false;
    try {
      const serialized = {};
      for (const [profileId, originsMap] of this.persistentData.entries()) {
        const profileObj = {};
        for (const [origin, permsMap] of originsMap.entries()) {
          const permsObj = {};
          for (const [permName, record] of permsMap.entries()) {
            permsObj[permName] = record;
          }
          profileObj[origin] = permsObj;
        }
        serialized[profileId] = profileObj;
      }

      const tempPath = `${this.storagePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(serialized, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.storagePath);
    } catch (err) {
      console.error('[PermissionDatabase] Failed to flush permissions to disk:', err);
    }
  }

  /**
   * Cancels any pending save timer.
   */
  destroy() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /**
   * Resolves the active data store (ephemeral vs persistent) for the profile.
   * @private
   */
  _getStoreForProfile(profileId, createIfMissing = false) {
    const safeProfileId = String(profileId || 'default');
    const isEphemeral = this.ephemeralProfiles.has(safeProfileId);
    const store = isEphemeral ? this.ephemeralData : this.persistentData;

    if (!store.has(safeProfileId)) {
      if (createIfMissing) {
        store.set(safeProfileId, new Map());
      } else {
        return null;
      }
    }
    return store.get(safeProfileId);
  }

  /**
   * Retrieves a permission state for an origin under a profile.
   * @param {string} profileId
   * @param {string} rawOrigin
   * @param {string} permName
   * @returns {import('./types').PermissionState | null}
   */
  get(profileId, rawOrigin, permName) {
    const origin = normalizeOrigin(rawOrigin);
    if (!origin || !isValidPermission(permName)) return null;

    const profileStore = this._getStoreForProfile(profileId, false);
    if (!profileStore) return null;

    const originStore = profileStore.get(origin);
    if (!originStore) return null;

    const record = originStore.get(permName);
    return record ? record.state : null;
  }

  /**
   * Sets a permission decision for an origin.
   * @param {string} profileId
   * @param {string} rawOrigin
   * @param {string} permName
   * @param {import('./types').PermissionState} state
   */
  set(profileId, rawOrigin, permName, state) {
    const origin = normalizeOrigin(rawOrigin);
    if (!origin || !isValidPermission(permName) || !isValidState(state)) return;

    const safeProfileId = String(profileId || 'default');
    const isEphemeral = this.ephemeralProfiles.has(safeProfileId);
    const profileStore = this._getStoreForProfile(safeProfileId, true);

    if (!profileStore.has(origin)) {
      profileStore.set(origin, new Map());
    }

    const originStore = profileStore.get(origin);
    originStore.set(permName, {
      state,
      lastUpdated: Date.now(),
    });

    if (!isEphemeral) {
      this.scheduleSave();
    }
  }

  /**
   * Gets all permissions recorded for an origin.
   * @param {string} profileId
   * @param {string} rawOrigin
   * @returns {Record<string, { state: string, lastUpdated: number }>}
   */
  getAllForOrigin(profileId, rawOrigin) {
    const origin = normalizeOrigin(rawOrigin);
    if (!origin) return {};

    const profileStore = this._getStoreForProfile(profileId, false);
    if (!profileStore) return {};

    const originStore = profileStore.get(origin);
    if (!originStore) return {};

    const result = {};
    for (const [perm, record] of originStore.entries()) {
      result[perm] = { ...record };
    }
    return result;
  }

  /**
   * Gets all recorded permissions across all origins for a profile.
   * @param {string} profileId
   * @returns {Array<{ origin: string, permissions: Record<string, { state: string, lastUpdated: number }> }>}
   */
  getAll(profileId) {
    const profileStore = this._getStoreForProfile(profileId, false);
    if (!profileStore) return [];

    const result = [];
    for (const [origin, permsMap] of profileStore.entries()) {
      const permissions = {};
      for (const [perm, record] of permsMap.entries()) {
        permissions[perm] = { ...record };
      }
      result.push({ origin, permissions });
    }
    return result;
  }

  /**
   * Deletes a specific permission for an origin.
   * @param {string} profileId
   * @param {string} rawOrigin
   * @param {string} permName
   * @returns {boolean}
   */
  delete(profileId, rawOrigin, permName) {
    const origin = normalizeOrigin(rawOrigin);
    if (!origin || !isValidPermission(permName)) return false;

    const safeProfileId = String(profileId || 'default');
    const isEphemeral = this.ephemeralProfiles.has(safeProfileId);
    const profileStore = this._getStoreForProfile(safeProfileId, false);
    if (!profileStore) return false;

    const originStore = profileStore.get(origin);
    if (!originStore) return false;

    const deleted = originStore.delete(permName);
    if (originStore.size === 0) {
      profileStore.delete(origin);
    }

    if (deleted && !isEphemeral) {
      this.scheduleSave();
    }
    return deleted;
  }

  /**
   * Clears all permissions for a specific origin.
   * @param {string} profileId
   * @param {string} rawOrigin
   * @returns {boolean}
   */
  clearOrigin(profileId, rawOrigin) {
    const origin = normalizeOrigin(rawOrigin);
    if (!origin) return false;

    const safeProfileId = String(profileId || 'default');
    const isEphemeral = this.ephemeralProfiles.has(safeProfileId);
    const profileStore = this._getStoreForProfile(safeProfileId, false);
    if (!profileStore) return false;

    const existed = profileStore.delete(origin);
    if (existed && !isEphemeral) {
      this.scheduleSave();
    }
    return existed;
  }

  /**
   * Clears all permissions stored for a profile.
   * @param {string} profileId
   */
  clearAll(profileId) {
    const safeProfileId = String(profileId || 'default');
    const isEphemeral = this.ephemeralProfiles.has(safeProfileId);
    const profileStore = this._getStoreForProfile(safeProfileId, false);
    if (!profileStore) return;

    profileStore.clear();
    if (!isEphemeral) {
      this.scheduleSave();
    }
  }
}

module.exports = { PermissionDatabase };
