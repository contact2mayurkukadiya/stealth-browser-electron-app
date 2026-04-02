import React, { useState, useCallback } from 'react';
import { useSelector } from 'react-redux';
import UrlBar from './UrlBar';
import BookmarkEditPopup from './BookmarkEditPopup';

const BACK_ICON = (
  <svg width={25} height={25} viewBox="0 0 640 640">
    <path fill="white" d="M201.4 297.4C188.9 309.9 188.9 330.2 201.4 342.7L361.4 502.7C373.9 515.2 394.2 515.2 406.7 502.7C419.2 490.2 419.2 469.9 406.7 457.4L269.3 320L406.6 182.6C419.1 170.1 419.1 149.8 406.6 137.3C394.1 124.8 373.8 124.8 361.3 137.3L201.3 297.3z" />
  </svg>
);
const FORWARD_ICON = (
  <svg width={25} height={25} viewBox="0 0 640 640">
    <path fill="white" d="M439.1 297.4C451.6 309.9 451.6 330.2 439.1 342.7L279.1 502.7C266.6 515.2 246.3 515.2 233.8 502.7C221.3 490.2 221.3 469.9 233.8 457.4L371.2 320L233.9 182.6C221.4 170.1 221.4 149.8 233.9 137.3C246.4 124.8 266.7 124.8 279.2 137.3L439.2 297.3z" />
  </svg>
);
const RELOAD_ICON = (
  <svg width={15} height={15} viewBox="0 0 640 640">
    <path fill="white" d="M500.7 138.7L512 149.4L512 96C512 78.3 526.3 64 544 64C561.7 64 576 78.3 576 96L576 224C576 241.7 561.7 256 544 256L416 256C398.3 256 384 241.7 384 224C384 206.3 398.3 192 416 192L463.9 192L456.3 184.8C456.1 184.6 455.9 184.4 455.7 184.2C380.7 109.2 259.2 109.2 184.2 184.2C109.2 259.2 109.2 380.7 184.2 455.7C259.2 530.7 380.7 530.7 455.7 455.7C463.9 447.5 471.2 438.8 477.6 429.6C487.7 415.1 507.7 411.6 522.2 421.7C536.7 431.8 540.2 451.8 530.1 466.3C521.6 478.5 511.9 490.1 501 501C401 601 238.9 601 139 501C39.1 401 39 239 139 139C238.9 39.1 400.7 39 500.7 138.7z" />
  </svg>
);
const STAR_EMPTY = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);
const STAR_FILLED = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#FFB430" stroke="#FFB430" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);
const MORE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="12" cy="19" r="1.5" />
  </svg>
);

/** Search bar → root, folder → folder id, not found → 'root' (fallback). */
function findFolderIdForBookmark(bookmarkId, list) {
  for (const item of list) {
    if (item.type === 'bookmark' && item.id === bookmarkId) return 'root';
    if (item.type === 'folder' && item.children) {
      for (const child of item.children) {
        if (child.type === 'bookmark' && child.id === bookmarkId) return item.id;
      }
    }
  }
  return 'root';
}

function findBookmarkByUrl(url, list) {
  if (!url) return null;
  const norm = u => u.toLowerCase().replace(/\/$/, '');
  const target = norm(url);
  for (const item of list) {
    if (item.type === 'bookmark' && norm(item.url || '') === target) return item;
    if (item.type === 'folder' && item.children) {
      const found = findBookmarkByUrl(url, item.children);
      if (found) return found;
    }
  }
  return null;
}

export default function NavBar({ currentTabId, onOpenSettings }) {
  const tabs = useSelector(s => s.browser.tabs);
  const bookmarksData = useSelector(s => s.bookmarks.data);
  const tab = tabs[currentTabId];
  const currentUrl = tab && !tab.isNewTab ? (tab.url || '') : '';

  const existingBookmark = findBookmarkByUrl(currentUrl, bookmarksData.bar);
  const isBookmarked = !!existingBookmark;
  const canBookmark = currentUrl && !(
    currentUrl.startsWith('https://www.google.com/') && !currentUrl.includes('/search')
  );

  // ── Edit popup state ──────────────────────────────────────────────────────
  // null = closed; { data } = open
  const [editPopup, setEditPopup] = useState(null);

  const handleBack = () => window.electronAPI.goBack(currentTabId);
  const handleForward = () => window.electronAPI.goForward(currentTabId);
  const handleReload = () => window.electronAPI.reload(currentTabId);

  // Restore the active tab view when the edit modal closes.
  const handleEditClose = useCallback(() => {
    setEditPopup(null);
    window.electronAPI.tabRestoreActive?.();
  }, []);

  const handleBookmark = useCallback(async (e) => {
    if (!canBookmark) return;

    // Star animation
    const btn = e.currentTarget;
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
    btn.addEventListener('animationend', () => btn.classList.remove('pop'), { once: true });

    // Toggle: clicking star while modal is open closes it and restores the tab
    if (editPopup) {
      setEditPopup(null);
      window.electronAPI.tabRestoreActive?.();
      return;
    }

    const bookmarkData = existingBookmark
      ? {
          ...existingBookmark,
          folderId: findFolderIdForBookmark(existingBookmark.id, bookmarksData.bar),
        }
      : {
          title: tab?.title || currentUrl,
          url: currentUrl,
          favicon: tab?.favicon ?? null,
          folderId: 'root',
        };

    // Hide the active WebContentsView so the React modal appears above it
    await window.electronAPI.tabHideActive?.();
    setEditPopup({ data: bookmarkData });
  }, [canBookmark, editPopup, existingBookmark, bookmarksData.bar, tab, currentUrl]);

  return (
    <div className="nav-bar">
      <button id="back-btn" className="btn" onClick={handleBack}>{BACK_ICON}</button>
      <button id="forward-btn" className="btn" onClick={handleForward}>{FORWARD_ICON}</button>
      <button id="reload-btn" className="btn" onClick={handleReload}>{RELOAD_ICON}</button>

      <UrlBar currentTabId={currentTabId} tabsData={tabs} />

      <button
        id="bookmark-btn"
        className={`btn star-btn${isBookmarked ? ' starred' : ''}`}
        title="Bookmark this page"
        onClick={handleBookmark}
      >
        {isBookmarked ? STAR_FILLED : STAR_EMPTY}
      </button>

      <button
        id="more-btn"
        className="btn"
        title="Settings"
        onClick={onOpenSettings}
      >
        {MORE_ICON}
      </button>

      {editPopup && (
        <BookmarkEditPopup
          data={editPopup.data}
          onClose={handleEditClose}
        />
      )}
    </div>
  );
}
