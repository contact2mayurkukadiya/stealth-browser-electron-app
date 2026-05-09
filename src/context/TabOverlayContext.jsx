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
     * Native WebContentsView stacks above the BrowserWindow shell. Main must capture
     * the tab while it is still visible, then hide it in one handler so no frame shows
     * shell UI (e.g. omnibox autocomplete) behind a full-size tab.
     */
    try {
      let result = null;
      const prep = window.electronAPI.tabPrepareShellOverlay?.();
      if (prep) {
        result = await prep;
      } else {
        await window.electronAPI.tabHideActive?.();
        result = { dataUrl: null };
      }
      if (overlayCountRef.current === 0) return;
      const dataUrl = result?.dataUrl ?? null;
      if (dataUrl) setTabSnapshotDataUrl(dataUrl);
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
