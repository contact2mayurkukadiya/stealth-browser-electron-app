const path = require('path');
const { ipcMain, app, clipboard, shell, BrowserWindow, Menu, session } = require('electron');
const fs = require('fs');

const State = require('../state');
const C = require('../../src/constants/conditionStrings.cjs');
const { CHROME_OVERLAY_POST_MAX_BYTES, TAB_STRIP_CONTEXT_MENU_MAX_ITEMS, TAB_STRIP_CONTEXT_MENU_ACTION_IDS } = require('../constants/defaults');

// Services
const profileService = require('../services/profileService');
const settingsService = require('../services/settingsService');
const sessionService = require('../services/sessionService');
const bookmarkService = require('../services/bookmarkService');
const cookieService = require('../services/cookieService');

// Managers
const windowManager = require('../windows/windowManager');
const tabManager = require('../windows/tabManager');
const overlayManager = require('../windows/overlayManager');
const lensManager = require('../windows/lensManager');
const { getWindowContextByEventSender, getWindowContextForShellFallback, getWindowContextByChromeOverlaySender, isViewWebContentsAlive } = require('../windows/windowContextUtils');
const { truncateMenuLabel } = require('../services/sessionService');

// Diagnostics & Internal Handlers
const compatDiagnostics = require(path.join(process.cwd(), 'compatibilityDiagnostics.js'));
const identityDiagnostics = require(path.join(process.cwd(), 'runtime', 'identityDiagnostics.js'));
const { getTabNetworkDomains, addToCookieBlocklist } = require(path.join(process.cwd(), 'runtime', 'sessionPolicy.js'));

function spawnWindowWithTab({ profileId, url }) {
    // 1. Ensure profile exists and create the Native Window Shell
    profileService.ensureProfile(profileId);
    const createdContext = windowManager.createWindow({ profileId });

    // 2. Delegate Tab creation to the Tab Manager
    try {
        if (url && typeof url === 'string' && url.trim() !== '') {
            // Open specifically requested URL (e.g., from Bookmark)
            tabManager.openUrlInNewTab(createdContext, url);
        } else {
            // Fallback to a blank tab (NTP)
            tabManager.createTab(createdContext);
        }
    } catch (err) {
        if (State.appLogger) {
            State.appLogger.error('Failed to spawn initial tab for new window', err);
        }
    }

    return createdContext;
}


// --- SENDER VALIDATION ---
function isSenderTrusted(event) {
    try {
        const frameUrl = event.senderFrame?.url || event.sender?.getURL() || '';
        return frameUrl.startsWith('app://') || frameUrl.startsWith('data:');
    } catch {
        return false;
    }
}

// --- DIAGNOSTICS UTILS ---
function resolveWebContentsForIdentityProbe(context, { tabIdOverride = null, sender = null } = {}) {
    const senderTabId = sender && !sender.isDestroyed?.() ? State.webContentsIdToTabId.get(sender.id) : null;
    const tabId = tabIdOverride || senderTabId || context?.activeTabId || null;
    let wc = null;
    if (sender && !sender.isDestroyed?.() && senderTabId) {
        wc = sender;
    } else if (tabId && context?.tabs?.[tabId]) {
        const view = context.tabs[tabId];
        if (view?.webContents && !view.webContents.isDestroyed()) {
            wc = view.webContents;
        }
    }
    return { tabId, webContents: wc, senderTabId };
}

async function resolveIdentityReportForContext(context, tabIdOverride, sender = null) {
    const { tabId, webContents: wc } = resolveWebContentsForIdentityProbe(context, { tabIdOverride, sender });
    const targetSession = context?.partition && session ? session.fromPartition(context.partition) : session?.defaultSession || null;
    return identityDiagnostics.buildIdentityReport({
        app,
        context,
        webContents: wc,
        tabId,
        session: targetSession,
    });
}

