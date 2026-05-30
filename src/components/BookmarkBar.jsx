import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setBookmarks } from '../store/bookmarksSlice';
import { useChromeShellMenuOverlay } from '../context/ChromeOverlayContext';
import BookmarkItem from './BookmarkItem';
import { addFolderSvg } from '../constants/appAssetUrls';
import { BOOKMARK, OVERLAY, KEYBOARD } from '../constants/conditionStrings.js';

const ADD_FOLDER_ICON = (
  <img className="chrome-toolbar-icon-img" src={addFolderSvg} width={16} height={16} alt="" />
);

/** Resolve a folder node anywhere in the bookmark tree (bar root or nested). */
function findFolderInBookmarkTree(nodes, folderId) {
  if (!Array.isArray(nodes) || !folderId) return null;
  for (const node of nodes) {
    if (!node) continue;
    if (node.type === BOOKMARK.TYPE_FOLDER && node.id === folderId) return node;
    if (node.type === BOOKMARK.TYPE_FOLDER && node.children?.length) {
      const sub = findFolderInBookmarkTree(node.children, folderId);
      if (sub) return sub;
    }
  }
  return null;
}

export default function BookmarkBar({ currentTabId }) {
  const dispatch = useDispatch();
  const bookmarksData = useSelector(s => s.bookmarks.data);
  const bookmarksBarRef = useRef(bookmarksData.bar);
  bookmarksBarRef.current = bookmarksData.bar;

  const { reset, acquire, release, post } = useChromeShellMenuOverlay();

  const [showFolderPrompt, setShowFolderPrompt] = useState(false);
  const [folderName, setFolderName] = useState('');
  const folderInputRef = useRef(null);
  const dragSrcIdRef = useRef(null);
  /** True while this bar's `reset()` is in flight so we ignore self-triggered superseded. */
  const pendingOwnBookmarkResetRef = useRef(false);
  /** True after successful acquire for bookmark context menu until dismiss/action/superseded. */
  const bookmarkMenuActiveRef = useRef(false);
  const pendingOwnFolderResetRef = useRef(false);
  const folderMenuActiveRef = useRef(false);
  const folderMenuSessionFolderIdRef = useRef(null);

  useEffect(() => {
    if (showFolderPrompt && folderInputRef.current) {
      folderInputRef.current.focus();
    }
  }, [showFolderPrompt]);

  const handleNavigate = useCallback((url) => {
    if (currentTabId) window.electronAPI.navigate(currentTabId, url, { source: 'bookmark' });
  }, [currentTabId]);

  const dismissBookmarkOverlay = useCallback(async () => {
    if (!bookmarkMenuActiveRef.current) return;
    bookmarkMenuActiveRef.current = false;
    try {
      await release();
    } catch (err) {
      console.error('bookmark overlay release', err);
    }
  }, [release]);

  const dismissFolderOverlay = useCallback(async () => {
    if (!folderMenuActiveRef.current) return;
    folderMenuActiveRef.current = false;
    folderMenuSessionFolderIdRef.current = null;
    try {
      await release();
    } catch (err) {
      console.error('bookmark folder overlay release', err);
    }
  }, [release]);

  const dismissFolderMenuOnDrag = useCallback(() => {
    if (folderMenuActiveRef.current) {
      void dismissFolderOverlay();
    }
  }, [dismissFolderOverlay]);

  const applyBookmarkMenuAction = useCallback(
    (bookmarkItemId, id) => {
      const target = bookmarksData.bar.find((b) => b.id === bookmarkItemId);
      if (!target) return;
      if (id === BOOKMARK.MENU_OPEN && target.type !== BOOKMARK.TYPE_FOLDER) {
        handleNavigate(target.url);
        return;
      }
      if (id === BOOKMARK.MENU_REMOVE) {
        void (async () => {
          try {
            const next = await window.electronAPI.bookmarksRemove(bookmarkItemId);
            dispatch(setBookmarks(next));
          } catch (err) {
            console.error('bookmark remove from context menu', err);
          }
        })();
      }
    },
    [bookmarksData.bar, handleNavigate, dispatch],
  );

  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlayV1HostEvent?.((data) => {
      const t = data?.type;
      if (t === OVERLAY.DISMISS) {
        if (bookmarkMenuActiveRef.current) void dismissBookmarkOverlay();
        if (folderMenuActiveRef.current) void dismissFolderOverlay();
        return;
      }
      if (t === OVERLAY.BOOKMARK_FOLDER_PICK) {
        if (!folderMenuActiveRef.current) return;
        const folderId = data?.folderId;
        const itemId = data?.itemId;
        if (!folderId || !itemId) {
          void dismissFolderOverlay();
          return;
        }
        const folder = findFolderInBookmarkTree(bookmarksBarRef.current, folderId);
        const child = folder && Array.isArray(folder.children)
          ? folder.children.find((c) => c.id === itemId)
          : null;
        if (child?.type === BOOKMARK.TYPE_BOOKMARK && child.url) {
          handleNavigate(child.url);
        }
        void dismissFolderOverlay();
        return;
      }
      if (t === OVERLAY.BOOKMARK_MENU) {
        if (!bookmarkMenuActiveRef.current) return;
        const { bookmarkItemId, id } = data || {};
        if (!bookmarkItemId || !id) {
          void dismissBookmarkOverlay();
          return;
        }
        applyBookmarkMenuAction(bookmarkItemId, id);
        void dismissBookmarkOverlay();
      }
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, [dismissBookmarkOverlay, dismissFolderOverlay, applyBookmarkMenuAction, handleNavigate]);

  useEffect(() => {
    const unsub = window.electronAPI?.onChromeShellMenuOverlaySuperseded?.(() => {
      if (pendingOwnBookmarkResetRef.current || pendingOwnFolderResetRef.current) return;
      if (bookmarkMenuActiveRef.current) bookmarkMenuActiveRef.current = false;
      if (folderMenuActiveRef.current) {
        folderMenuActiveRef.current = false;
        folderMenuSessionFolderIdRef.current = null;
      }
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, []);

  const openBookmarkContextMenu = useCallback(
    async (e, item, isFolder) => {
      const api = window.electronAPI;
      if (!api?.chromeShellMenuOverlayV1Reset) return;
      const menuItems = [];
      if (!isFolder) {
        menuItems.push({ type: 'item', id: 'openBookmark', label: 'Open', enabled: true });
      }
      menuItems.push({
        type: 'item',
        id: 'removeBookmark',
        label: isFolder ? 'Delete folder' : 'Remove bookmark',
        enabled: true,
      });
      pendingOwnBookmarkResetRef.current = true;
      try {
        await reset();
        await acquire();
        bookmarkMenuActiveRef.current = true;
        await post({
          kind: 'bookmarkContextMenu',
          bookmarkItemId: item.id,
          clientX: e.clientX,
          clientY: e.clientY,
          items: menuItems,
        });
      } catch (err) {
        console.error('bookmark chrome overlay menu', err);
        bookmarkMenuActiveRef.current = false;
        try {
          await release();
        } catch (releaseErr) {
          console.error('bookmark overlay release after error', releaseErr);
        }
      } finally {
        pendingOwnBookmarkResetRef.current = false;
      }
    },
    [reset, acquire, release, post],
  );

  const openFolderMenu = useCallback(
    async (e, folderItem) => {
      if (folderItem.type !== BOOKMARK.TYPE_FOLDER) return;
      const api = window.electronAPI;
      if (!api?.chromeShellMenuOverlayV1Reset) return;

      const folder = findFolderInBookmarkTree(bookmarksBarRef.current, folderItem.id) || folderItem;
      if (folderMenuActiveRef.current && folderMenuSessionFolderIdRef.current === folder.id) {
        void dismissFolderOverlay();
        return;
      }

      const br = e.currentTarget.getBoundingClientRect();
      const children = Array.isArray(folder.children) ? folder.children : [];
      const items = children.map((ch) => ({
        id: ch.id,
        type: ch.type === BOOKMARK.TYPE_FOLDER ? 'folder' : 'bookmark',
        title: String(ch.title || '').slice(0, 200),
        url: ch.url != null ? String(ch.url).slice(0, 2000) : '',
        favicon: ch.favicon != null ? String(ch.favicon).slice(0, 2000) : '',
      }));

      pendingOwnFolderResetRef.current = true;
      try {
        await reset();
        await acquire();
        folderMenuActiveRef.current = true;
        folderMenuSessionFolderIdRef.current = folder.id;
        await post({
          kind: 'bookmarkFolderMenu',
          folderId: folder.id,
          title: String(folder.title || 'Folder').slice(0, 120),
          anchorRect: { left: br.left, top: br.top, width: br.width, height: br.height },
          items,
        });
      } catch (err) {
        console.error('bookmark folder chrome overlay', err);
        folderMenuActiveRef.current = false;
        folderMenuSessionFolderIdRef.current = null;
        try {
          await release();
        } catch (releaseErr) {
          console.error('bookmark folder overlay release after error', releaseErr);
        }
      } finally {
        pendingOwnFolderResetRef.current = false;
      }
    },
    [reset, acquire, release, post, dismissFolderOverlay],
  );

  const createFolder = async () => {
    const name = folderName.trim();
    if (name) {
      const data = await window.electronAPI.bookmarksAddFolder(name);
      dispatch(setBookmarks(data));
    }
    setShowFolderPrompt(false);
    setFolderName('');
  };

  const cancelFolder = () => {
    setShowFolderPrompt(false);
    setFolderName('');
  };

  const handleFolderKeyDown = (e) => {
    if (e.key === KEYBOARD.ENTER) createFolder();
    if (e.key === KEYBOARD.ESCAPE) cancelFolder();
  };

  return (
    <div className="bookmark-bar">
      {bookmarksData.bar.map(item => (
        <BookmarkItem
          key={item.id}
          item={item}
          dragSrcIdRef={dragSrcIdRef}
          bookmarksData={bookmarksData}
          onNavigate={handleNavigate}
          onBookmarkContextMenu={openBookmarkContextMenu}
          onOpenFolderMenu={openFolderMenu}
          onDismissFolderMenuOnDrag={dismissFolderMenuOnDrag}
        />
      ))}

      {showFolderPrompt && (
        <div className="bk-folder-prompt" id="bk-folder-prompt">
          <input
            ref={folderInputRef}
            id="bk-folder-name"
            type="text"
            placeholder="Folder name"
            maxLength={40}
            value={folderName}
            onChange={e => setFolderName(e.target.value)}
            onKeyDown={handleFolderKeyDown}
          />
          <button id="bk-folder-ok" onClick={createFolder}>OK</button>
          <button id="bk-folder-cancel" onClick={cancelFolder}>Cancel</button>
        </div>
      )}

      <button
        className="bk-add-folder btn"
        title="Add folder"
        onClick={() => setShowFolderPrompt(v => !v)}
      >
        {ADD_FOLDER_ICON}
      </button>
    </div>
  );
}
