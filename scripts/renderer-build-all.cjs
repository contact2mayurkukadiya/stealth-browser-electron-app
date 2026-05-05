/**
 * Runs the four sequential Vite production builds (same as pre-monorepo npm chain).
 * Rollup cannot combine these into one build while keeping inlineDynamicImports: true.
 *
 * After success, updates `.stealth-renderer-reload` so the Electron dev process reloads once
 * (instead of once per dist write during the four steps).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RELOAD_STAMP = '.stealth-renderer-reload';

const ROOT = path.join(__dirname, '..');
const ENTRIES = ['index', 'history', 'settings', 'profile-picker'];

function runViteBuild(entry) {
    const env = { ...process.env };
    if (entry !== 'index') {
        env.VITE_ENTRY = entry;
    } else {
        delete env.VITE_ENTRY;
    }

    const result = spawnSync('npx', ['vite', 'build'], {
        cwd: ROOT,
        env,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });

    if (result.error) {
        console.error(result.error);
        process.exit(1);
    }
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function main() {
    for (const entry of ENTRIES) {
        runViteBuild(entry);
    }
    const stampPath = path.join(ROOT, RELOAD_STAMP);
    fs.writeFileSync(stampPath, `${Date.now()}\n`);
}

main();
