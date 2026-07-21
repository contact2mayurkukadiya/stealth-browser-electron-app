
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const State = require('../state');

function closeDevFileWatchers() {
    for (const watcher of State.devFileWatchers) {
        try { watcher.close(); } catch (_) { }
    }
    State.devFileWatchers.length = 0;
}

function startWatchers(app) {
    if (app.isPackaged) return;

    try {
        require('electron-reloader')(module, {
            debug: false,
            // Only main-process module graph — cwd-wide watch + ignore was unreliable for renderer/dist (e.g. CSS).
            watchRenderer: false,
        });
    } catch (err) {
        console.error('Hot reload error:', err);
    }

    try {
        const chokidar = require('chokidar');
        let preloadRelaunchScheduled = false;

        State.devFileWatchers.push(
            chokidar
                .watch(path.join(process.cwd(), 'preload.js'), { ignoreInitial: true })
                .on('change', () => {
                    if (preloadRelaunchScheduled) return;
                    preloadRelaunchScheduled = true;
                    app.relaunch();
                    app.quit();
                })
        );

        // One reload after all four Vite steps finish (see scripts/renderer-build-all.cjs).
        const rendererReloadStamp = path.join(process.cwd(), '.stealth-renderer-reload');
        if (!fs.existsSync(rendererReloadStamp)) {
            fs.writeFileSync(rendererReloadStamp, '');
        }

        State.devFileWatchers.push(
            chokidar
                .watch(rendererReloadStamp, { ignoreInitial: true })
                .on('change', () => {
                    for (const win of BrowserWindow.getAllWindows()) {
                        if (win.isDestroyed()) continue;
                        win.webContents.reloadIgnoringCache();
                    }
                })
        );
    } catch (err) {
        console.error('Dev file watch error:', err);
    }
}

module.exports = {
    startWatchers,
    closeDevFileWatchers
};