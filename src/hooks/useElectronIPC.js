import { useEffect } from 'react';
import { DOM_EVENT } from '../constants/conditionStrings.js';
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
  onTabNewToRight,
  onTabDuplicate,
  onTabMuteSite,
  onTabPin,
  onTabCloseOthers,
  onTabCloseRight,
  onTabMoveNewWindow,
  onTabSearch,
  onCommandPalette,
}) {
  const dispatch = useDispatch();

  useEffect(() => {
    const api = window.electronAPI;
    const notifyShortcutInvoked = () => {
      window.dispatchEvent(new CustomEvent('electron-shortcut-invoked'));
    };
    const withShortcutNotify = (handler) => (...args) => {
      notifyShortcutInvoked();
      handler?.(...args);
    };

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
    api.onShortcutNewTab(withShortcutNotify(() => onNewTab()));
    api.onShortcutHistory(withShortcutNotify(onHistory));
    if (api.onShortcutSettings) api.onShortcutSettings(withShortcutNotify(onSettings));
    api.onShortcutCloseTab(withShortcutNotify(onCloseTab));
    api.onShortcutReload(withShortcutNotify(onReload));
    api.onShortcutSwitchTab(withShortcutNotify(({ direction }) => onSwitchTabDir(direction)));

    if (api.onShortcutTabNewToRight) api.onShortcutTabNewToRight(withShortcutNotify(() => onTabNewToRight?.()));
    if (api.onShortcutTabDuplicate) api.onShortcutTabDuplicate(withShortcutNotify(() => onTabDuplicate?.()));
    if (api.onShortcutTabMuteSite) api.onShortcutTabMuteSite(withShortcutNotify(() => onTabMuteSite?.()));
    if (api.onShortcutTabPin) api.onShortcutTabPin(withShortcutNotify(() => onTabPin?.()));
    if (api.onShortcutTabCloseOthers) api.onShortcutTabCloseOthers(withShortcutNotify(() => onTabCloseOthers?.()));
    if (api.onShortcutTabCloseRight) api.onShortcutTabCloseRight(withShortcutNotify(() => onTabCloseRight?.()));
    if (api.onShortcutTabMoveNewWindow) api.onShortcutTabMoveNewWindow(withShortcutNotify(() => onTabMoveNewWindow?.()));
    if (api.onShortcutTabSearch) api.onShortcutTabSearch(withShortcutNotify(() => onTabSearch?.()));
    if (api.onShortcutCommandPalette) api.onShortcutCommandPalette(withShortcutNotify(() => onCommandPalette?.()));

    // Dispatch a window-level CustomEvent so OmniboxInput can focus itself
    // without needing a prop chain. Mirrors the electron-shortcut-invoked pattern.
    if (api.onOmniboxFocus) {
      api.onOmniboxFocus((data) => {
        window.dispatchEvent(new CustomEvent(DOM_EVENT.OMNIBOX_REQUEST_FOCUS, { detail: data }));
      });
    }

    // Listeners registered once; no cleanup needed (Electron IPC listeners
    // persist for the renderer lifetime and ipcRenderer has no removeListener
    // in the exposed contextBridge API).
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
