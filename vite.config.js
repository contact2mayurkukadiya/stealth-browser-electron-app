import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Shared plugin list
const sharedPlugins = [
  react(),
  {
    name: 'remove-module-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/ type="module" crossorigin/g, ' defer');
    },
  },
];

// Single shared rollup output format for Electron CSP compliance
function rollupOutput() {
  return {
    format: 'iife',
    inlineDynamicImports: true,
    entryFileNames: 'assets/[name].js',
    chunkFileNames: 'assets/[name].js',
    assetFileNames: 'assets/[name].[ext]',
  };
}

// Build mode: 'index' (default) or 'history' (set via env VITE_ENTRY)
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
      emptyOutDir: false, // keep existing index build output
      assetsDir: 'assets',
      target: 'esnext',
      rollupOptions: {
        input: path.resolve(__dirname, 'src', 'history.html'),
        output: rollupOutput(),
      },
    },
  },
};

export default defineConfig(configs[entry]);
