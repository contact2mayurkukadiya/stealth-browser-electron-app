'use strict';

const crypto = require('crypto');
const State = require('../state');
const { getWindowContextByEventSender } = require('../windows/windowContextUtils');
const { PERMISSION_METADATA } = require('./types');

/**
 * Enterprise PermissionPromptQueue
 * 
 * Manages concurrent permission requests across tabs and iframes.
 * Features:
 * - Queueing per webContents.id
 * - Deduplication of simultaneous requests for the same permission & origin
 * - Automatic cancellation on tab navigation (`did-navigate`, `did-start-navigation`)
 * - Automatic cleanup on webContents destruction (`destroyed`)
 * - Inactivity timeout safety
 * - Display coordination via Window context & Overlay Manager
 */
class PermissionPromptQueue {
  constructor() {
    // Map<webContentsId, Array<QueueItem>>
    this.queuesByWebContents = new Map();
    // Map<promptId, QueueItem>
    this.activePrompts = new Map();
    // Map<webContentsId, Set<string>> to clean up event listeners
    this.attachedListeners = new Set();
  }

  /**
   * Enqueues a permission request.
   * @param {Object} params
   * @param {import('electron').WebContents} params.webContents Requesting web contents
   * @param {string} params.origin Normalized RFC 6454 origin
   * @param {string} params.permission Permission name
   * @param {Object} [params.details] Electron permission request details
   * @param {Function} params.onResolve Callback `(decision: PermissionState, persist: boolean) => void`
   */
  enqueue({ webContents, origin, permission, details = {}, onResolve }) {
    if (!webContents || webContents.isDestroyed()) {
      onResolve('deny', false);
      return;
    }

    const wcId = webContents.id;
    if (!this.queuesByWebContents.has(wcId)) {
      this.queuesByWebContents.set(wcId, []);
      this._attachLifecycleListeners(webContents);
    }

    const queue = this.queuesByWebContents.get(wcId);

    // Deduplicate: if an identical request from the same origin is already waiting, merge callbacks
    const existing = queue.find((item) => item.origin === origin && item.permission === permission);
    if (existing) {
      const prevResolve = existing.onResolve;
      existing.onResolve = (decision, persist) => {
        try { prevResolve(decision, persist); } catch (_) {}
        try { onResolve(decision, persist); } catch (_) {}
      };
      return;
    }

    const promptId = `perm-prompt-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const metadata = PERMISSION_METADATA[permission] || {
      name: permission,
      label: permission,
      description: `Access ${permission}`,
      icon: 'shield',
    };

    const item = {
      promptId,
      webContents,
      webContentsId: wcId,
      origin,
      permission,
      metadata,
      details,
      onResolve,
      createdAt: Date.now(),
      timeoutTimer: null,
    };

    queue.push(item);

    // If no prompt is currently active for this webContents, present it immediately
    if (queue.length === 1) {
      this._presentPrompt(item);
    }
  }

  /**
   * Presents the prompt to the user via Window Chrome and Overlay Manager.
   * @private
   */
  _presentPrompt(item) {
    if (!item || item.webContents.isDestroyed()) {
      this._resolveItem(item, 'deny', false);
      return;
    }

    this.activePrompts.set(item.promptId, item);

    // Set 60-second safety timeout
    item.timeoutTimer = setTimeout(() => {
      this.resolvePrompt(item.promptId, 'deny', false, 'timeout');
    }, 60000);

    const context = getWindowContextByEventSender(item.webContents);
    if (!context || !context.window || context.window.isDestroyed()) {
      // Window is closed or missing
      this._resolveItem(item, 'deny', false);
      return;
    }

    const promptPayload = {
      promptId: item.promptId,
      origin: item.origin,
      permission: item.permission,
      metadata: item.metadata,
      isMainFrame: item.details.isMainFrame !== false,
    };

    // 1. Notify the React Chrome shell (NavBar / Omnibox) so it can display the prompt indicator
    try {
      if (!context.window.webContents.isDestroyed()) {
        context.window.webContents.send('permission:prompt-request', promptPayload);
      }
    } catch (err) {
      console.warn('[PermissionPromptQueue] Failed to send prompt to shell:', err);
    }

    // 2. Display prompt popover using the Chrome Shell Menu Overlay
    try {
      const overlayManager = require('../windows/overlayManager');
      if (typeof overlayManager.showPermissionPromptOverlay === 'function') {
        overlayManager.showPermissionPromptOverlay(context, promptPayload);
      }
    } catch (err) {
      console.warn('[PermissionPromptQueue] Failed to display overlay:', err);
    }
  }

  /**
   * Resolves an active prompt.
   * @param {string} promptId
   * @param {import('./types').PermissionState} decision
   * @param {boolean} persist
   * @param {string} [reason]
   */
  resolvePrompt(promptId, decision, persist = false, reason = 'user') {
    const item = this.activePrompts.get(promptId);
    if (!item) return;

    this.activePrompts.delete(promptId);
    if (item.timeoutTimer) {
      clearTimeout(item.timeoutTimer);
      item.timeoutTimer = null;
    }

    // Close overlay if open for this prompt
    try {
      const context = getWindowContextByEventSender(item.webContents);
      if (context) {
        const overlayManager = require('../windows/overlayManager');
        if (typeof overlayManager.hidePermissionPromptOverlay === 'function') {
          overlayManager.hidePermissionPromptOverlay(context);
        }
        if (context.window && !context.window.isDestroyed() && !context.window.webContents.isDestroyed()) {
          context.window.webContents.send('permission:prompt-dismissed', { promptId });
        }
      }
    } catch (_) {}

    this._resolveItem(item, decision, persist);

    // Process next item in this webContents's queue
    const queue = this.queuesByWebContents.get(item.webContentsId);
    if (queue) {
      const idx = queue.indexOf(item);
      if (idx !== -1) {
        queue.splice(idx, 1);
      }
      if (queue.length > 0) {
        this._presentPrompt(queue[0]);
      } else {
        this.queuesByWebContents.delete(item.webContentsId);
      }
    }
  }

  /**
   * Executes the resolution callback safely.
   * @private
   */
  _resolveItem(item, decision, persist) {
    if (!item || item.resolved) return;
    item.resolved = true;
    if (item.timeoutTimer) {
      clearTimeout(item.timeoutTimer);
      item.timeoutTimer = null;
    }
    try {
      item.onResolve(decision, persist);
    } catch (err) {
      console.error('[PermissionPromptQueue] Error executing onResolve:', err);
    }
  }

  /**
   * Attaches navigation and destruction lifecycle listeners to auto-dismiss prompts.
   * @private
   */
  _attachLifecycleListeners(webContents) {
    const wcId = webContents.id;
    if (this.attachedListeners.has(wcId)) return;
    this.attachedListeners.add(wcId);

    const onNavigation = () => {
      this.cancelAllForWebContents(wcId, 'navigation');
    };

    const onDestroyed = () => {
      this.cancelAllForWebContents(wcId, 'destroyed');
      this.attachedListeners.delete(wcId);
    };

    webContents.on('did-start-navigation', onNavigation);
    webContents.on('did-navigate', onNavigation);
    webContents.once('destroyed', onDestroyed);
  }

  /**
   * Cancels and clears all prompts for a given webContents.
   * @param {number} wcId
   * @param {string} reason
   */
  cancelAllForWebContents(wcId, reason = 'cancelled') {
    const queue = this.queuesByWebContents.get(wcId);
    if (!queue || queue.length === 0) {
      this.queuesByWebContents.delete(wcId);
      return;
    }

    for (const item of queue) {
      this.activePrompts.delete(item.promptId);
      this._resolveItem(item, 'deny', false);
    }

    this.queuesByWebContents.delete(wcId);

    // Hide any active prompt overlay associated with this webContents
    try {
      const tabId = State.webContentsIdToTabId.get(wcId);
      if (tabId) {
        const { getWindowContextByTabId } = require('../windows/windowContextUtils');
        const context = getWindowContextByTabId(tabId);
        if (context) {
          const overlayManager = require('../windows/overlayManager');
          if (typeof overlayManager.hidePermissionPromptOverlay === 'function') {
            overlayManager.hidePermissionPromptOverlay(context);
          }
        }
      }
    } catch (_) {}
  }
}

module.exports = { PermissionPromptQueue };
