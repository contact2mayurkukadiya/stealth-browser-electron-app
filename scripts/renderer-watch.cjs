/**
 * Rebuilds all renderer bundles when sources change (debounced).
 * Invokes scripts/renderer-build-all.cjs; main process reloads once via .stealth-renderer-reload stamp.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const chokidar = require('chokidar');

const ROOT = path.join(__dirname, '..');
const BUILD_ALL = path.join(__dirname, 'renderer-build-all.cjs');

function runBuildAll() {
    const start = Date.now();
    const result = spawnSync(process.execPath, [BUILD_ALL], {
        cwd: ROOT,
        stdio: 'inherit',
    });
    if (result.error) {
        console.error('[renderer-watch]', result.error);
        return;
    }
    if (result.status !== 0) {
        console.error(`[renderer-watch] Build exited with code ${result.status}`);
        return;
    }
    console.log(`[renderer-watch] Rebuilt renderer (${Date.now() - start}ms)`);
}

let debounceTimer = null;
const DEBOUNCE_MS = 250;

function scheduleBuild() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        runBuildAll();
    }, DEBOUNCE_MS);
}

const watcher = chokidar.watch(
    [path.join(ROOT, 'src'), path.join(ROOT, 'vite.config.js')],
    {
        ignoreInitial: true,
        ignored: [/(^|[/\\])\../, '**/node_modules/**'],
    }
);

watcher.on('all', (event, filePath) => {
    if (event !== 'add' && event !== 'change' && event !== 'unlink') return;
    console.log(`[renderer-watch] ${event}: ${path.relative(ROOT, filePath)}`);
    scheduleBuild();
});

console.log('[renderer-watch] Watching src/ and vite.config.js for changes…');
