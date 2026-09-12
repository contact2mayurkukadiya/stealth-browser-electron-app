'use strict';

const { systemPreferences } = require('electron');
const { PermissionDatabase } = require('./PermissionDatabase');
const { PermissionPromptQueue } = require('./PermissionPromptQueue');
const { normalizeOrigin, isValidPermission } = require('./types');

/**
 * Enterprise-Grade Browser PermissionController
 * 
 * Central orchestrator connecting Electron session hooks to the PermissionDatabase,
 * OS-level access gates, and the PermissionPromptQueue.
 */
class PermissionController {
  /**
   * @param {PermissionDatabase} db
   * @param {PermissionPromptQueue} promptQueue
   */
  constructor(db, promptQueue) {
    this.db = db || new PermissionDatabase();
    this.promptQueue = promptQueue || new PermissionPromptQueue();
    // In-memory session decisions: Map<profileId, Map<origin, Map<permName, state>>>
    this.sessionState = new Map();
    // Registered sessions to avoid duplicate hook installations
    this.registeredSessions = new WeakSet();
  }

  /**
   * Registers a session for enterprise permission enforcement.
   * @param {import('electron').Session} ses Target session
   * @param {Object} options
   * @param {string} options.profileId Profile ID associated with the session
   * @param {boolean} [options.isIncognito] True for stealth/private sessions
   */
  registerSession(ses, { profileId = 'default', isIncognito = false } = {}) {
    if (!ses || typeof ses.setPermissionRequestHandler !== 'function') return;
    if (this.registeredSessions.has(ses)) return;
    this.registeredSessions.add(ses);

    const safeProfileId = String(profileId || 'default');
    if (isIncognito) {
      this.db.registerEphemeralProfile(safeProfileId);
    }

    // 1. Synchronous Permission Check Handler (e.g. navigator.permissions.query)
    ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      // Allow internal browser chrome requests (e.g. fullscreen, clipboard)
      if (requestingOrigin && (requestingOrigin.startsWith('app://') || requestingOrigin.startsWith('invisurf://'))) {
        if (permission === 'fullscreen' || permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
          return true;
        }
      }

      const origin = normalizeOrigin(requestingOrigin);
      const permName = this.mapPermissionType(permission, details);
      return this.checkPermission(safeProfileId, origin, permName);
    });

    // 2. Asynchronous Permission Request Handler (e.g. getUserMedia, Geolocation, Notifications)
    ses.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
      // Fast path for destroyed webContents
      if (!webContents || webContents.isDestroyed()) {
        return callback(false);
      }

      // Shell internal permissions
      const requestingUrl = details?.requestingUrl || webContents.getURL() || '';
      if (requestingUrl.startsWith('app://') || requestingUrl.startsWith('invisurf://')) {
        if (permission === 'fullscreen' || permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
          return callback(true);
        }
      }

      const origin = normalizeOrigin(requestingUrl);
      if (!origin) {
        return callback(false);
      }

      const permName = this.mapPermissionType(permission, details);
      if (!isValidPermission(permName)) {
        return callback(false);
      }

      // Check current stored decision
      const currentDecision = this.getDecision(safeProfileId, origin, permName);
      if (currentDecision === 'allow' || currentDecision === 'allow-this-session') {
        // Still verify macOS hardware gates
        if (process.platform === 'darwin') {
          const osOk = await this.verifyOSPermissions(permName);
          if (!osOk) return callback(false);
        }
        return callback(true);
      }

      if (currentDecision === 'deny') {
        return callback(false);
      }

      // Handle OS level gates on macOS prior to showing browser prompt
      if (process.platform === 'darwin') {
        const hasOSAccess = await this.verifyOSPermissions(permName);
        if (!hasOSAccess) {
          return callback(false);
        }
      }

      // Enqueue UI prompt for user decision
      this.promptQueue.enqueue({
        webContents,
        origin,
        permission: permName,
        details,
        onResolve: (decision, persist) => {
          if (decision === 'allow-this-session') {
            this.setSessionDecision(safeProfileId, origin, permName, 'allow-this-session');
          } else if (decision === 'allow' || decision === 'deny') {
            if (persist && !isIncognito) {
              this.db.set(safeProfileId, origin, permName, decision);
            } else {
              this.setSessionDecision(safeProfileId, origin, permName, decision);
            }
          }
          callback(decision === 'allow' || decision === 'allow-this-session');
        },
      });
    });

    // 3. Web Device Permission Handler (WebUSB, WebHID, Serial, Bluetooth)
    ses.setDevicePermissionHandler((details) => {
      const origin = normalizeOrigin(details.origin);
      const permName = this.mapDeviceTypeToPermission(details.deviceType);
      return this.checkPermission(safeProfileId, origin, permName);
    });
  }

  /**
   * Maps Electron permission and details into our canonical PermissionName.
   * Disambiguates media into 'camera' vs 'microphone'.
   * @param {string} permission
   * @param {Object} details
   * @returns {import('./types').PermissionName}
   */
  mapPermissionType(permission, details = {}) {
    if (permission === 'media') {
      const mediaTypes = details.mediaTypes || [];
      const hasVideo = mediaTypes.includes('video');
      const hasAudio = mediaTypes.includes('audio');
      if (hasVideo && !hasAudio) return 'camera';
      if (hasAudio && !hasVideo) return 'microphone';
      // If compound or unspecified, default to camera (subsequent audio request disambiguates)
      return 'camera';
    }
    if (permission === 'clipboard-sanitized-write') return 'clipboard-sanitized-write';
    if (permission === 'clipboard-read') return 'clipboard-read';
    return permission;
  }

  /**
   * Maps deviceType strings from setDevicePermissionHandler.
   * @param {string} deviceType
   * @returns {import('./types').PermissionName}
   */
  mapDeviceTypeToPermission(deviceType) {
    if (deviceType === 'usb') return 'usb';
    if (deviceType === 'hid') return 'hid';
    if (deviceType === 'serial') return 'serial';
    if (deviceType === 'bluetooth') return 'bluetooth';
    return deviceType;
  }

  /**
   * Verifies and triggers OS-level permission dialogs on macOS.
   * @param {import('./types').PermissionName} permission
   * @returns {Promise<boolean>}
   */
  async verifyOSPermissions(permission) {
    if (process.platform !== 'darwin') return true;

    if (permission === 'camera') {
      try {
        const status = systemPreferences.getMediaAccessStatus('camera');
        if (status === 'granted') return true;
        if (status === 'denied' || status === 'restricted') return false;
        return await systemPreferences.askForMediaAccess('camera');
      } catch (err) {
        console.warn('[PermissionController] macOS camera access query error:', err?.message || err);
        return false;
      }
    }

    if (permission === 'microphone') {
      try {
        const status = systemPreferences.getMediaAccessStatus('microphone');
        if (status === 'granted') return true;
        if (status === 'denied' || status === 'restricted') return false;
        return await systemPreferences.askForMediaAccess('microphone');
      } catch (err) {
        console.warn('[PermissionController] macOS mic access query error:', err?.message || err);
        return false;
      }
    }

    return true;
  }

  /**
   * Checks current decision (checking ephemeral session decision first, then persisted database).
   * @param {string} profileId
   * @param {string} origin
   * @param {import('./types').PermissionName} perm
   * @returns {import('./types').PermissionState}
   */
  getDecision(profileId, origin, perm) {
    const sessionMap = this.sessionState.get(profileId)?.get(origin);
    if (sessionMap?.has(perm)) {
      return sessionMap.get(perm);
    }
    return this.db.get(profileId, origin, perm) || 'prompt';
  }

  /**
   * Returns true if permission is granted.
   * @param {string} profileId
   * @param {string} origin
   * @param {import('./types').PermissionName} perm
   * @returns {boolean}
   */
  checkPermission(profileId, origin, perm) {
    const decision = this.getDecision(profileId, origin, perm);
    return decision === 'allow' || decision === 'allow-this-session';
  }

  /**
   * Records a session-scoped permission decision (in-memory only).
   */
  setSessionDecision(profileId, origin, perm, state) {
    if (!this.sessionState.has(profileId)) {
      this.sessionState.set(profileId, new Map());
    }
    const profileMap = this.sessionState.get(profileId);
    if (!profileMap.has(origin)) {
      profileMap.set(origin, new Map());
    }
    profileMap.get(origin).set(perm, state);
  }

  /**
   * Manually sets or flips a permission decision (used by SiteSettingsService and Padlock popover).
   * @param {string} profileId
   * @param {string} origin
   * @param {import('./types').PermissionName} perm
   * @param {import('./types').PermissionState} state
   * @param {boolean} [persist]
   */
  setPermission(profileId, origin, perm, state, persist = true) {
    if (state === 'prompt') {
      // Remove any decision so it prompts on next access
      this.deletePermission(profileId, origin, perm);
      return;
    }

    if (state === 'allow-this-session') {
      this.setSessionDecision(profileId, origin, perm, 'allow-this-session');
      return;
    }

    if (persist) {
      this.db.set(profileId, origin, perm, state);
    }
    this.setSessionDecision(profileId, origin, perm, state);
  }

  /**
   * Deletes a permission decision for an origin.
   */
  deletePermission(profileId, origin, perm) {
    const sessionMap = this.sessionState.get(profileId)?.get(origin);
    if (sessionMap) {
      sessionMap.delete(perm);
    }
    this.db.delete(profileId, origin, perm);
  }

  /**
   * Resets all permissions for an origin to prompt/default.
   */
  resetOrigin(profileId, origin) {
    const sessionMap = this.sessionState.get(profileId);
    if (sessionMap) {
      sessionMap.delete(origin);
    }
    this.db.clearOrigin(profileId, origin);
  }

  /**
   * Gets all permissions for an origin (merging session and persistent states).
   */
  getAllForOrigin(profileId, origin) {
    const persisted = this.db.getAllForOrigin(profileId, origin);
    const sessionMap = this.sessionState.get(profileId)?.get(origin);

    const merged = { ...persisted };
    if (sessionMap) {
      for (const [perm, state] of sessionMap.entries()) {
        merged[perm] = { state, lastUpdated: Date.now() };
      }
    }
    return merged;
  }

  /**
   * Gets all permissions for a profile (for the settings page).
   */
  getAll(profileId) {
    const persistedList = this.db.getAll(profileId);
    const originsMap = new Map();

    for (const item of persistedList) {
      originsMap.set(item.origin, { ...item.permissions });
    }

    const sessionProfileMap = this.sessionState.get(profileId);
    if (sessionProfileMap) {
      for (const [origin, perms] of sessionProfileMap.entries()) {
        if (!originsMap.has(origin)) {
          originsMap.set(origin, {});
        }
        const target = originsMap.get(origin);
        for (const [perm, state] of perms.entries()) {
          target[perm] = { state, lastUpdated: Date.now() };
        }
      }
    }

    const result = [];
    for (const [origin, permissions] of originsMap.entries()) {
      result.push({ origin, permissions });
    }
    return result;
  }

  /**
   * Clears all permissions for a profile.
   */
  clearAll(profileId) {
    this.sessionState.delete(profileId);
    this.db.clearAll(profileId);
  }
}

// Global Singleton Instance
let defaultController = null;

function getPermissionController() {
  if (!defaultController) {
    const db = new PermissionDatabase();
    const queue = new PermissionPromptQueue();
    defaultController = new PermissionController(db, queue);
  }
  return defaultController;
}

module.exports = {
  PermissionController,
  getPermissionController,
};
