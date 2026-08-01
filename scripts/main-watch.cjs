/**
 * Monitors Main process, Runtime, Preload, and root Node files.
 * Automatically restarts the Electron process in the terminal runner without crashing or orphaning.
 */
const { spawn } = require('child_process');
const path = require('path');
const chokidar = require('chokidar');

const ROOT = path.join(__dirname, '..');

const WATCH_PATHS = [
    path.join(ROOT, 'main'),
    path.join(ROOT, 'runtime'),
    path.join(ROOT, 'preload.js'),
    path.join(ROOT, 'appLogger.js'),
    path.join(ROOT, 'historyService.js'),
    path.join(ROOT, 'encryption.js'),
    path.join(ROOT, 'compatibilityDiagnostics.js'),
    path.join(ROOT, 'package.json'),
];

let electronProcess = null;
let isRestarting = false;
let restartTimer = null;

function getElectronExecPath() {
    try {
        return require('electron');
    } catch (_) {
        return 'electron';
    }
}

function startElectron() {
    const electronBinary = getElectronExecPath();
    console.log('[main-watch] Starting Electron process...');

    electronProcess = spawn(electronBinary, ['--inspect=9229', '.'], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });

    electronProcess.on('exit', (code, signal) => {
        if (!isRestarting) {
            console.log(`[main-watch] Electron process exited (code: ${code}, signal: ${signal})`);
            process.exit(code || 0);
        }
    });
}

function restartElectron() {
    if (isRestarting) return;
    isRestarting = true;

    console.log('[main-watch] Main/Runtime change detected. Restarting Electron...');

    const procToKill = electronProcess;
    electronProcess = null;

    if (procToKill && !procToKill.killed) {
        procToKill.removeAllListeners('exit');

        let fallbackTimeout = null;

        const onProcExit = () => {
            if (fallbackTimeout) clearTimeout(fallbackTimeout);
            isRestarting = false;
            startElectron();
        };

        procToKill.once('exit', onProcExit);

        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            try { execSync(`taskkill /pid ${procToKill.pid} /T /F`); } catch (_) { }
        } else {
            procToKill.kill('SIGTERM');
            fallbackTimeout = setTimeout(() => {
                if (!procToKill.killed) {
                    try { procToKill.kill('SIGKILL'); } catch (_) { }
                }
            }, 1000);
        }
    } else {
        isRestarting = false;
        startElectron();
    }
}

function scheduleRestart() {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
        restartTimer = null;
        restartElectron();
    }, 250);
}

const watcher = chokidar.watch(WATCH_PATHS, {
    ignoreInitial: true,
    ignored: [/(^|[/\\])\../, '**/node_modules/**', '**/renderer/dist/**'],
});

watcher.on('all', (event, filePath) => {
    if (event !== 'add' && event !== 'change' && event !== 'unlink') return;
    console.log(`[main-watch] ${event}: ${path.relative(ROOT, filePath)}`);
    scheduleRestart();
});

console.log('[main-watch] Watching main/, runtime/, preload.js, and root Node files for changes...');
startElectron();
