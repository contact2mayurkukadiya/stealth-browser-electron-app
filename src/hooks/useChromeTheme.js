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
    let cancelled = false;
    let unsubTheme = null;
    let mq = null;
    let onSchemeChange = null;

    (async () => {
      const api = window.electronAPI;
      if (!api?.settingsGet) return;

      let isStealthContext =
        typeof window !== 'undefined' && !!window.__INVISURF_STEALTH_WINDOW__;
      // Shell sets __INVISURF_STEALTH_WINDOW__; tab WebContents (e.g. new tab) must ask main.
      if (!isStealthContext && typeof api.isStealthWindow === 'function') {
        try {
          isStealthContext = !!(await api.isStealthWindow());
        } catch (_) {
          isStealthContext = false;
        }
      }

      if (cancelled) return;

      if (isStealthContext) {
        applyStealthWindowChrome();
        if (api.onThemeApply) {
          unsubTheme = api.onThemeApply(() => {
            applyStealthWindowChrome();
          });
        }
      } else {
        const settings = await api.settingsGet();
        if (cancelled) return;
        applyChromeThemeFromSettings(settings);
        if (api.onThemeApply) {
          unsubTheme = api.onThemeApply(({ settings: next }) => {
            applyChromeThemeFromSettings(next);
          });
        }
      }

      if (cancelled) return;

      mq = window.matchMedia?.('(prefers-color-scheme: dark)');
      onSchemeChange = () => {
        const stealthShell =
          typeof window !== 'undefined' && !!window.__INVISURF_STEALTH_WINDOW__;
        if (stealthShell || isStealthContext) {
          applyStealthWindowChrome();
          return;
        }
        api.settingsGet?.().then((s) => applyChromeThemeFromSettings(s));
      };
      mq?.addEventListener?.('change', onSchemeChange);
    })();

    return () => {
      cancelled = true;
      if (mq && onSchemeChange) {
        mq.removeEventListener?.('change', onSchemeChange);
      }
      if (typeof unsubTheme === 'function') unsubTheme();
    };
  }, []);
}
