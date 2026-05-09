import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const TabOverlayContext = createContext(null);

function doubleRaf() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

/**
 * Ref-counted tab snapshot + hide so shell modals/menus paint above WebContentsView.
 * beginOverlay/endOverlay must be paired; forceResetOverlay clears on window close/reload.
 */
export function TabOverlayProvider({ children }) {
  const [tabSnapshotDataUrl, setTabSnapshotDataUrl] = useState(null);
  const overlayCountRef = useRef(0);

  const endOverlay = useCallback(() => {
    if (overlayCountRef.current === 0) return;
    overlayCountRef.current -= 1;
    if (overlayCountRef.current === 0) {
      setTabSnapshotDataUrl(null);
      window.electronAPI.tabRestoreActive?.();
    }
  }, []);

  const beginOverlay = useCallback(async () => {
    const wasZero = overlayCountRef.current === 0;
    overlayCountRef.current += 1;
    if (!wasZero) return;

    /**
     * On app:// tabs (including the local NTP), capturePage may be slow, empty, or stall.
     * We must not defer tabHideActive until capture completes — native WebContentsView
     * would stay on top and hide the omnibox dropdown behind the tab.
     *
     * Freeze-frame is best-effort: wait briefly for snapshot, then always hide.
     */
    const snapshotSoon = async () => {
      try {
        const snapPromise = window.electronAPI.tabCaptureActiveSnapshot?.();
        if (!snapPromise) return null;
        const result = await Promise.race([
          snapPromise,
          new Promise(resolve => setTimeout(() => resolve({ dataUrl: null }), 100)),
        ]);
        return result?.dataUrl ?? null;
      } catch {
        return null;
      }
    };

    try {
      const dataUrl = await snapshotSoon();
      if (overlayCountRef.current === 0) return;
      setTabSnapshotDataUrl(dataUrl);
      await doubleRaf();
      if (overlayCountRef.current === 0) return;
      await window.electronAPI.tabHideActive?.();
    } catch (err) {
      console.error('beginOverlay', err);
      endOverlay();
    }
  }, [endOverlay]);

  const forceResetOverlay = useCallback(() => {
    overlayCountRef.current = 0;
    setTabSnapshotDataUrl(null);
    window.electronAPI.tabRestoreActive?.();
  }, []);

  useEffect(() => {
    document.body.classList.toggle('tab-snapshot-active', !!tabSnapshotDataUrl);
    return () => document.body.classList.remove('tab-snapshot-active');
  }, [tabSnapshotDataUrl]);

  useEffect(() => {
    const onUnload = () => {
      forceResetOverlay();
    };
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('pagehide', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('pagehide', onUnload);
      forceResetOverlay();
    };
  }, [forceResetOverlay]);

  const value = useMemo(
    () => ({
      beginOverlay,
      endOverlay,
      forceResetOverlay,
    }),
    [beginOverlay, endOverlay, forceResetOverlay],
  );

  return (
    <TabOverlayContext.Provider value={value}>
      {tabSnapshotDataUrl ? (
        <div className="tab-content-snapshot" aria-hidden>
          <img src={tabSnapshotDataUrl} alt="" draggable={false} />
        </div>
      ) : null}
      {children}
    </TabOverlayContext.Provider>
  );
}

export function useTabOverlay() {
  const ctx = useContext(TabOverlayContext);
  if (!ctx) {
    throw new Error('useTabOverlay must be used within TabOverlayProvider');
  }
  return ctx;
}
