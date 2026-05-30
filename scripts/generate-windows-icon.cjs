'use strict';

/**
 * Sync Icon Composer raster exports into renderer/assets/logo and build Windows ICO.
 * Sources: renderer/assets/logo/invisurt.icon/icon.json + Assets/*.png
 * Outputs: renderer/assets/logo/icon.png, icon-dark.png, icon.ico
 *
 * Each raster is scaled to fit inside (1024 * scale) and centered on a 1024² canvas
 * (transparent margins) so Dock / Finder sizing matches Icon Composer grid (~default 0.78).
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const root = path.join(__dirname, '..');
const composerDir = path.join(root, 'renderer', 'assets', 'logo', 'invisurt.icon');
const assetsDir = path.join(composerDir, 'Assets');
const iconJsonPath = path.join(composerDir, 'icon.json');
const outDir = path.join(root, 'renderer', 'assets', 'logo');

const CANVAS_SIZE = 1024;
const DEFAULT_INSET_SCALE = 0.78;

function loadComposerLayers() {
    if (!fs.existsSync(iconJsonPath)) {
        console.error('Missing', iconJsonPath);
        process.exit(1);
    }
    const iconJson = JSON.parse(fs.readFileSync(iconJsonPath, 'utf8'));
    const layers = [];
    for (const group of iconJson.groups || []) {
        for (const layer of group.layers || []) {
            const imageName = layer['image-name'];
            if (!imageName) continue;
            layers.push({
                name: layer.name || '',
                hidden: !!layer.hidden,
                imageName,
                position: layer.position || null,
            });
        }
    }
    return layers;
}

function insetScaleForLayer(layers, imageName) {
    const layer = layers.find((l) => l.imageName === imageName);
    const raw = layer?.position?.scale;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= 1) {
        return raw;
    }
    return DEFAULT_INSET_SCALE;
}

function resolveLightDarkFilenames(layers) {
    const visible = layers.filter((l) => !l.hidden);
    const lightLayer = visible[0] || layers[0];
    if (!lightLayer) {
        console.error('No layers with image-name in icon.json');
        process.exit(1);
    }
    let darkLayer =
        layers.find((l) => l.imageName !== lightLayer.imageName && /dark/i.test(l.name)) ||
        layers.find((l) => l.imageName !== lightLayer.imageName);
    return {
        light: lightLayer.imageName,
        dark: darkLayer ? darkLayer.imageName : null,
    };
}

async function writeInsetPng(srcPath, destPath, scale, label) {
    if (!fs.existsSync(srcPath)) {
        console.error('Missing source file:', srcPath);
        process.exit(1);
    }

    const innerMax = Math.max(2, Math.round(CANVAS_SIZE * scale));

    const resized = await sharp(srcPath)
        .resize(innerMax, innerMax, {
            fit: 'inside',
            kernel: sharp.kernel.lanczos3,
        })
        .ensureAlpha()
        .png()
        .toBuffer();

    const meta = await sharp(resized).metadata();
    const w = meta.width ?? innerMax;
    const h = meta.height ?? innerMax;
    const left = Math.round((CANVAS_SIZE - w) / 2);
    const top = Math.round((CANVAS_SIZE - h) / 2);

    await sharp({
        create: {
            width: CANVAS_SIZE,
            height: CANVAS_SIZE,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
    })
        .composite([{ input: resized, left, top }])
        .png()
        .toFile(destPath);

    console.log('Wrote', destPath, `(${label}, inset scale ${scale})`);
}

async function main() {
    if (!fs.existsSync(assetsDir)) {
        console.error('Missing Assets directory:', assetsDir);
        process.exit(1);
    }

    fs.mkdirSync(outDir, { recursive: true });

    const layers = loadComposerLayers();
    const { light: lightFile, dark: darkFile } = resolveLightDarkFilenames(layers);

    const lightSrc = path.join(assetsDir, lightFile);
    const iconPngPath = path.join(outDir, 'icon.png');
    const lightScale = insetScaleForLayer(layers, lightFile);
    await writeInsetPng(lightSrc, iconPngPath, lightScale, 'light / packaged mac default');

    if (darkFile) {
        const darkSrc = path.join(assetsDir, darkFile);
        const iconDarkPath = path.join(outDir, 'icon-dark.png');
        const darkScale = insetScaleForLayer(layers, darkFile);
        await writeInsetPng(darkSrc, iconDarkPath, darkScale, 'dark / Dock dark mode');
    } else {
        console.warn('No distinct dark layer in icon.json; skipping icon-dark.png');
    }

    const buf = await pngToIco(fs.readFileSync(iconPngPath));
    const icoPath = path.join(outDir, 'icon.ico');
    fs.writeFileSync(icoPath, buf);
    console.log('Wrote', icoPath, '(Windows exe / NSIS)');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