function registerIpcHandlers() {
    // === MENU & LENS SHORTCUTS ===
    ipcMain.handle(C.IPC_INVOKE.RUN_MENU_COMMAND, (event, commandId) => {
        if (!isSenderTrusted(event) || typeof commandId !== 'string') return false;
        const menuUI = require('../ui/menu');
        return menuUI.runMenuCommandFromPalette(commandId);
    });

    ipcMain.handle(C.IPC_INVOKE.GOOGLE_LENS_ACTIVE_FOR_PROFILE, (event) => {
        if (!isSenderTrusted(event)) return false;
        const context = getWindowContextByEventSender(event.sender);
        if (!context?.profileId) return false;
        return !!lensManager.findActiveLensTabForProfile(context.profileId);
    });

    // === WINDOW MANAGEMENT ===
    ipcMain.handle(C.IPC_INVOKE.IS_STEALTH_WINDOW, (event) => {
        if (!isSenderTrusted(event)) return false;
        const ctx = getWindowContextByEventSender(event.sender);
        return !!(ctx && ctx.stealthWindow);
    });

    ipcMain.handle(C.IPC_INVOKE.WINDOW_CREATE, (event, payload = {}) => {
        if (!isSenderTrusted(event)) return null;
        const senderContext = getWindowContextByEventSender(event.sender);
        if (!senderContext) return null;
        const profileId = typeof payload.profileId === 'string' && payload.profileId.trim() ? payload.profileId.trim() : senderContext.profileId;
        const createdContext = spawnWindowWithTab({ profileId, url: payload.url });
        return { windowId: createdContext.windowId, profileId };
    });

    ipcMain.handle(C.IPC_INVOKE.WINDOW_CREATE_STEALTH, (event) => {
        if (!isSenderTrusted(event)) return { ok: false };
        const senderContext = getWindowContextByEventSender(event.sender);
        const profileId = senderContext?.profileId || State.defaultProfileId;
        if (!profileId) return { ok: false };
        profileService.ensureProfile(profileId);
        windowManager.createWindow({ profileId, stealthWindow: true });
        return { ok: true };
    });

    ipcMain.handle(C.IPC_INVOKE.WINDOW_CLOSE_IF_STEALTH, (event) => {
        if (!isSenderTrusted(event)) return { ok: false };
        const context = getWindowContextByEventSender(event.sender);
        if (!context?.stealthWindow) return { ok: false };
        try { if (!context.window.isDestroyed()) context.window.close(); } catch (_) { return { ok: false }; }
        return { ok: true };
    });

    ipcMain.handle(C.IPC_INVOKE.WINDOW_CLOSE_CURRENT, (event) => {
        if (!isSenderTrusted(event)) return { ok: false };
        const context = getWindowContextByEventSender(event.sender);
        if (!context?.window || context.window.isDestroyed()) return { ok: false };
        try { context.window.close(); } catch (_) { return { ok: false }; }
        return { ok: true };
    });

    ipcMain.handle(C.IPC_INVOKE.WINDOW_GET_BOOTSTRAP, (event) => {
        if (!isSenderTrusted(event)) return null;
        const context = getWindowContextByEventSender(event.sender);
        if (!context) return null;
        const payload = State.windowBootstrapById.get(context.windowId) || null;
        State.windowBootstrapById.delete(context.windowId);
        return payload;
    });

    // === PROFILE MANAGEMENT ===
    ipcMain.handle(C.IPC_INVOKE.PROFILE_LIST, (event) => {
        if (!isSenderTrusted(event)) return [];
        return Array.from(State.profilesById.values());
    });

    ipcMain.handle(C.IPC_INVOKE.PROFILE_GET_CURRENT, (event) => {
        if (!isSenderTrusted(event)) return null;
        const context = getWindowContextByEventSender(event.sender);
        if (!context) return null;
        return State.profilesById.get(context.profileId) || null;
    });

    ipcMain.handle(C.IPC_INVOKE.PROFILE_CREATE, (event, payload = {}) => {
        if (!isSenderTrusted(event)) return null;
        const crypto = require('crypto');
        const displayName = typeof payload.displayName === 'string' && payload.displayName.trim() ? payload.displayName.trim() : `Profile ${State.profilesById.size + 1}`;
        const profileId = `profile-${crypto.randomUUID()}`;
        const profile = profileService.ensureProfile(profileId, displayName);
        profileService.saveProfiles();
        return profile;
    });

    ipcMain.handle(C.IPC_INVOKE.PROFILE_UPDATE, (event, payload = {}) => {
        if (!isSenderTrusted(event) || !payload || typeof payload.profileId !== 'string') return null;
        const sid = String(payload.profileId).trim().replace(/[^a-zA-Z0-9-_]/g, '_');
        const p = State.profilesById.get(sid);
        if (!p) return null;
        const name = typeof payload.displayName === 'string' ? payload.displayName.trim() : '';
        if (!name || name.length > 128) return null;
        p.displayName = name;
        p.updatedAt = Date.now();
        profileService.saveProfiles();
        return p;
    });

    ipcMain.handle(C.IPC_INVOKE.PROFILE_SET_AVATAR_DATA, (event, payload = {}) => {
        if (!isSenderTrusted(event)) return { ok: false, error: 'Unauthorized' };
        if (!payload || typeof payload.profileId !== 'string' || typeof payload.dataUrl !== 'string') return { ok: false, error: 'Invalid payload' };
        return profileService.setProfileAvatarFromDataUrl(payload.profileId, payload.dataUrl);
    });

    ipcMain.handle(C.IPC_INVOKE.PROFILE_SET_AVATAR_PRESET, (event, payload = {}) => {
        if (!isSenderTrusted(event)) return { ok: false, error: 'Unauthorized' };
        if (!payload || typeof payload.profileId !== 'string' || typeof payload.fileName !== 'string') return { ok: false, error: 'Invalid payload' };
        return profileService.setProfileAvatarFromPresetPngFile(payload.profileId, payload.fileName);
    });

    ipcMain.handle(C.IPC_INVOKE.PROFILE_VALIDATE_AVATAR, (event, payload = {}) => {
        if (!isSenderTrusted(event)) return { ok: false, error: 'Unauthorized' };
        if (!payload || typeof payload.dataUrl !== 'string') return { ok: false, error: 'No image' };
        const r = profileService.validateAvatarDataUrl(payload.dataUrl);
        if (!r.ok) return { ok: false, error: r.error };
        return { ok: true };
    });

    ipcMain.handle(C.IPC_INVOKE.PROFILE_LIST_PRESETS, (event) => {
        if (!isSenderTrusted(event)) return { ok: false, error: 'Unauthorized', files: [] };
        const { PRESET_AVATAR_PNG_DIR } = require('../constants/defaults');
        try {
            if (!fs.existsSync(PRESET_AVATAR_PNG_DIR)) return { ok: true, files: [] };
            const names = fs.readdirSync(PRESET_AVATAR_PNG_DIR);
            const pngs = names.filter((n) => /^\d+\.png$/i.test(n));
            pngs.sort((a, b) => parseInt(a.replace(/\.png$/i, ''), 10) - parseInt(b.replace(/\.png$/i, ''), 10));
            return { ok: true, files: pngs };
        } catch (err) {
            console.error(C.IPC_INVOKE.PROFILE_LIST_PRESETS, err);
            return { ok: false, error: String(err?.message || err), files: [] };
        }
    });

    ipcMain.handle(C.IPC_INVOKE.PROFILE_CLEAR_AVATAR, (event, payload = {}) => {
        if (!isSenderTrusted(event) || !payload || typeof payload.profileId !== 'string') return { ok: false };
        const sid = String(payload.profileId).trim().replace(/[^a-zA-Z0-9-_]/g, '_');
        const p = State.profilesById.get(sid);
        if (!p) return { ok: false };
        profileService.removeAvatarFilesForProfile(payload.profileId);
        p.hasCustomAvatar = false;
        p.avatarExt = null;
        p.avatarSource = null;
        p.updatedAt = Date.now();
        profileService.saveProfiles();
        return { ok: true, profile: p };
    });

    ipcMain.handle(C.IPC_INVOKE.PROFILE_GET_AVATAR, (event, payload = {}) => {
        if (!isSenderTrusted(event) || !payload || typeof payload.profileId !== 'string') return { dataUrl: null };
        const dataUrl = profileService.getProfileAvatarDataUrl(payload.profileId);
        return { dataUrl: dataUrl || null };
    });

    ipcMain.handle(C.IPC_INVOKE.PROFILE_DELETE, (event, payload = {}) => {
        if (!isSenderTrusted(event)) return { ok: false, error: 'Unauthorized' };
        if (!payload || typeof payload.profileId !== 'string') return { ok: false, error: 'Invalid request' };
        const sid = String(payload.profileId).trim().replace(/[^a-zA-Z0-9-_]/g, '_');
        if (!State.profilesById.has(sid)) return { ok: false, error: 'Profile not found' };
        if (State.profilesById.size <= 1) return { ok: false, error: 'You can’t delete the last profile' };

        for (const ctx of State.windowContextsById.values()) {
            if (ctx.profileId === sid) return { ok: false, error: 'Close all browser windows for this profile first' };
        }

        profileService.removeAvatarFilesForProfile(sid);
        State.profilesById.delete(sid);
        if (State.defaultProfileId === sid) State.defaultProfileId = Array.from(State.profilesById.keys())[0] || null;
        profileService.saveProfiles();
        return { ok: true };
    });

    ipcMain.handle(C.IPC_INVOKE.PROFILE_OPEN_WINDOW, (event, payload = {}) => {
        if (!isSenderTrusted(event) || !payload || typeof payload.profileId !== 'string') return null;
        const profile = profileService.ensureProfile(payload.profileId);
        profileService.saveProfiles();

        const closePicker = payload.closeProfilePicker === true;
        const closedWindow = closePicker ? sessionService.consumeRecentlyClosedWindowForProfile(profile.profileId) : null;
        const sessionForWindowId = closePicker && !closedWindow ? (State.startupSessionDoc || sessionService.readDecodedSessionDoc()) : null;
        const resolvedWindowId = sessionService.findSessionWindowIdForProfile(sessionForWindowId, profile.profileId);

        const created = windowManager.createWindow({ profileId: profile.profileId, windowId: resolvedWindowId });

        if (closedWindow) {
            State.windowBootstrapById.set(created.windowId, {
                restoreWindow: { tabs: closedWindow.tabs, activeTabId: closedWindow.activeTabId },
            });
        }

        if (closePicker) {
            State.startupSessionDoc = null;
            if (State.profilePickerWindow && !State.profilePickerWindow.isDestroyed()) {
                State.profilePickerWindow.close();
            }
        }
        return { windowId: created.windowId, profileId: profile.profileId };
    });

    ipcMain.handle(C.IPC_INVOKE.PROFILE_PICKER_OPEN, (event) => {
        if (!isSenderTrusted(event)) return { ok: false };
        windowManager.createProfilePickerWindow();
        return { ok: true };
    });

    ipcMain.handle(C.IPC_INVOKE.PROFILE_CLOSE_CURRENT, (event) => {
        if (!isSenderTrusted(event)) return { ok: false };
        const context = getWindowContextByEventSender(event.sender);
        const profileId = context?.profileId;
        if (!profileId) return { ok: false };

        const targets = Array.from(State.windowContextsById.values()).filter((ctx) => (
            ctx?.profileId === profileId && ctx.window && !ctx.window.isDestroyed()
        ));

        if (targets.length === 0) return { ok: true };

        for (const target of targets) {
            try { target.window.close(); } catch (err) { console.error(C.IPC_INVOKE.PROFILE_CLOSE_CURRENT, err?.message || err); }
        }
        return { ok: true, closed: targets.length };
    });

    // === RECENTLY CLOSED ===
    ipcMain.handle(C.IPC_INVOKE.RECENTLY_CLOSED_LIST, (event) => {
        if (!isSenderTrusted(event)) return [];
        const context = getWindowContextByEventSender(event.sender) || getWindowContextForShellFallback();
        if (!context?.profileId) return [];
        const stack = sessionService.getOrCreateRecentlyClosedForProfile(context.profileId);
        return stack.slice(0, 15).map((entry) => ({
            type: entry?.type === 'window' ? 'window' : 'tab',
            label: sessionService.recentlyClosedEntryLabel(entry),
            subtitle: entry?.type === 'window' ? `${entry?.tabs?.length || 0} tabs` : (entry?.url || ''),
            closedAt: entry?.closedAt || null,
        }));
    });

    ipcMain.handle(C.IPC_INVOKE.RECENTLY_CLOSED_RESTORE, (event, payload = {}) => {
        if (!isSenderTrusted(event)) return { ok: false };
        const closedAt = typeof payload?.closedAt === 'number' ? payload.closedAt : null;
        sessionService.restoreRecentlyClosed(closedAt);
        return { ok: true };
    });

    // === TOOLTIP ===
    ipcMain.on(C.IPC_SEND.TOOLTIP_SHOW, (e, { title, url, memory, x, y, width, height }) => {
        if (!isSenderTrusted(e)) return;
        const context = getWindowContextByEventSender(e.sender);
        if (!context?.tooltipView) return;
        overlayManager.ensureChromeOverlayOnTop(context);
        context.tooltipView.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
        context.tooltipView.webContents.send(C.IPC_EVENT.TOOLTIP_UPDATE, { title, url, memory });
    });

    ipcMain.on(C.IPC_SEND.TOOLTIP_HIDE, (e) => {
        if (!isSenderTrusted(e)) return;
        const context = getWindowContextByEventSender(e.sender);
        if (context?.tooltipView) {
            context.tooltipView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        }
    });

    // === OVERLAYS ===
    ipcMain.handle(C.IPC_INVOKE.CHROME_OVERLAY_RESET, (e) => {
        if (!isSenderTrusted(e)) return { ok: false };
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return { ok: false };
        overlayManager.createChromeOmniboxOverlayLayer(context); // Ensures it exists
        context.chromeOmniboxOverlayAcquireCount = 0;
        context.chromeOverlayOmniboxMode = false;
        context.lastOmniboxOverlayPatch = null;
        context.chromeOverlayBlurDismissPending = false;
        try {
            if (context.chromeOmniboxOverlayView && !context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
                context.chromeOmniboxOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
                context.chromeOmniboxOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            }
        } catch (err) { console.error(C.IPC_INVOKE.CHROME_OVERLAY_RESET, err?.message || err); }
        try {
            if (context.window?.webContents && !context.window.webContents.isDestroyed()) {
                context.window.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_SUPERSEDED);
            }
        } catch (err) { console.error('chrome-overlay:v1:superseded send', err?.message || err); }
        return { ok: true };
    });

    ipcMain.handle(C.IPC_INVOKE.CHROME_OVERLAY_ACQUIRE, (e) => {
        if (!isSenderTrusted(e)) return { ok: false };
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return { ok: false };
        overlayManager.createChromeOmniboxOverlayLayer(context);
        context.chromeOmniboxOverlayAcquireCount = (context.chromeOmniboxOverlayAcquireCount || 0) + 1;
        overlayManager.ensureChromeOverlayOnTop(context);
        return { ok: true };
    });

    ipcMain.handle(C.IPC_INVOKE.CHROME_OVERLAY_RELEASE, (e) => {
        if (!isSenderTrusted(e)) return { ok: false };
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return { ok: false };
        if (context.chromeOmniboxOverlayAcquireCount > 0) context.chromeOmniboxOverlayAcquireCount -= 1;
        if (context.chromeOmniboxOverlayAcquireCount <= 0) {
            context.chromeOmniboxOverlayAcquireCount = 0;
            context.chromeOverlayOmniboxMode = false;
            context.lastOmniboxOverlayPatch = null;
            context.chromeOverlayBlurDismissPending = false;
            try {
                if (context.chromeOmniboxOverlayView && !context.chromeOmniboxOverlayView.webContents.isDestroyed()) {
                    context.chromeOmniboxOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
                    context.chromeOmniboxOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
                }
            } catch (err) { console.error(C.IPC_INVOKE.CHROME_OVERLAY_RELEASE, err?.message || err); }
        }
        overlayManager.ensureChromeOverlayOnTop(context);
        return { ok: true };
    });

    ipcMain.handle(C.IPC_INVOKE.CHROME_OVERLAY_POST, (e, payload) => {
        if (!isSenderTrusted(e)) return { ok: false };
        const context = getWindowContextByEventSender(e.sender);
        if (!context || (context.chromeOmniboxOverlayAcquireCount || 0) <= 0) return { ok: false };
        try {
            const json = JSON.stringify(payload ?? {});
            if (json.length > CHROME_OVERLAY_POST_MAX_BYTES) return { ok: false };
        } catch { return { ok: false }; }
        const patch = payload ?? {};
        if (patch.kind !== 'omniboxSuggestions') return { ok: false };
        overlayManager.createChromeOmniboxOverlayLayer(context);
        if (!context.chromeOmniboxOverlayView || context.chromeOmniboxOverlayView.webContents.isDestroyed()) return { ok: false };
        return overlayManager.deliverOmniboxOverlayPatch(context, patch);
    });

    ipcMain.handle(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_RESET, (e) => {
        if (!isSenderTrusted(e)) return { ok: false };
        const context = getWindowContextByEventSender(e.sender);
        if (!context?.chromeShellMenuOverlayView) return { ok: false };
        context.chromeShellMenuOverlayAcquireCount = 0;
        try {
            if (!context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
                context.chromeShellMenuOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
                context.chromeShellMenuOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
            }
        } catch (err) { console.error(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_RESET, err?.message || err); }
        try {
            if (context.window?.webContents && !context.window.webContents.isDestroyed()) {
                context.window.webContents.send(C.IPC_EVENT.CHROME_SHELL_MENU_OVERLAY_SUPERSEDED);
            }
        } catch (err) { console.error('chrome-shell-menu-overlay:v1:superseded send', err?.message || err); }
        return { ok: true };
    });

    ipcMain.handle(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_ACQUIRE, (e) => {
        if (!isSenderTrusted(e)) return { ok: false };
        const context = getWindowContextByEventSender(e.sender);
        if (!context?.chromeShellMenuOverlayView) return { ok: false };
        overlayManager.createChromeShellMenuOverlayLayer(context);
        context.chromeShellMenuOverlayAcquireCount = (context.chromeShellMenuOverlayAcquireCount || 0) + 1;
        overlayManager.ensureChromeOverlayOnTop(context);
        return { ok: true };
    });

    ipcMain.handle(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_RELEASE, (e) => {
        if (!isSenderTrusted(e)) return { ok: false };
        const context = getWindowContextByEventSender(e.sender);
        if (!context?.chromeShellMenuOverlayView) return { ok: false };
        if (context.chromeShellMenuOverlayAcquireCount > 0) context.chromeShellMenuOverlayAcquireCount -= 1;
        if (context.chromeShellMenuOverlayAcquireCount <= 0) {
            context.chromeShellMenuOverlayAcquireCount = 0;
            try {
                if (!context.chromeShellMenuOverlayView.webContents.isDestroyed()) {
                    context.chromeShellMenuOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, { kind: 'hide' });
                    context.chromeShellMenuOverlayView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
                }
            } catch (err) { console.error(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_RELEASE, err?.message || err); }
        }
        overlayManager.ensureChromeOverlayOnTop(context);
        return { ok: true };
    });

    ipcMain.handle(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_POST, (e, payload) => {
        if (!isSenderTrusted(e)) return { ok: false };
        const context = getWindowContextByEventSender(e.sender);
        if (!context?.chromeShellMenuOverlayView || context.chromeShellMenuOverlayView.webContents.isDestroyed()) return { ok: false };
        if ((context.chromeShellMenuOverlayAcquireCount || 0) <= 0) return { ok: false };
        const patch = payload ?? {};
        const { SHELL_MENU_OVERLAY_KINDS } = require('../constants/defaults');
        if (!SHELL_MENU_OVERLAY_KINDS.has(patch.kind)) return { ok: false };

        try {
            const json = JSON.stringify(patch);
            if (json.length > CHROME_OVERLAY_POST_MAX_BYTES) return { ok: false };
        } catch { return { ok: false }; }

        try {
            const overlayBounds = overlayManager.computeMenuOverlayBounds(context, patch);
            if (overlayBounds) {
                context.chromeShellMenuOverlayView.setBounds({
                    x: overlayBounds.x, y: overlayBounds.y, width: overlayBounds.width, height: overlayBounds.height,
                });
                patch.overlayBounds = overlayBounds;
                patch.overlayViewport = { width: overlayBounds.viewportWidth, height: overlayBounds.viewportHeight };
            }
            overlayManager.ensureChromeOverlayOnTop(context);
            context.chromeShellMenuOverlayView.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_PATCH, patch);

            if (patch.focusInput !== false) {
                setImmediate(() => { overlayManager.focusChromeShellMenuOverlayWebContents(context); });
            }
        } catch (err) {
            console.error(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_POST, err?.message || err);
            return { ok: false };
        }
        return { ok: true };
    });

    ipcMain.on(C.IPC_SEND.CHROME_OVERLAY_FROM_OVERLAY, (e, data) => {
        const context = getWindowContextByChromeOverlaySender(e.sender);
        if (!context?.window?.webContents || context.window.webContents.isDestroyed()) return;

        if (data?.type === 'bookmarkMenu') {
            console.log('bookmarkMenu', data);
            if (data.id === 'openNewWindow') {
                const bookmarksData = bookmarkService.loadBookmarks(context.profileId);
                console.log('bookmarksData', bookmarksData);
                const findBookmark = (items, targetId) => {
                    for (const item of items) {
                        if (item.id === targetId) return item;
                        if (item.children) {
                            const found = findBookmark(item.children, targetId);
                            if (found) return found;
                        }
                    }
                    return null;
                };

                const bookmark = findBookmark(bookmarksData.bar || [], data.bookmarkItemId);
                if (bookmark && bookmark.url) {
                    spawnWindowWithTab({ profileId: context.profileId, url: bookmark.url });
                }
                return;
            }
        }
        console.log('data', data);

        if (data?.type === 'lensSelectionCapture') {
            lensManager.captureGoogleLensSelection(context, data.rect).catch((err) => { console.error('lensSelectionCapture', err?.message || err); });
            return;
        }
        if (data?.type === 'lensSelectionCancel') {
            lensManager.closeGoogleLensSelection(context, { closeSidebar: data.closeSidebar === true });
            return;
        }
        if (data?.type === 'lensSidebarResize') {
            lensManager.resizeGoogleLensSidebar(context, data.width);
            return;
        }
        if (data?.type === 'lensSidebarResizeCommit') {
            lensManager.commitGoogleLensSidebarResize(context, data.width);
            return;
        }
        if (data?.type === 'lensCopyImage') {
            lensManager.copyLensSelectionImage(context);
            return;
        }
        if (data?.type === 'lensCopyText') {
            lensManager.copyLensSelectionText(context).catch((err) => { console.error('lensCopyText', err?.message || err); });
            return;
        }
        try {
            context.window.webContents.send(C.IPC_EVENT.CHROME_OVERLAY_HOST, data ?? {});
        } catch (err) {
            console.error(C.IPC_SEND.CHROME_OVERLAY_FROM_OVERLAY, err?.message || err);
        }
    });

    // === TABS & NAVIGATION ===
    ipcMain.on(C.IPC_SEND.NEW_TAB, (e, { id, isStealth, url, source, history } = {}) => {
        if (!isSenderTrusted(e)) return;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return;
        overlayManager.dismissChromeShellMenuOverlay(context, 'browser-action');
        const { resolveTabLoadUrl, markNextNavigationTransition, isInternalPageUrl } = require('../utils/navigation');
        const resolvedUrl = resolveTabLoadUrl(url);

        if (State.appLogger) {
            State.appLogger.info('ipc:new-tab', { windowId: context.windowId, profileId: context.profileId, tabId: id, url: resolvedUrl, source, restoresHistory: !!history });
        }
        if (url && !isInternalPageUrl(url)) {
            markNextNavigationTransition(id, source || 'link');
        }

        const stealthTab = !!context.stealthWindow;
        tabManager.createTab(context, id, resolvedUrl, stealthTab, { navigationHistory: history || null });

        if (context.window && !context.window.webContents.isDestroyed()) {
            context.window.webContents.send(C.IPC_EVENT.TAB_CREATED, { id, isStealth: stealthTab, url: resolvedUrl });
        }
    });

    ipcMain.on(C.IPC_SEND.SWITCH_TAB, (e, { id }) => {
        if (!isSenderTrusted(e)) return;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return;
        if (!context.tabs[id] && !context.sleepingTabs[id]) return;
        overlayManager.dismissChromeShellMenuOverlay(context, 'browser-action');
        if (State.appLogger) {
            State.appLogger.info('ipc:switch-tab', { windowId: context.windowId, profileId: context.profileId, tabId: id, wasSleeping: !!context.sleepingTabs[id] });
        }
        tabManager.activateOrWakeTab(id);
    });

    ipcMain.on(C.IPC_SEND.TAB_MENU_SYNC, (e, payload = {}) => {
        if (!isSenderTrusted(e)) return;
        if (typeof payload.muteSiteShowsUnmute === 'boolean') State.tabMenuMuteSiteShowsUnmute = payload.muteSiteShowsUnmute;
        if (typeof payload.pinShowsUnpin === 'boolean') State.tabMenuPinShowsUnpin = payload.pinShowsUnpin;
        require('../ui/menu').rebuildApplicationMenu();
    });

    ipcMain.on(C.IPC_SEND.TAB_SET_AUDIO_MUTED, (e, { id, muted }) => {
        if (!isSenderTrusted(e)) return;
        const context = getWindowContextByEventSender(e.sender);
        if (!context || !id || typeof muted !== 'boolean') return;
        if (!context.tabs[id] || context.tabs[id].webContents.isDestroyed()) return;
        try { context.tabs[id].webContents.setAudioMuted(muted); } catch (_) { }
    });

    ipcMain.on(C.IPC_SEND.CLOSE_TAB, (e, payload = {}) => {
        if (!isSenderTrusted(e)) return;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return;
        const id = payload?.id;
        const closeWindowIfLast = payload?.closeWindowIfLast === true;
        if (!id || typeof id !== 'string') return;
        overlayManager.dismissChromeShellMenuOverlay(context, 'browser-action');

        const tabSnapshot = sessionService.captureClosedTabSnapshot(context, id);
        if (State.appLogger) {
            State.appLogger.info('ipc:close-tab', { windowId: context.windowId, profileId: context.profileId, tabId: id, captured: !!tabSnapshot, url: tabSnapshot?.url || null });
        }

        delete context.sleepingTabs[id];

        if (State.detachedTabWindows.has(id)) {
            const w = State.detachedTabWindows.get(id);
            if (w && !w.isDestroyed()) w.close();
            return;
        }

        if (context.tabs[id]) {
            tabManager.removeTabContentChildView(context, context.tabs[id]);
            context.tabs[id].webContents.destroy();
            delete context.tabs[id];
            State.tabIdToWindowId.delete(id);
            lensManager.destroyLensSession(context, id);
            if (context.activeTabId === id) context.activeTabId = null;
        }
        State.pendingTransitionsByTab.delete(String(id));
        if (State.historyService) State.historyService.clearTab(id);
        compatDiagnostics.clear(id);

        if (tabSnapshot) {
            sessionService.pushRecentlyClosedEntry(context.profileId, { type: 'tab', title: tabSnapshot.title, url: tabSnapshot.url, history: tabSnapshot.history });
        }

        const tabsRemaining = Object.keys(context.tabs).length + Object.keys(context.sleepingTabs).length;
        if (closeWindowIfLast && tabsRemaining === 0) {
            try {
                if (!context.window.isDestroyed()) context.window.close();
            } catch (err) {
                if (State.appLogger) State.appLogger.error('ipc:close-tab:close-window', { windowId: context.windowId, error: State.appLogger.serializeError(err) });
            }
        }
    });

    ipcMain.on(C.IPC_SEND.GO_BACK, (e, { id }) => {
        if (!isSenderTrusted(e)) return;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return;
        overlayManager.dismissChromeShellMenuOverlay(context, 'browser-action');
        const targetId = id === 'current' ? context.activeTabId : id;
        if (State.appLogger) State.appLogger.info('ipc:go-back', { windowId: context.windowId, profileId: context.profileId, tabId: targetId });
        if (context.tabs[targetId]) context.tabs[targetId].webContents.navigationHistory.goBack();
    });

    ipcMain.on(C.IPC_SEND.GO_FORWARD, (e, { id }) => {
        if (!isSenderTrusted(e)) return;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return;
        overlayManager.dismissChromeShellMenuOverlay(context, 'browser-action');
        const targetId = id === 'current' ? context.activeTabId : id;
        if (State.appLogger) State.appLogger.info('ipc:go-forward', { windowId: context.windowId, profileId: context.profileId, tabId: targetId });
        if (context.tabs[targetId]) context.tabs[targetId].webContents.navigationHistory.goForward();
    });

    ipcMain.on(C.IPC_SEND.RELOAD, (e, { id }) => {
        if (!isSenderTrusted(e)) return;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return;
        overlayManager.dismissChromeShellMenuOverlay(context, 'browser-action');
        const targetId = id === 'current' ? context.activeTabId : id;
        if (context.tabs[targetId]) {
            if (State.appLogger) State.appLogger.info('ipc:reload', { windowId: context.windowId, profileId: context.profileId, tabId: targetId, url: context.tabs[targetId].webContents.getURL() });
            const { markNextNavigationTransition } = require('../utils/navigation');
            markNextNavigationTransition(targetId, C.IPC_SEND.RELOAD);
            tabManager.resetTabWebContentsScale(context.tabs[targetId]);
            context.tabs[targetId].webContents.reload();
        }
    });

    ipcMain.on(C.IPC_SEND.NAVIGATE, (e, { id, url, source } = {}) => {
        if (!isSenderTrusted(e) || !url) return;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return;
        overlayManager.dismissChromeShellMenuOverlay(context, 'browser-action');

        const targetId = id === 'current' ? context.activeTabId : id;
        if (!context.tabs[targetId]) return;
        if (State.appLogger) State.appLogger.info('ipc:navigate-request', { windowId: context.windowId, profileId: context.profileId, tabId: targetId, url, source });

        if (targetId === context.activeTabId && lensManager.getLensSession(context, targetId, false)?.selectionActive) {
            lensManager.closeGoogleLensSelection(context, { closeSidebar: true });
        }
        tabManager.resetTabWebContentsScale(context.tabs[targetId]);

        let formattedUrl = url.trim();
        const { resolveInternalPageUrl, buildSearchUrl, markNextNavigationTransition } = require('../utils/navigation');
        const resolvedInternalUrl = resolveInternalPageUrl(formattedUrl);
        if (resolvedInternalUrl !== formattedUrl) {
            tabManager.resetTabWebContentsScale(context.tabs[targetId]);
            context.tabs[targetId]?.webContents.loadURL(resolvedInternalUrl);
            return;
        }

        const looksLikeUrl = (str) => str.includes('://') || (!str.includes(' ') && str.includes('.'));
        const activeEngine = (settingsService.loadSettings().searchEngine) || 'google';
        if (!looksLikeUrl(formattedUrl)) {
            formattedUrl = buildSearchUrl(activeEngine, formattedUrl);
        } else if (!formattedUrl.includes('://')) {
            formattedUrl = `https://${formattedUrl}`;
        }

        markNextNavigationTransition(targetId, source || 'link');
        tabManager.resetTabWebContentsScale(context.tabs[targetId]);
        context.tabs[targetId]?.webContents.loadURL(formattedUrl);
    });

    ipcMain.on(C.IPC_SEND.TAB_SLEEP_REGISTER, (e, { id, url, title, favicon, history } = {}) => {
        if (!isSenderTrusted(e)) return;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return;
        context.sleepingTabs[id] = {
            url: url || C.URL.NTP_DISPLAY,
            title: title || null,
            favicon: favicon || null,
            history: history || null,
        };
        State.tabIdToWindowId.set(id, context.window.id);
    });

    ipcMain.handle(C.IPC_INVOKE.TAB_HIDE_ACTIVE, (e) => {
        if (!isSenderTrusted(e)) return;
        const context = getWindowContextByEventSender(e.sender);
        if (context) tabManager.hideActiveTabViewForShellOverlay(context);
    });

    ipcMain.handle(C.IPC_INVOKE.TAB_RESTORE_ACTIVE, (e) => {
        if (!isSenderTrusted(e)) return;
        const context = getWindowContextByEventSender(e.sender);
        if (context) tabManager.restoreActiveTabViewFromShellOverlay(context);
    });

    ipcMain.handle(C.IPC_INVOKE.TAB_CAPTURE_SNAPSHOT, async (e) => {
        if (!isSenderTrusted(e)) return { dataUrl: null };
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return { dataUrl: null };
        const id = context.activeTabId;
        if (!id || State.detachedTabWindows.has(id)) return { dataUrl: null };
        const view = context.tabs[id];
        if (!view || view.webContents.isDestroyed()) return { dataUrl: null };
        try {
            const image = await view.webContents.capturePage();
            if (!image || image.isEmpty()) return { dataUrl: null };
            return { dataUrl: `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}` };
        } catch (err) {
            console.error(C.IPC_INVOKE.TAB_CAPTURE_SNAPSHOT, err);
            return { dataUrl: null };
        }
    });

    ipcMain.handle(C.IPC_INVOKE.TAB_PREPARE_SHELL_OVERLAY, async (e) => {
        if (!isSenderTrusted(e)) return { dataUrl: null };
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return { dataUrl: null };
        const id = context.activeTabId;
        if (!id || State.detachedTabWindows.has(id)) return { dataUrl: null };
        const view = context.tabs[id];
        if (!view || view.webContents.isDestroyed()) return { dataUrl: null };
        let dataUrl = null;
        try {
            const image = await view.webContents.capturePage();
            if (image && !image.isEmpty()) {
                dataUrl = `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}`;
            }
        } catch (err) { console.error('tab:prepare-shell-overlay capture', err); }
        try { tabManager.hideActiveTabViewForShellOverlay(context); } catch (err) { console.error('tab:prepare-shell-overlay hide', err); }
        return { dataUrl };
    });

    ipcMain.handle(C.IPC_INVOKE.TAB_MOVE_NEW_WINDOW, async (e, { id, fallbackTabId }) => {
        if (!isSenderTrusted(e) || !id || typeof id !== 'string') return { ok: false };
        try { return tabManager.moveTabToDetachedWindow(id, fallbackTabId); } catch (err) {
            console.error(C.IPC_INVOKE.TAB_MOVE_NEW_WINDOW, err);
            return { ok: false };
        }
    });

    ipcMain.handle(C.IPC_INVOKE.TAB_STRIP_CONTEXT_MENU, (e, payload = {}) => {
        if (!isSenderTrusted(e)) return { ok: false };
        const sender = e.sender;
        if (!sender || sender.isDestroyed()) return { ok: false };
        const tabId = payload.tabId;
        if (!tabId || typeof tabId !== 'string') return { ok: false };
        const x = Number(payload.x);
        const y = Number(payload.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false };
        const rawItems = Array.isArray(payload.items) ? payload.items : [];
        const items = rawItems.slice(0, TAB_STRIP_CONTEXT_MENU_MAX_ITEMS);
        const win = BrowserWindow.fromWebContents(sender);
        if (!win || win.isDestroyed()) return { ok: false };

        const template = [];
        for (const raw of items) {
            if (!raw || typeof raw !== 'object') continue;
            if (raw.type === 'separator') {
                template.push({ type: 'separator' });
                continue;
            }
            if (raw.type !== 'item') continue;
            const actionId = raw.id;
            if (!actionId || typeof actionId !== 'string' || !TAB_STRIP_CONTEXT_MENU_ACTION_IDS.has(actionId)) continue;
            const label = truncateMenuLabel(String(raw.label || ''), 80);
            if (!label) continue;
            const enabled = raw.enabled !== false;
            const capturedTabId = tabId;
            const capturedActionId = actionId;
            template.push({
                label, enabled,
                click: () => {
                    try {
                        if (!sender.isDestroyed()) sender.send(C.IPC_EVENT.TAB_STRIP_MENU_ACTION, { tabId: capturedTabId, id: capturedActionId });
                    } catch (err) { console.error(C.IPC_EVENT.TAB_STRIP_MENU_ACTION, err?.message || err); }
                },
            });
        }
        if (template.length === 0) return { ok: false };
        try {
            const menu = Menu.buildFromTemplate(template);
            menu.popup({ window: win, x: Math.round(x), y: Math.round(y) });
        } catch (err) {
            console.error(C.IPC_INVOKE.TAB_STRIP_CONTEXT_MENU, err?.message || err);
            return { ok: false };
        }
        return { ok: true };
    });

    ipcMain.handle(C.IPC_INVOKE.TAB_GET_INFO, async (e, { id }) => {
        if (!isSenderTrusted(e)) return null;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return null;

        if (!context.tabs[id] && context.sleepingTabs[id]) {
            return { url: context.sleepingTabs[id].url, title: null, memory: 0, isSleeping: true };
        }

        const view = context.tabs[id];
        if (!view || view.webContents.isDestroyed()) return null;

        try {
            const wc = view.webContents;
            let memoryBytes = 0;
            if (typeof wc.getProcessMemoryInfo === 'function') {
                try {
                    const info = await wc.getProcessMemoryInfo();
                    memoryBytes = info.privateBytes || 0;
                } catch (err) { console.error('getProcessMemoryInfo failed:', err); }
            }
            return { title: wc.getTitle(), url: wc.getURL(), memory: memoryBytes };
        } catch (err) {
            console.error('Failed to get tab info:', err);
            return null;
        }
    });

    // === SETTINGS & COOKIES ===
    ipcMain.handle(C.IPC_INVOKE.SETTINGS_GET, (e) => {
        if (!isSenderTrusted(e)) return require('../constants/defaults').SETTINGS_DEFAULTS;
        return settingsService.loadSettings(settingsService.getProfileIdForEventSender(e.sender));
    });

    ipcMain.handle(C.IPC_INVOKE.SETTINGS_SAVE, async (e, data) => {
        if (!isSenderTrusted(e)) return false;
        const profileId = settingsService.getProfileIdForEventSender(e.sender);
        const current = settingsService.loadSettings(profileId);
        const patch = typeof data === 'object' && data ? data : {};
        const next = { ...current, ...patch };
        const chromeTheme = require('../../src/theme/chromeTheme.cjs');

        if (Object.prototype.hasOwnProperty.call(patch, 'colorTheme')) {
            next.colorTheme = settingsService.normalizeColorTheme(patch.colorTheme);
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'accentTheme')) {
            next.accentTheme = chromeTheme.normalizeAccentTheme(patch.accentTheme);
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'accentCustomHex')) {
            const raw = patch.accentCustomHex;
            next.accentCustomHex = raw == null || raw === '' ? null : chromeTheme.normalizeAccentHex(raw);
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'cookieConfig')) {
            const { normalizeCookieConfig } = require('../../runtime/sessionPolicy.js');
            const normalizedCookieConfig = normalizeCookieConfig(patch.cookieConfig);
            const byProfile = next.cookieConfigByProfile && typeof next.cookieConfigByProfile === 'object' ? { ...next.cookieConfigByProfile } : {};
            const safeProfileId = settingsService.normalizeProfileId(profileId);
            if (safeProfileId) byProfile[safeProfileId] = normalizedCookieConfig;
            next.cookieConfig = normalizedCookieConfig;
            next.cookieConfigByProfile = byProfile;
        }

        settingsService.saveSettings(chromeTheme.normalizeAccentFields(settingsService.normalizeCookieSettingsFields(next, profileId)));

        if (Object.prototype.hasOwnProperty.call(patch, 'cookieConfig')) {
            await cookieService.cleanupBlockedCookiesForProfile(profileId);
        }
        settingsService.applyColorThemeFromSettings();
        settingsService.broadcastSettingsUpdate(next);
        return true;
    });

    ipcMain.handle(C.IPC_INVOKE.COOKIE_SUMMARY, async (e, { profileId } = {}) => {
        if (!isSenderTrusted(e)) return [];
        const authorizedProfileId = settingsService.resolveAuthorizedProfileIdForSender(e.sender, profileId);
        if (!authorizedProfileId) return [];
        return cookieService.getCookieSummaryForSession(cookieService.getProfileSession(authorizedProfileId));
    });

    ipcMain.handle(C.IPC_INVOKE.COOKIE_DELETE_DOMAIN, async (e, { profileId, domain } = {}) => {
        if (!isSenderTrusted(e)) return { ok: false, deleted: 0 };
        const authorizedProfileId = settingsService.resolveAuthorizedProfileIdForSender(e.sender, profileId);
        if (!authorizedProfileId) return { ok: false, deleted: 0 };
        const targetSession = cookieService.getProfileSession(authorizedProfileId);
        const deleted = await cookieService.removeCookiesMatching(targetSession, (cookie) => cookieService.cookieMatchesDomain(cookie, domain));
        return { ok: true, deleted };
    });

    ipcMain.handle(C.IPC_INVOKE.COOKIE_CLEAR_ALL, async (e, { profileId, since } = {}) => {
        if (!isSenderTrusted(e)) return { ok: false, deleted: 0 };
        const authorizedProfileId = settingsService.resolveAuthorizedProfileIdForSender(e.sender, profileId);
        if (!authorizedProfileId) return { ok: false, deleted: 0 };
        const deleted = await cookieService.removeCookiesModifiedSince(cookieService.getProfileSession(authorizedProfileId), since);
        return { ok: true, deleted };
    });

    ipcMain.handle(C.IPC_INVOKE.COOKIE_SETTINGS_GET, (e, { profileId } = {}) => {
        const { COOKIE_CONFIG_DEFAULTS } = require('../constants/defaults');
        if (!isSenderTrusted(e)) return COOKIE_CONFIG_DEFAULTS;
        const authorizedProfileId = settingsService.resolveAuthorizedProfileIdForSender(e.sender, profileId);
        if (!authorizedProfileId) return COOKIE_CONFIG_DEFAULTS;
        return settingsService.loadSettings(authorizedProfileId).cookieConfig;
    });

    ipcMain.handle(C.IPC_INVOKE.COOKIE_SETTINGS_UPDATE, async (e, payload) => {
        const { COOKIE_CONFIG_DEFAULTS } = require('../constants/defaults');
        if (!isSenderTrusted(e)) return COOKIE_CONFIG_DEFAULTS;
        const profileId = payload?.profileId;
        const config = payload?.config || payload;
        const authorizedProfileId = settingsService.resolveAuthorizedProfileIdForSender(e.sender, profileId);
        if (!authorizedProfileId) return COOKIE_CONFIG_DEFAULTS;
        const savedConfig = settingsService.updateCookieConfigForProfile(authorizedProfileId, config);
        await cookieService.cleanupBlockedCookiesForProfile(authorizedProfileId);
        return savedConfig;
    });

    // === WEBAUTHN ===
    ipcMain.handle('webauthn:getCookieUsage', async (event) => {
        if (!isSenderTrusted(event)) return { main: null, embedded: [] };
        const context = getWindowContextByEventSender(event.sender);
        if (!context || !context.activeTabId) return { main: null, embedded: [] };

        const tabView = context.tabs[context.activeTabId];
        if (!tabView) return { main: null, embedded: [] };

        const domains = getTabNetworkDomains(tabView.webContents.id);
        let mainDomain = '';
        try { mainDomain = new URL(tabView.webContents.getURL()).hostname; } catch (e) { }

        const sessionObj = tabView.webContents.session;
        const result = { main: null, embedded: [] };

        for (const domain of domains) {
            try {
                const cookies = await sessionObj.cookies.get({ domain });
                const count = cookies.length;
                if (count > 0) {
                    if (domain === mainDomain || (mainDomain && domain.endsWith(mainDomain))) {
                        if (!result.main) result.main = { domain, count };
                        else result.main.count += count;
                    } else {
                        result.embedded.push({ domain, count });
                    }
                }
            } catch (e) { /* ignore */ }
        }
        if (!result.main && mainDomain) result.main = { domain: mainDomain, count: 0 };
        return result;
    });

    ipcMain.handle('webauthn:deleteCookies', async (event, domain) => {
        if (!isSenderTrusted(event) || !domain) return false;
        const context = getWindowContextByEventSender(event.sender);
        if (!context || !context.activeTabId) return false;
        const tabView = context.tabs[context.activeTabId];
        if (!tabView) return false;
        const sessionObj = tabView.webContents.session;
        try {
            const cookies = await sessionObj.cookies.get({ domain });
            for (const cookie of cookies) {
                let url = 'http' + (cookie.secure ? 's' : '') + '://' + cookie.domain + cookie.path;
                await sessionObj.cookies.remove(url, cookie.name);
            }
            return true;
        } catch (e) { return false; }
    });

    ipcMain.handle('webauthn:blockCookies', async (event, domain) => {
        if (!isSenderTrusted(event) || !domain) return false;
        addToCookieBlocklist(domain);

        const context = getWindowContextByEventSender(event.sender);
        if (context && context.activeTabId) {
            const tabView = context.tabs[context.activeTabId];
            if (tabView) {
                const sessionObj = tabView.webContents.session;
                try {
                    const cookies = await sessionObj.cookies.get({ domain });
                    for (const cookie of cookies) {
                        let url = 'http' + (cookie.secure ? 's' : '') + '://' + cookie.domain + cookie.path;
                        await sessionObj.cookies.remove(url, cookie.name);
                    }
                } catch (e) { }
            }
        }
        return true;
    });

    // === DIAGNOSTICS & LOGS ===
    ipcMain.on(C.IPC_SEND.APP_LOG, (e, payload = {}) => {
        if (!isSenderTrusted(e)) return;
        const context = getWindowContextByEventSender(e.sender) || getWindowContextByChromeOverlaySender(e.sender);
        const level = payload.level === 'fatal' || payload.level === 'error' || payload.level === 'warn' ? payload.level : 'info';
        const eventName = typeof payload.event === 'string' && payload.event.trim() ? payload.event.trim() : 'renderer:log';
        const data = {
            ...(payload.data && typeof payload.data === 'object' ? payload.data : {}),
            windowId: context?.windowId || null,
            profileId: context?.profileId || null,
            senderUrl: e.senderFrame?.url || e.sender?.getURL?.() || '',
        };
        if (State.appLogger) State.appLogger[level](eventName, data);
    });

    ipcMain.handle(C.IPC_INVOKE.APP_LOG_INFO, (e) => {
        if (!isSenderTrusted(e)) return null;
        return {
            encrypted: true,
            directory: State.appLogger.getLogDir(),
            currentFile: State.appLogger.getCurrentLogFile(),
            retentionDaysApprox: 14,
        };
    });

    ipcMain.handle(C.IPC_INVOKE.APP_LOG_FILES, (e) => {
        if (!isSenderTrusted(e)) return { files: [] };
        return {
            encrypted: true,
            directory: State.appLogger.getLogDir(),
            files: State.appLogger.listLogFiles(),
        };
    });

    ipcMain.handle(C.IPC_INVOKE.APP_LOG_READ, (e, { filePath } = {}) => {
        if (!isSenderTrusted(e)) return { ok: false, error: 'Untrusted sender' };
        try {
            const records = State.appLogger.readEncryptedLogFile(filePath);
            const text = JSON.stringify(records, null, 2);
            return { ok: true, filePath, records, text };
        } catch (error) { return { ok: false, error: error?.message || String(error) }; }
    });

    ipcMain.handle(C.IPC_INVOKE.APP_LOG_REVEAL, (e, { filePath } = {}) => {
        if (!isSenderTrusted(e)) return { ok: false };
        if (!State.appLogger.isLogFilePath(filePath) || !fs.existsSync(filePath)) return { ok: false, error: 'Log file not found' };
        try {
            shell?.showItemInFolder?.(filePath);
            return { ok: true };
        } catch (error) { return { ok: false, error: error?.message || String(error) }; }
    });

    ipcMain.handle(C.IPC_INVOKE.APP_LOG_DELETE, (e, { filePath } = {}) => {
        if (!isSenderTrusted(e)) return { ok: false, error: 'Untrusted sender' };
        if (!State.appLogger.isLogFilePath(filePath)) return { ok: false, error: 'Invalid log file path' };
        const deleted = State.appLogger.deleteLogFile(filePath);
        return { ok: deleted };
    });

    ipcMain.handle(C.IPC_INVOKE.APP_LOG_CLEAR, (e, { since = null } = {}) => {
        if (!isSenderTrusted(e)) return { ok: false, error: 'Untrusted sender' };
        try {
            const result = State.appLogger.clearLogFiles({ since });
            return { ok: true, ...result };
        } catch (error) { return { ok: false, error: error?.message || String(error) }; }
    });

    ipcMain.handle(C.IPC_INVOKE.IDENTITY_DIAG_GET_REPORT, async (e, payload = {}) => {
        if (!isSenderTrusted(e)) return null;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return null;
        const tabId = payload && payload.tabId != null ? String(payload.tabId) : undefined;
        try {
            const report = await resolveIdentityReportForContext(context, tabId, e.sender);
            if (State.appLogger) {
                State.appLogger.info('identity-diag:report-generated', {
                    tabId: report.tabId,
                    profileId: report.profileId,
                    userAgentMatchesConfigured: report.analysis?.userAgentMatchesConfigured,
                });
            }
            return report;
        } catch (err) {
            if (State.appLogger) State.appLogger.error('identity-diag:report-failed', { error: State.appLogger.serializeError(err) });
            return { error: String(err?.message || err), generatedAt: Date.now() };
        }
    });

    ipcMain.handle(C.IPC_INVOKE.COMPAT_GET_REPORT, async (e, payload = {}) => {
        if (!isSenderTrusted(e)) return null;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return null;
        const tabId = payload && payload.tabId != null ? String(payload.tabId) : undefined;
        const report = compatDiagnostics.getReport(tabId);
        let identitySummary = null;
        try {
            const identityReport = await resolveIdentityReportForContext(context, tabId || context.activeTabId, e.sender);
            identitySummary = identityDiagnostics.getCompactSummary(identityReport);
        } catch (_) { identitySummary = null; }
        return { ...report, activeTabId: context.activeTabId, identitySummary };
    });

    ipcMain.handle(C.IPC_INVOKE.COMPAT_CLEAR, (e, payload = {}) => {
        if (!isSenderTrusted(e)) return false;
        const tabId = payload && payload.tabId != null ? String(payload.tabId) : undefined;
        compatDiagnostics.clear(tabId);
        return true;
    });

    ipcMain.handle(C.IPC_INVOKE.DEVTOOLS_UNDOCKED, (e) => {
        if (!isSenderTrusted(e)) return false;
        const { sender } = e;
        if (!sender || sender.isDestroyed()) return false;
        if (sender.isDevToolsOpened()) {
            sender.devToolsWebContents?.focus();
            return true;
        }
        sender.openDevTools({ mode: 'undocked', activate: true });
        return true;
    });

    // === MISC & SESSION ===
    ipcMain.handle(C.IPC_INVOKE.CLIPBOARD_WRITE, (e, { text } = {}) => {
        if (!isSenderTrusted(e)) return false;
        clipboard.writeText(String(text || ''));
        return true;
    });

    ipcMain.handle(C.IPC_INVOKE.APP_RELAUNCH, (e) => {
        if (!isSenderTrusted(e)) return;
        if (State.appLogger) State.appLogger.info('app:relaunch-requested', {});
        app.relaunch();
        app.quit();
    });

    ipcMain.handle(C.IPC_INVOKE.SESSION_LOAD, async (e) => {
        if (!isSenderTrusted(e)) return null;
        const context = getWindowContextByEventSender(e.sender);
        if (!context || context.stealthWindow) return null;

        const { startupBehavior } = settingsService.loadSettings();

        if (startupBehavior === 'clearHistory') {
            try { await State.historyService.clear(context.profileId, { since: null }); } catch (err) { console.error('Failed to clear history on startup:', err); }
            sessionService.clearSessionSnapshot();
            return null;
        }
        if (startupBehavior === 'fresh') {
            sessionService.clearSessionSnapshot();
            return null;
        }

        try {
            const p = sessionService.getSessionPath();
            if (fs.existsSync(p)) {
                const encryption = require('../../encryption');
                const raw = fs.readFileSync(p, 'utf-8');
                const parsed = JSON.parse(raw);
                const decoded = (parsed && parsed.encrypted !== undefined) ? (() => {
                    const dec = encryption.decrypt(parsed);
                    return dec ? JSON.parse(dec) : null;
                })() : parsed;
                if (!decoded) return null;
                if (decoded.schemaVersion === 2 && decoded.windowsById) {
                    return decoded.windowsById[context.windowId] || null;
                }
                if (decoded.tabs) return decoded; // Legacy
                return null;
            }
        } catch (e) { console.error('Failed to load session:', e); }
        return null;
    });

    ipcMain.handle(C.IPC_INVOKE.SESSION_SAVE, (e, data) => {
        if (!isSenderTrusted(e)) return false;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return false;
        if (context.stealthWindow) return true;

        const { startupBehavior } = settingsService.loadSettings();
        if (startupBehavior === 'fresh' || startupBehavior === 'clearHistory') {
            sessionService.clearSessionSnapshot();
            return true;
        }

        try {
            const encryption = require('../../encryption');
            const p = sessionService.getSessionPath();
            const currentRaw = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
            let doc = { schemaVersion: 2, profiles: [], windowsById: {} };
            if (currentRaw) {
                try {
                    const parsed = JSON.parse(currentRaw);
                    const decoded = (parsed && parsed.encrypted !== undefined) ? (() => {
                        const dec = encryption.decrypt(parsed);
                        return dec ? JSON.parse(dec) : null;
                    })() : parsed;
                    if (decoded && typeof decoded === 'object') {
                        if (decoded.schemaVersion === 2) {
                            doc = { schemaVersion: 2, profiles: Array.isArray(decoded.profiles) ? decoded.profiles : [], windowsById: decoded.windowsById || {} };
                        } else if (decoded.tabs) { doc.windowsById = {}; }
                    }
                } catch (_) { }
            }
            doc.windowsById[context.windowId] = {
                profileId: context.profileId,
                tabs: Array.isArray(data?.tabs) ? data.tabs : [],
                activeTabId: data?.activeTabId || null,
            };
            doc.profiles = Array.from(State.profilesById.values()).map((p) => ({
                profileId: p.profileId,
                displayName: p.displayName,
                createdAt: p.createdAt,
                updatedAt: Date.now(),
                hasCustomAvatar: !!p.hasCustomAvatar,
                avatarExt: p.avatarExt || null,
                avatarSource: p.avatarSource === 'preset' || p.avatarSource === 'upload' ? p.avatarSource : null,
            }));
            const payload = encryption.encrypt(JSON.stringify(doc));
            fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf-8');
        } catch (err) { console.error('Failed to save session:', err); }
        return true;
    });

    ipcMain.handle(C.IPC_INVOKE.HISTORY_SEARCH, async (e, payload = {}) => {
        if (!isSenderTrusted(e)) return { items: [], nextCursor: null, hasMore: false };
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return { items: [], nextCursor: null, hasMore: false };
        try { return await State.historyService.search(context.profileId, payload || {}); } catch (error) { console.error('Failed to search history:', error); return { items: [], nextCursor: null, hasMore: false }; }
    });

    ipcMain.handle(C.IPC_INVOKE.HISTORY_SUGGESTIONS, async (e, query) => {
        if (!isSenderTrusted(e)) return [];
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return [];
        try { return await State.historyService.getSuggestions(context.profileId, { query, limit: 8 }); } catch (error) { console.error('Failed to get history suggestions:', error); return []; }
    });

    ipcMain.handle(C.IPC_INVOKE.HISTORY_DELETE_VISITS, async (e, visitIds) => {
        if (!isSenderTrusted(e)) return false;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return false;
        try { return await State.historyService.deleteVisits(context.profileId, visitIds); } catch (error) { console.error('Failed to delete history visits:', error); return false; }
    });

    ipcMain.handle(C.IPC_INVOKE.HISTORY_DELETE_URLS, async (e, urls) => {
        if (!isSenderTrusted(e)) return false;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return false;
        try { return await State.historyService.deleteUrls(context.profileId, urls); } catch (error) { console.error('Failed to delete history URLs:', error); return false; }
    });

    ipcMain.handle(C.IPC_INVOKE.HISTORY_CLEAR, async (e, payload = {}) => {
        if (!isSenderTrusted(e)) return false;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return false;
        try { return await State.historyService.clear(context.profileId, payload || {}); } catch (error) { console.error('Failed to clear history:', error); return false; }
    });

    // === NTP ===
    ipcMain.on(C.IPC_SEND.OMNIBOX_STEAL_FOCUS, (e) => {
        if (!isSenderTrusted(e)) return;
        const context = getWindowContextByEventSender(e.sender);
        if (!context?.activeTabId) return;
        tabManager.sendOmniboxFocusToShell(context, context.activeTabId, true, false);
    });

    ipcMain.handle(C.IPC_INVOKE.NTP_TOP_SITES, async (e) => {
        if (!isSenderTrusted(e)) return [];
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return [];
        try { return await State.historyService.getTopSites(context.profileId, 8); } catch (err) { console.error('Failed to get top sites:', err); return []; }
    });

    // === BOOKMARKS ===
    ipcMain.handle(C.IPC_INVOKE.BOOKMARKS_GET, (e) => {
        if (!isSenderTrusted(e)) return { bar: [] };
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return { bar: [] };
        return bookmarkService.loadBookmarks(context.profileId);
    });

    ipcMain.handle(C.IPC_INVOKE.BOOKMARKS_SAVE, (e, data) => {
        if (!isSenderTrusted(e)) return false;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return false;
        bookmarkService.saveBookmarks(context.profileId, data);
        bookmarkService.broadcastBookmarks(context.profileId);
        return true;
    });

    ipcMain.handle(C.IPC_INVOKE.BOOKMARKS_ADD, (event, item) => {
        if (!isSenderTrusted(event)) return { bar: [] };
        const context = getWindowContextByEventSender(event.sender);
        if (!context) return { bar: [] };
        const data = bookmarkService.loadBookmarks(context.profileId);
        const normUrl = (u) => u.toLowerCase().replace(/\/$/, '');
        const itemNorm = normUrl(item.url || '');

        const removeFromList = (list) => {
            return list.filter(b => {
                if (b.id === item.id) return false;
                if (b.type === 'bookmark' && normUrl(b.url || '') === itemNorm) return false;
                if (b.type === C.BOOKMARK.TYPE_FOLDER && b.children) b.children = removeFromList(b.children);
                return true;
            });
        };
        data.bar = removeFromList(data.bar);
        data.bar.push(item);
        bookmarkService.saveBookmarks(context.profileId, data);
        bookmarkService.broadcastBookmarks(context.profileId);
        return data;
    });

    ipcMain.handle(C.IPC_INVOKE.BOOKMARKS_REMOVE, (event, id) => {
        if (!isSenderTrusted(event)) return { bar: [] };
        const context = getWindowContextByEventSender(event.sender);
        if (!context) return { bar: [] };
        const data = bookmarkService.loadBookmarks(context.profileId);
        const removeFromList = (list) => {
            return list.filter(item => {
                if (item.id === id) return false;
                if (item.type === C.BOOKMARK.TYPE_FOLDER && item.children) item.children = removeFromList(item.children);
                return true;
            });
        };
        data.bar = removeFromList(data.bar);
        bookmarkService.saveBookmarks(context.profileId, data);
        bookmarkService.broadcastBookmarks(context.profileId);
        return data;
    });

    ipcMain.handle(C.IPC_INVOKE.BOOKMARKS_REORDER, (e, bar) => {
        if (!isSenderTrusted(e)) return false;
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return false;
        const data = bookmarkService.loadBookmarks(context.profileId);
        data.bar = bar;
        bookmarkService.saveBookmarks(context.profileId, data);
        bookmarkService.broadcastBookmarks(context.profileId);
        return true;
    });

    ipcMain.handle(C.IPC_INVOKE.BOOKMARKS_ADD_FOLDER, (e, name) => {
        if (!isSenderTrusted(e)) return { bar: [] };
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return { bar: [] };
        const data = bookmarkService.loadBookmarks(context.profileId);
        const folder = { id: 'f-' + Date.now(), type: 'folder', title: name, children: [] };
        data.bar.push(folder);
        bookmarkService.saveBookmarks(context.profileId, data);
        bookmarkService.broadcastBookmarks(context.profileId);
        return data;
    });

    ipcMain.handle(C.IPC_INVOKE.BOOKMARKS_ADD_TO_FOLDER, (e, folderId, item) => {
        if (!isSenderTrusted(e)) return { bar: [] };
        const context = getWindowContextByEventSender(e.sender);
        if (!context) return { bar: [] };
        const data = bookmarkService.loadBookmarks(context.profileId);
        const normUrl = (u) => u.toLowerCase().replace(/\/$/, '');
        const itemNorm = normUrl(item.url || '');

        const removeFromList = (list) => {
            return list.filter(b => {
                if (b.id === item.id) return false;
                if (b.type === 'bookmark' && normUrl(b.url || '') === itemNorm) return false;
                if (b.type === C.BOOKMARK.TYPE_FOLDER && b.children) b.children = removeFromList(b.children);
                return true;
            });
        };
        data.bar = removeFromList(data.bar);

        const findFolder = (list) => {
            for (const b of list) {
                if (b.id === folderId && b.type === C.BOOKMARK.TYPE_FOLDER) return b;
                if (b.type === C.BOOKMARK.TYPE_FOLDER && b.children) {
                    const found = findFolder(b.children);
                    if (found) return found;
                }
            }
            return null;
        };
        const folder = findFolder(data.bar);
        if (folder) {
            folder.children.push(item);
            bookmarkService.saveBookmarks(context.profileId, data);
            bookmarkService.broadcastBookmarks(context.profileId);
        }
        return data;
    });
}

module.exports = { registerIpcHandlers };