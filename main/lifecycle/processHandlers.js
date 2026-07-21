function setupProcessHandlers(app, appLogger) {
    process.on('uncaughtException', (error) => {
        const message = error?.stack || error?.message || String(error);
        if (appLogger) {
            appLogger.fatal('main:uncaught-exception', {
                error: appLogger.serializeError(error),
                logFile: appLogger.getCurrentLogFile(),
            });
        }
        try {
            const electronDialog = require('electron').dialog;
            if (electronDialog && typeof electronDialog.showErrorBox === 'function') {
                electronDialog.showErrorBox('Fatal Application Error', message);
            } else {
                console.error('Fatal Application Error:', message);
            }
        } catch {
            console.error('Fatal Application Error:', message);
        }
        if (app && typeof app.quit === 'function') {
            app.quit();
        }
    });

    process.on('unhandledRejection', (reason) => {
        if (appLogger) {
            appLogger.error('main:unhandled-rejection', {
                error: appLogger.serializeError(reason),
            });
        }
    });

    if (app && typeof app.on === 'function') {
        app.on('render-process-gone', (_event, contents, details) => {
            if (appLogger) {
                appLogger.error('electron:render-process-gone', {
                    reason: details?.reason,
                    exitCode: details?.exitCode,
                    webContentsId: contents?.id,
                    url: contents && !contents.isDestroyed?.() ? contents.getURL?.() : '',
                });
            }
        });

        app.on('child-process-gone', (_event, details) => {
            if (appLogger) {
                appLogger.error('electron:child-process-gone', {
                    type: details?.type,
                    reason: details?.reason,
                    exitCode: details?.exitCode,
                    serviceName: details?.serviceName,
                    name: details?.name,
                });
            }
        });
    }
}

module.exports = {
    setupProcessHandlers
};