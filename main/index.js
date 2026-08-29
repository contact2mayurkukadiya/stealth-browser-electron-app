const { app, session, nativeTheme, protocol } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Scheme must be registered synchronously before the app is ready (CRITICAL FIX FOR WHITE SCREEN)
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }
]);

const encryption = require('../encryption');
const { createAppLogger } = require('../appLogger');
const { HistoryService } = require('../historyService');
const C = require('../src/constants/conditionStrings.cjs');

// Import Architecture Subsystems
const State = require('./state');
const { registerIpcHandlers } = require('./ipc/ipcRegistry');
const windowManager = require('./windows/windowManager');
const settingsService = require('./services/settingsService');
const profileService = require('./services/profileService');
const sessionService = require('./services/sessionService');
const devWatchers = require('./utils/devWatchers');
const networkService = require('./services/networkService');

// Setup Boot Sequence Integrations
const { configureAppPaths } = require('../runtime/appPaths');
const { configureBrowserIdentity, logStartupIdentity } = require('../runtime/browserIdentity');
const { configureProductionGuards } = require('../runtime/windowSecurity');
const { setupWebAuthn } = require('../runtime/webauthn');

// Initialize Process Event Handlers (Uncaught exceptions / rejections)
require('./lifecycle/processHandlers').setupProcessHandlers(app, State.appLogger);

// 1. Configure Globals & App Paths early
configureAppPaths(app);
configureBrowserIdentity(app);

State.appLogger = createAppLogger({ app, encryptionModule: encryption });
configureProductionGuards(app, State.appLogger);

// Initialize primary history service
State.historyService = new HistoryService({ app, encryptionModule: encryption });

function applyDockIconForSystemAppearance() {
    if (process.platform !== 'darwin' || !app.dock || !nativeTheme) return;
    if (app.isPackaged) return;
    const iconFile = nativeTheme.shouldUseDarkColors ? 'icon-dark.png' : 'icon.png';
    const dockIconPath = path.join(app.getAppPath(), 'renderer', 'assets', 'logo', iconFile);
    if (!fs.existsSync(dockIconPath)) return;
    try {
        app.dock.setIcon(dockIconPath);
    } catch (error) {
        console.warn('Could not set Dock icon:', error?.message || error);
    }
}

// 2. App Ready Lifecycle
app.whenReady().then(async () => {
    setupWebAuthn();
    State.appLogger.info('app:ready', {
        logDir: State.appLogger.getLogDir(),
        logFile: State.appLogger.getCurrentLogFile(),
        isPackaged: app.isPackaged,
    });

    networkService.registerAppProtocolForSession(session.defaultSession, 'default');
    networkService.installSessionNetworkGuards(session.defaultSession, { profileId: State.defaultProfileId, isStealthSession: false });
    logStartupIdentity(app, State.appLogger);

    settingsService.applyColorThemeFromSettings();

    if (process.platform === 'darwin' && app.dock && nativeTheme && !app.isPackaged) {
        applyDockIconForSystemAppearance();
        nativeTheme.on('updated', applyDockIconForSystemAppearance);
    }

    const existingProfiles = profileService.loadProfiles();
    if (existingProfiles.length > 0) {
        for (const profile of existingProfiles) {
            profileService.ensureProfile(profile.profileId, profile.displayName);
            const sid = String(profile.profileId || '').trim().replace(/[^a-zA-Z0-9-_]/g, '_');
            const p = State.profilesById.get(sid);
            if (p) {
                if (profile.displayName) p.displayName = profile.displayName;
                if (typeof profile.createdAt === 'number') p.createdAt = profile.createdAt;
                if (typeof profile.updatedAt === 'number') p.updatedAt = profile.updatedAt;
                p.hasCustomAvatar = !!profile.hasCustomAvatar;
                p.avatarExt = profile.avatarExt || null;
                p.avatarSource = profile.avatarSource === 'preset' || profile.avatarSource === 'upload' ? profile.avatarSource : null;
            }
        }
    } else {
        profileService.ensureProfile(`profile-${crypto.randomUUID()}`, 'Default');
        profileService.saveProfiles();
    }

    for (const profile of State.profilesById.values()) {
        try {
            const result = await State.historyService.migrateOldHistory(profile.profileId);
            if (result.didRun) {
                console.log(`Migrated history for ${profile.profileId}: ${result.migrated} rows, ${result.skipped} skipped`);
            }
        } catch (error) {
            console.error(`Failed to migrate history for ${profile.profileId}:`, error);
        }
    }

    State.startupSessionDoc = sessionService.readDecodedSessionDoc();
    registerIpcHandlers();
    windowManager.createProfilePickerWindow();

    if (!app.isPackaged) {
        devWatchers.startWatchers(app);
    }
});

// 3. App Event Lifecycle
app.on('activate', () => {
    if (process.platform !== C.PLATFORM.DARWIN) return;
    if (State.appIsQuitting) return;
    if (State.windowContextsById.size > 0) return;
    if (State.profilePickerWindow && !State.profilePickerWindow.isDestroyed()) {
        State.profilePickerWindow.show();
        State.profilePickerWindow.focus();
        return;
    }
    windowManager.createProfilePickerWindow();
});

app.on('window-all-closed', () => {
    if (process.platform === C.PLATFORM.DARWIN) return;
    if (!State.appIsQuitting) app.quit();
});

app.on('before-quit', (event) => {
    require('./lifecycle/shutdown').handleGracefulShutdown(event, State.appLogger, app);
});