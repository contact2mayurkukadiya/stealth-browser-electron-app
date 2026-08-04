import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const sharedPlugins = [
    react(),
    {
        name: 'remove-module-crossorigin',
        transformIndexHtml(html) {
            return html.replace(/ type="module" crossorigin/g, ' defer');
        },
    },
];

function rollupOutput() {
    return {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
    };
}

// One entry per build: Rollup forbids inlineDynamicImports with multiple inputs in a single build.
const entry = process.env.VITE_ENTRY || 'index';

const configs = {
    index: {
        root: 'src',
        base: './',
        plugins: sharedPlugins,
        build: {
            outDir: path.resolve(__dirname, 'renderer', 'dist'),
            emptyOutDir: true,
            assetsDir: 'assets',
            target: 'esnext',
            rollupOptions: {
                input: path.resolve(__dirname, 'src', 'index.html'),
                output: rollupOutput(),
            },
        },
    },
    history: {
        root: 'src',
        base: './',
        plugins: sharedPlugins,
        build: {
            outDir: path.resolve(__dirname, 'renderer', 'dist'),
            emptyOutDir: false,
            assetsDir: 'assets',
            target: 'esnext',
            rollupOptions: {
                input: path.resolve(__dirname, 'src', 'history.html'),
                output: rollupOutput(),
            },
        },
    },
    bookmark: {
        root: 'src',
        base: './',
        plugins: sharedPlugins,
        build: {
            outDir: path.resolve(__dirname, 'renderer', 'dist'),
            emptyOutDir: false,
            assetsDir: 'assets',
            target: 'esnext',
            rollupOptions: {
                input: path.resolve(__dirname, 'src', 'bookmark.html'),
                output: rollupOutput(),
            },
        },
    },
    settings: {
        root: 'src',
        base: './',
        plugins: sharedPlugins,
        build: {
            outDir: path.resolve(__dirname, 'renderer', 'dist'),
            emptyOutDir: false,
            assetsDir: 'assets',
            target: 'esnext',
            rollupOptions: {
                input: path.resolve(__dirname, 'src', 'settings.html'),
                output: rollupOutput(),
            },
        },
    },
    'profile-picker': {
        root: 'src',
        base: './',
        plugins: sharedPlugins,
        build: {
            outDir: path.resolve(__dirname, 'renderer', 'dist'),
            emptyOutDir: false,
            assetsDir: 'assets',
            target: 'esnext',
            rollupOptions: {
                input: path.resolve(__dirname, 'src', 'profile-picker.html'),
                output: rollupOutput(),
            },
        },
    },
    newtab: {
        root: 'src',
        base: './',
        plugins: sharedPlugins,
        build: {
            outDir: path.resolve(__dirname, 'renderer', 'dist'),
            emptyOutDir: false,
            assetsDir: 'assets',
            target: 'esnext',
            rollupOptions: {
                input: path.resolve(__dirname, 'src', 'newtab.html'),
                output: rollupOutput(),
            },
        },
    },
};

export default defineConfig(configs[entry]);
