import { useLayoutEffect } from 'react';
import {
  resolveAppliedTokens,
  resolveEffectiveDarkFromSettings,
  applyChromeTokensToRoot,
  setForcedAppearanceAttr,
} from '../theme/index.js';

function readPrefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyChromeThemeFromSettings(settings) {
  if (!settings || typeof document === 'undefined') return;
  const prefersDark = readPrefersDark();
  const effectiveDark = resolveEffectiveDarkFromSettings(settings, prefersDark);
  const tokens = resolveAppliedTokens(settings, effectiveDark);
  applyChromeTokensToRoot(document, tokens);
  setForcedAppearanceAttr(document, settings);
}

/** Stealth shells always use default InvSurf dark chrome regardless of profile appearance settings. */
export function applyStealthWindowChrome() {
  if (typeof document === 'undefined') return;
  const settings = {
    colorTheme: 'dark',
    accentTheme: 'default',
    accentCustomHex: null,
  };
  const tokens = resolveAppliedTokens(settings, true);
  applyChromeTokensToRoot(document, tokens);
  setForcedAppearanceAttr(document, settings);
}

/**
 * Keeps semantic chrome CSS variables in sync with settings + OS appearance.
 */
export function useChromeTheme() {
  useLayoutEffect(() => {
    let unsubTheme = null;

    const bootstrap = async () => {
      const api = window.electronAPI;
      if (!api?.settingsGet) return;
      if (typeof window !== 'undefined' && window.__INVISURF_STEALTH_WINDOW__) {
        applyStealthWindowChrome();
        return;
      }
      const settings = await api.settingsGet();
      applyChromeThemeFromSettings(settings);

      if (api.onThemeApply) {
        unsubTheme = api.onThemeApply(({ settings: next }) => {
          if (typeof window !== 'undefined' && window.__INVISURF_STEALTH_WINDOW__) {
            applyStealthWindowChrome();
            return;
          }
          applyChromeThemeFromSettings(next);
        });
      }
    };

    bootstrap();

    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSchemeChange = () => {
      window.electronAPI?.settingsGet?.().then((s) => applyChromeThemeFromSettings(s));
    };
    mq?.addEventListener?.('change', onSchemeChange);

    return () => {
      mq?.removeEventListener?.('change', onSchemeChange);
      if (typeof unsubTheme === 'function') unsubTheme();
    };
  }, []);
}
