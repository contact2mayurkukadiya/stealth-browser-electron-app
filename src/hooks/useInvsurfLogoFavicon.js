import { useEffect, useSyncExternalStore } from 'react';
import {
  logoIcognitoLightSvg,
  logoPurpleDarkSvg,
  logoPurpleLightSvg,
} from '../constants/appAssetUrls';

function readEffectiveDark() {
  if (typeof document === 'undefined') return false;
  const forced = document.documentElement.getAttribute('data-forced-appearance');
  if (forced === 'dark') return true;
  if (forced === 'light') return false;
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getLogoFaviconUrl() {
  return readEffectiveDark() ? logoPurpleDarkSvg : logoPurpleLightSvg;
}

function subscribe(onStoreChange) {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onMq = () => onStoreChange();
  mq.addEventListener('change', onMq);
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-forced-appearance'],
  });
  return () => {
    mq.removeEventListener('change', onMq);
    observer.disconnect();
  };
}

/**
 * Theme-aware InvSurf logo URL for tab/document favicons (light UI → purple-light.svg, dark → purple-dark.svg).
 */
export function useInvsurfLogoFaviconUrl() {
  return useSyncExternalStore(subscribe, getLogoFaviconUrl, () => logoPurpleLightSvg);
}

/**
 * Keeps `<link rel="icon">` in sync with chrome theme on internal pages (NTP, History, Settings).
 * Pass `isStealthNtp` from {@link window.electronAPI.isStealthWindow} for the new-tab page — tab
 * WebContents do not set `__INVISURF_STEALTH_WINDOW__` (shell-only).
 */
export function useInvsurfDocumentFavicon(isStealthNtpFromTab) {
  const themeHref = useInvsurfLogoFaviconUrl();
  const isStealthShell =
    typeof isStealthNtpFromTab === 'boolean'
      ? isStealthNtpFromTab
      : typeof window !== 'undefined' && !!window.__INVISURF_STEALTH_WINDOW__;
  const href = isStealthShell ? logoIcognitoLightSvg : themeHref;
  useEffect(() => {
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = href;
  }, [href]);
}
