'use strict';

const { getPermissionController } = require('../permissions/PermissionController');
const { normalizeOrigin, PERMISSION_METADATA } = require('../permissions/types');

const State = require('../state');

/**
 * SiteSettingsService
 * 
 * Provides high-level business operations for Page Info (padlock) site-settings
 * and the global Settings page.
 */
class SiteSettingsService {
  constructor() {
    this._controller = null;
  }

  get controller() {
    if (!this._controller) {
      this._controller = getPermissionController();
    }
    return this._controller;
  }

  set controller(c) {
    this._controller = c;
  }

  /**
   * Retrieves full permission state for an origin, populated with human-readable metadata.
   * Useful for the padlock Page Info menu.
   * @param {string} profileId
   * @param {string} rawOrigin
   * @returns {{ origin: string, permissions: Array<{ name: string, label: string, description: string, icon: string, state: string, lastUpdated: number | null }> }}
   */
  getOriginState(profileId, rawOrigin) {
    const origin = normalizeOrigin(rawOrigin);
    if (!origin) {
      return { origin: '', permissions: [] };
    }

    const recorded = this.controller.getAllForOrigin(profileId, origin);

    // Common permissions to always display in the Padlock menu
    const standardKeys = ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read'];
    
    // Merge any extra permissions that have been customized
    const allKeys = new Set([...standardKeys, ...Object.keys(recorded)]);

    const permissions = [];
    for (const key of allKeys) {
      const meta = PERMISSION_METADATA[key] || {
        name: key,
        label: key,
        description: key,
        icon: 'shield',
      };
      const rec = recorded[key];
      permissions.push({
        name: key,
        label: meta.label,
        description: meta.description,
        icon: meta.icon,
        state: rec ? rec.state : 'prompt',
        lastUpdated: rec ? rec.lastUpdated : null,
      });
    }

    return {
      origin,
      permissions,
    };
  }

  /**
   * Sets a specific permission for an origin.
   * @param {string} profileId
   * @param {string} rawOrigin
   * @param {string} perm
   * @param {import('../permissions/types').PermissionState} state
   * @param {boolean} [persist]
   */
  setOriginPermission(profileId, rawOrigin, perm, state, persist = true) {
    const origin = normalizeOrigin(rawOrigin);
    if (!origin) return false;
    this.controller.setPermission(profileId, origin, perm, state, persist);
    return true;
  }

  /**
   * Resets all permissions for a site to default (prompt).
   * @param {string} profileId
   * @param {string} rawOrigin
   */
  resetOrigin(profileId, rawOrigin) {
    const origin = normalizeOrigin(rawOrigin);
    if (!origin) return false;
    this.controller.resetOrigin(profileId, origin);
    if (typeof rawOrigin === 'string' && !rawOrigin.includes('://')) {
      const httpOrigin = `http://${rawOrigin.trim().toLowerCase()}`;
      this.controller.resetOrigin(profileId, httpOrigin);
    }
    return true;
  }

  /**
   * Retrieves all permissions grouped by origin for the global settings page.
   * @param {string} profileId
   * @returns {Array<{ origin: string, permissions: Record<string, { state: string, lastUpdated: number }> }>}
   */
  getAllPermissions(profileId) {
    if (profileId) {
      const perms = this.controller.getAll(profileId);
      if (perms && perms.length > 0) return perms;
    }
    if (State.defaultProfileId && State.defaultProfileId !== profileId) {
      const fallback = this.controller.getAll(State.defaultProfileId);
      if (fallback && fallback.length > 0) return fallback;
    }
    return this.controller.getAll(profileId || 'default');
  }

  /**
   * Deletes a single permission for an origin.
   * @param {string} profileId
   * @param {string} rawOrigin
   * @param {string} perm
   */
  deletePermission(profileId, rawOrigin, perm) {
    const origin = normalizeOrigin(rawOrigin);
    if (!origin) return false;
    this.controller.deletePermission(profileId, origin, perm);
    return true;
  }

  /**
   * Clears all permissions for a profile.
   * @param {string} profileId
   */
  clearAllPermissions(profileId) {
    this.controller.clearAll(profileId);
    return true;
  }

  /**
   * Responds to an active permission prompt.
   * @param {string} promptId
   * @param {import('../permissions/types').PermissionState} decision
   * @param {boolean} persist
   */
  respondToPrompt(promptId, decision, persist = false) {
    this.controller.promptQueue.resolvePrompt(promptId, decision, persist, 'user-response');
    return true;
  }
}

const siteSettingsService = new SiteSettingsService();

module.exports = siteSettingsService;
