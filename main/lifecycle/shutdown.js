
const State = require('../state');
const { cleanupSessionOnlyCookiesForAllProfiles, cleanupStealthCookiesForAllContexts } = require('../services/cookieService');
const { closeDevFileWatchers } = require('../utils/devWatchers');

function handleGracefulShutdown(event, appLogger, app) {
    State.appIsQuitting = true;
    closeDevFileWatchers();

    if (appLogger) {
        appLogger.info('app:before-quit', {
            windowCount: require('electron').BrowserWindow.getAllWindows().length,
            historyClosed: State.appHistoryClosed,
            historyCloseStarted: State.appHistoryCloseStarted,
        });
    }

    if (State.appHistoryClosed && State.appCookieCleanupClosed) return;

    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }

    if (State.appHistoryCloseStarted) return;

    State.appHistoryCloseStarted = true;
    State.appCookieCleanupStarted = true;

    Promise.all([
        State.historyService.closeAll()
            .then(() => {
                State.appHistoryClosed = true;
            }),
        cleanupSessionOnlyCookiesForAllProfiles()
            .then((deleted) => {
                State.appCookieCleanupClosed = true;
                if (deleted > 0 && appLogger) {
                    appLogger.info('cookies:session-only-cleanup', { deleted });
                }
            }),
        cleanupStealthCookiesForAllContexts()
            .then((deleted) => {
                if (deleted > 0 && appLogger) {
                    appLogger.info('cookies:stealth-cleanup', { deleted });
                }
            }),
    ])
        .catch((error) => {
            if (appLogger) {
                appLogger.error('app:shutdown-cleanup-failed', {
                    error: appLogger.serializeError(error),
                });
            }
            console.error('Failed to complete shutdown cleanup:', error);
        })
        .finally(() => {
            try {
                require('../input/GlobalInputController').shutdownGlobalInput();
            } catch (_) { /* ignore */ }

            State.appHistoryClosed = true;
            State.appCookieCleanupClosed = true;

            if (State.appQuitAfterHistoryClose) return;
            State.appQuitAfterHistoryClose = true;

            if (appLogger) {
                appLogger.info('app:cleanup-closed-before-quit', {
                    cookieCleanupStarted: State.appCookieCleanupStarted,
                });
            }
            app.quit();
        });
}

module.exports = {
    handleGracefulShutdown
};