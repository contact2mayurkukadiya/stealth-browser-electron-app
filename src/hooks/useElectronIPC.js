import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { updateTab, updateTabUrl } from '../store/browserSlice';

/**
 * Registers all Electron IPC listeners for the lifetime of the app.
 * Replaces all the window.electronAPI.onXxx() calls that were scattered
 * through ui.js and bookmarks.js.
 */
export function useElectronIPC({
  onNewTab,
  onTabCreated,
  onTabSwitched,
  onTabAwoken,
  onCloseTab,
  onReload,
  onSwitchTabDir,
  onHistory,
  onSettings,
}) {
  const dispatch = useDispatch();

  useEffect(() => {
    const api = window.electronAPI;

    // ── Tab metadata pushed from main process ────────────────────────────
    api.onTabUpdate((data) => {
      dispatch(updateTab(data));
    });

    api.onUrlChanged(({ id, url }) => {
      dispatch(updateTabUrl({ id, url }));
    });

    api.onTabCreated((data) => {
      onTabCreated(data);
    });

    api.onTabSwitched(({ id }) => {
      onTabSwitched(id);
    });

    // Fired when a sleeping tab's WebContentsView is created on first activation.
    if (api.onTabAwoken) {
      api.onTabAwoken(({ id }) => onTabAwoken(id));
    }

    // ── Keyboard shortcut IPC ────────────────────────────────────────────
    api.onShortcutNewTab(() => onNewTab(false));
    api.onShortcutNewStealthTab(() => onNewTab(true));
    api.onShortcutHistory(onHistory);
    if (api.onShortcutSettings) api.onShortcutSettings(onSettings);
    api.onShortcutCloseTab(onCloseTab);
    api.onShortcutReload(onReload);
    api.onShortcutSwitchTab(({ direction }) => onSwitchTabDir(direction));

    // Listeners registered once; no cleanup needed (Electron IPC listeners
    // persist for the renderer lifetime and ipcRenderer has no removeListener
    // in the exposed contextBridge API).
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
