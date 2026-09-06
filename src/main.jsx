import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store/store';
import App from './App';
import './index.css';
import { applyChromeThemeFromSettings, applyStealthWindowChrome } from './hooks/useChromeTheme';

const SETTINGS_FALLBACK = {
  colorTheme: 'automatic',
  accentTheme: 'default',
  accentCustomHex: null,
};

/**
 * Apply accent + brightness tokens before React mounts so first paint never shows
 * dark-toolbar defaults on a light chrome strip (white icons on white).
 */
async function bootstrapShellTheme() {
  try {
    const api = window.electronAPI;
    const bootstrap = api?.windowGetBootstrap ? await api.windowGetBootstrap() : null;
    if (bootstrap) {
      window.__APP_BOOTSTRAP = bootstrap;
    }
    if (bootstrap?.ghostWindow) {
      window.__INVISURF_GHOST_WINDOW__ = true;
    }
    if (bootstrap?.stealthWindow) {
      window.__INVISURF_STEALTH_WINDOW__ = true;
      applyStealthWindowChrome();
      return;
    }
    if (api?.settingsGet) {
      const s = await api.settingsGet();
      applyChromeThemeFromSettings(s && typeof s === 'object' ? s : SETTINGS_FALLBACK);
    } else {
      applyChromeThemeFromSettings(SETTINGS_FALLBACK);
    }
  } catch {
    applyChromeThemeFromSettings(SETTINGS_FALLBACK);
  }
}

async function bootstrap() {
  await bootstrapShellTheme();

  const container = document.getElementById('root');
  const root = createRoot(container);
  root.render(
    <Provider store={store}>
      <App />
    </Provider>,
  );
}

bootstrap();
