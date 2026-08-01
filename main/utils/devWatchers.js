
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
        const chokidar = require('chokidar');
        const rootDir = process.cwd();

        // Watch Renderer Stamp for WebContents Reload when React code is rebuilt
        const rendererReloadStamp = path.join(rootDir, '.stealth-renderer-reload');
        if (!fs.existsSync(rendererReloadStamp)) {
            fs.writeFileSync(rendererReloadStamp, '');
        }

        const stampWatcher = chokidar.watch(rendererReloadStamp, { ignoreInitial: true });
        stampWatcher.on('change', () => {
            for (const win of BrowserWindow.getAllWindows()) {
                if (win.isDestroyed()) continue;
                win.webContents.reloadIgnoringCache();
            }
        });

        State.devFileWatchers.push(stampWatcher);
    } catch (err) {
        console.error('Dev file watch error:', err);
    }
}

module.exports = {
    startWatchers,
    closeDevFileWatchers
};