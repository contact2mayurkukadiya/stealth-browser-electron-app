import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setBookmarks } from '../store/bookmarksSlice';
import { setShowBookmarkBar } from '../store/browserSlice';
import { useChromeShellMenuOverlay } from '../context/ChromeOverlayContext';
import BookmarkItem from './BookmarkItem';
import { addFolderSvg, angleDoubleSmallRightSvg } from '../constants/appAssetUrls';
import { BOOKMARK, OVERLAY, KEYBOARD } from '../constants/conditionStrings.js';
import AssetMaskIcon from './AssetMaskIcon';

const ADD_FOLDER_ICON = <AssetMaskIcon icon={addFolderSvg} size={16} />;
const OVERFLOW_ICON = <AssetMaskIcon icon={angleDoubleSmallRightSvg} size={16} />;

/** Resolve a node anywhere in the bookmark tree (bar root or nested). */
function findItemInBookmarkTree(nodes, itemId) {
  if (!Array.isArray(nodes) || !itemId) return null;
  for (const node of nodes) {
    if (!node) continue;
    if (node.id === itemId) return node;
    if (node.children?.length) {
      const sub = findItemInBookmarkTree(node.children, itemId);
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

  const pendingOwnBookmarkResetRef = useRef(false);
  const bookmarkMenuActiveRef = useRef(false);
  const pendingOwnFolderResetRef = useRef(false);
  const folderMenuActiveRef = useRef(false);
  const folderMenuSessionFolderIdRef = useRef(null);

  // Overflow Measurement state
  const itemsContainerRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(bookmarksData.bar.length);

  const checkOverflow = useCallback(() => {
    if (!itemsContainerRef.current) return;
    const container = itemsContainerRef.current;
    const containerWidth = container.clientWidth;
    const children = container.children;

    let newVisibleCount = bookmarksData.bar.length;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      // +1 buffer for sub-pixel browser rendering rounding
      if (child.offsetLeft + child.offsetWidth > containerWidth + 1) {
        newVisibleCount = i;
        break;
      }
    }

    setVisibleCount(prev => (prev === newVisibleCount ? prev : newVisibleCount));
  }, [bookmarksData.bar]);

  // Recalculate overflow count when container resizes
  useEffect(() => {
    if (!itemsContainerRef.current) return;
    const observer = new ResizeObserver(() => checkOverflow());
    observer.observe(itemsContainerRef.current);
    return () => observer.disconnect();
  }, [checkOverflow]);

  // Recalculate overflow count when data changes
  useLayoutEffect(() => {
    checkOverflow();
  }, [bookmarksData.bar, checkOverflow]);

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
    try { await release(); } catch (err) { console.error('bookmark overlay release', err); }
  }, [release]);

  const dismissFolderOverlay = useCallback(async () => {
    if (!folderMenuActiveRef.current) return;
    folderMenuActiveRef.current = false;
    folderMenuSessionFolderIdRef.current = null;
    try { await release(); } catch (err) { console.error('bookmark folder overlay release', err); }
  }, [release]);

  const dismissFolderMenuOnDrag = useCallback(() => {
    if (folderMenuActiveRef.current) {
      void dismissFolderOverlay();
    }
  }, [dismissFolderOverlay]);

  // 1. Process Actions returning from the HTML Overlay
  const applyBookmarkMenuAction = useCallback(
    (bookmarkItemId, actionId) => {
      const item = findItemInBookmarkTree(bookmarksData.bar, bookmarkItemId);
      if (!item) return;
      const isFolder = item.type === BOOKMARK.TYPE_FOLDER;

      void (async () => {
        try {
          switch (actionId) {
            case 'openNewTab':
              if (!isFolder && item.url) {
                const id = 'tab-' + Date.now();
                window.electronAPI.newTab(id, false, item.url, { source: 'bookmark' });
                window.electronAPI.switchTab(id);
              }
              break;
            case 'openNewWindow':
              if (!isFolder && item.url) {
                window.electronAPI.createWindow?.({ url: item.url });
              }
              break;
            case 'openStealth':
              if (!isFolder && item.url) {
                window.electronAPI.createStealthWindow?.({ url: item.url });
              }
              break;
            case 'delete':
              const updatedBookmarks = await window.electronAPI.bookmarksRemove(item.id);
              dispatch(setBookmarks(updatedBookmarks));
              break;
            case 'openManager':
              if (currentTabId) {
                window.electronAPI.navigate(currentTabId, 'invisurf://bookmarks', { source: 'bookmark' });
              } else {
                window.electronAPI.newTab(null, false, 'invisurf://bookmarks', { source: 'bookmark' });
              }
              break;
            case 'toggleBar':
              dispatch(setShowBookmarkBar(false));
              break;
            default:
              break;
          }
        } catch (err) {
          console.error('Bookmark context menu error:', err);
        }
      })();
    },
    [bookmarksData.bar, currentTabId, dispatch]
  );

  // 2. Overlay Events interceptor
  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlayV1HostEvent?.((data) => {
      const t = data?.type;
      if (t === OVERLAY.DISMISS) {
        if (bookmarkMenuActiveRef.current) void dismissBookmarkOverlay();
        if (folderMenuActiveRef.current) void dismissFolderOverlay();
        return;
      }

      // Folder Overlay
      if (t === OVERLAY.BOOKMARK_FOLDER_PICK) {
        if (!folderMenuActiveRef.current) return;
        const folderId = data?.folderId;
        const itemId = data?.itemId;
        if (!folderId || !itemId) {
          void dismissFolderOverlay();
          return;
        }

        let child = null;
        if (folderId === 'overflow-menu') {
          child = bookmarksBarRef.current.find((c) => c.id === itemId);
        } else {
          const folder = findItemInBookmarkTree(bookmarksBarRef.current, folderId);
          child = folder && Array.isArray(folder.children)
            ? folder.children.find((c) => c.id === itemId)
            : null;
        }

        if (child?.type === BOOKMARK.TYPE_BOOKMARK && child.url) {
          handleNavigate(child.url);
        }
        void dismissFolderOverlay();
        return;
      }

      // Right-Click Overlay Action
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

  // 3. Spawning the Overlay (Synchronous Extraction to prevent Electron positioning at 0,0)
  const openBookmarkContextMenu = useCallback(
    async (e, item, isFolder) => {
      e.preventDefault();
      e.stopPropagation();

      const api = window.electronAPI;
      if (!api?.chromeShellMenuOverlayV1Reset) return;

      // Extract properties immediately so React's async pooling doesn't wipe them!
      const clientX = e.clientX;
      const clientY = e.clientY;

      const menuItems = [
        { type: 'item', id: 'openNewTab', label: 'Open in new tab', enabled: !isFolder },
        { type: 'item', id: 'openNewWindow', label: 'Open in new window', enabled: !isFolder },
        { type: 'item', id: 'openStealth', label: 'Open in stealth tab', enabled: !isFolder },
        { type: 'separator', id: 'sep1' },
        { type: 'item', id: 'delete', label: 'Delete', danger: true, enabled: true },
        { type: 'separator', id: 'sep2' },
        { type: 'item', id: 'openManager', label: 'Open bookmarks manager', enabled: true },
        { type: 'item', id: 'toggleBar', label: 'Hide bookmark bar', enabled: true },
      ];

      pendingOwnBookmarkResetRef.current = true;
      try {
        await reset();
        await acquire();
        bookmarkMenuActiveRef.current = true;

        await post({
          kind: 'bookmarkContextMenu', // Sends payload to chrome-overlay.html
          bookmarkItemId: item.id,
          clientX: clientX,
          clientY: clientY,
          items: menuItems,
        });
      } catch (err) {
        console.error('bookmark chrome overlay menu error:', err);
        bookmarkMenuActiveRef.current = false;
        try { await release(); } catch (releaseErr) { }
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

      const folder = findItemInBookmarkTree(bookmarksBarRef.current, folderItem.id) || folderItem;
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
        folderMenuActiveRef.current = false;
        folderMenuSessionFolderIdRef.current = null;
        try { await release(); } catch (releaseErr) { }
      } finally {
        pendingOwnFolderResetRef.current = false;
      }
    },
    [reset, acquire, release, post, dismissFolderOverlay],
  );

  const overflowItems = bookmarksData.bar.slice(visibleCount);

  const openOverflowMenu = useCallback(
    async (e) => {
      const api = window.electronAPI;
      if (!api?.chromeShellMenuOverlayV1Reset) return;

      if (folderMenuActiveRef.current && folderMenuSessionFolderIdRef.current === 'overflow-menu') {
        void dismissFolderOverlay();
        return;
      }

      const br = e.currentTarget.getBoundingClientRect();
      const items = overflowItems.map((ch) => ({
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
        folderMenuSessionFolderIdRef.current = 'overflow-menu';
        await post({
          kind: 'bookmarkFolderMenu',
          folderId: 'overflow-menu',
          title: 'Hidden Bookmarks',
          anchorRect: { left: br.left, top: br.top, width: br.width, height: br.height },
          items,
        });
      } catch (err) {
        folderMenuActiveRef.current = false;
        folderMenuSessionFolderIdRef.current = null;
        try { await release(); } catch (releaseErr) { }
      } finally {
        pendingOwnFolderResetRef.current = false;
      }
    },
    [reset, acquire, release, post, dismissFolderOverlay, overflowItems]
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

      <div className="bk-items-container" ref={itemsContainerRef}>
        {bookmarksData.bar.map((item, index) => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              flexShrink: 0,
              visibility: index >= visibleCount ? 'hidden' : 'visible',
              pointerEvents: index >= visibleCount ? 'none' : 'auto'
            }}
          >
            <BookmarkItem
              item={item}
              dragSrcIdRef={dragSrcIdRef}
              bookmarksData={bookmarksData}
              onNavigate={handleNavigate}
              onBookmarkContextMenu={openBookmarkContextMenu}
              onOpenFolderMenu={openFolderMenu}
              onDismissFolderMenuOnDrag={dismissFolderMenuOnDrag}
            />
          </div>
        ))}
      </div>

      {overflowItems.length > 0 && (
        <button
          className="bk-overflow-btn"
          title="Hidden bookmarks"
          onClick={openOverflowMenu}
        >
          {OVERFLOW_ICON}
        </button>
      )}

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