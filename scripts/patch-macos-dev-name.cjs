/**
 * Automatically patches node_modules/electron/dist/Electron.app Info.plist on macOS
 * so that the top macOS menu bar and active application name display "InviSurf"
 * instead of "Electron" during local development.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function patchMacDevName() {
    if (process.platform !== 'darwin') {
        return;
    }

    const appBundlePath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app');
    const plistPath = path.join(appBundlePath, 'Contents', 'Info.plist');

    if (!fs.existsSync(plistPath)) {
        return;
    }

    const APP_NAME = 'InviSurf';

    try {
        execFileSync('plutil', ['-replace', 'CFBundleName', '-string', APP_NAME, plistPath], { stdio: 'ignore' });
        execFileSync('plutil', ['-replace', 'CFBundleDisplayName', '-string', APP_NAME, plistPath], { stdio: 'ignore' });
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', appBundlePath], { stdio: 'ignore' });
        console.log(`[postinstall] Successfully patched local Electron.app bundle name to "${APP_NAME}".`);
    } catch (err) {
        console.warn(`[postinstall] Warning: Failed to patch dev Electron.app bundle name:`, err?.message || err);
    }
}

patchMacDevName();
