import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
} from 'react';

const ChromeOverlayContext = createContext(null);
const ChromeShellMenuOverlayContext = createContext(null);

/**
 * Tier 2 (preferred for rich HTML above the tab WebContentsView): a dedicated full-window
 * transparent `WebContentsView` composited above the tab; no detach/snapshot flicker.
 *
 * Tier 1: native `Menu.popup` / `Menu.buildFromTemplate` (simple OS menus).
 * Tier 3 (legacy, migrate away): `TabOverlayContext` + `tabPrepareShellOverlay` (detach + snapshot).
 *
 * Usage: call `await reset()` when taking the surface from another UI (ref-count → 0 in main), then
 * `await acquire()` before first `post()`, `post()` for updates, `await release()` when done.
 * Ignore `chrome-overlay:v1:superseded` while your own `reset()` is in flight (use a short-lived ref).
 */
export function ChromeOverlayProvider({ children }) {
  const reset = useCallback(async () => {
    await window.electronAPI.chromeOverlayV1Reset?.();
  }, []);

  const acquire = useCallback(async () => {
    await window.electronAPI.chromeOverlayV1Acquire?.();
  }, []);

  const release = useCallback(async () => {
    await window.electronAPI.chromeOverlayV1Release?.();
  }, []);

  const post = useCallback(async (payload) => {
    await window.electronAPI.chromeOverlayV1Post?.(payload);
  }, []);

  const shellReset = useCallback(async () => {
    await window.electronAPI.chromeShellMenuOverlayV1Reset?.();
  }, []);

  const shellAcquire = useCallback(async () => {
    await window.electronAPI.chromeShellMenuOverlayV1Acquire?.();
  }, []);

  const shellRelease = useCallback(async () => {
    await window.electronAPI.chromeShellMenuOverlayV1Release?.();
  }, []);

  const shellPost = useCallback(async (payload) => {
    await window.electronAPI.chromeShellMenuOverlayV1Post?.(payload);
  }, []);

  const overlayValue = useMemo(
    () => ({ reset, acquire, release, post }),
    [reset, acquire, release, post],
  );

  const shellMenuValue = useMemo(
    () => ({
      reset: shellReset,
      acquire: shellAcquire,
      release: shellRelease,
      post: shellPost,
    }),
    [shellReset, shellAcquire, shellRelease, shellPost],
  );

  return (
    <ChromeOverlayContext.Provider value={overlayValue}>
      <ChromeShellMenuOverlayContext.Provider value={shellMenuValue}>
        {children}
      </ChromeShellMenuOverlayContext.Provider>
    </ChromeOverlayContext.Provider>
  );
}

export function useChromeOverlay() {
  const ctx = useContext(ChromeOverlayContext);
  if (!ctx) {
    throw new Error('useChromeOverlay must be used within ChromeOverlayProvider');
  }
  return ctx;
}

/** Compact overlay for settings/bookmark/profile menus — isolated from Lens + omnibox overlay. */
export function useChromeShellMenuOverlay() {
  const ctx = useContext(ChromeShellMenuOverlayContext);
  if (!ctx) {
    throw new Error('useChromeShellMenuOverlay must be used within ChromeOverlayProvider');
  }
  return ctx;
}
