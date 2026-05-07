import React, { useState, useCallback, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useTabOverlay } from '../context/TabOverlayContext';
import OmniboxInput from './omnibox/OmniboxInput';
import BookmarkEditPopup from './BookmarkEditPopup';
import ProfileMenuButton from './ProfileMenuButton';
import ProfileEditorModal from './ProfileEditorModal';
import {
  bookmarkStarFilledSvg,
  navBackSvg,
  navForwardSvg,
  navReloadSvg,
} from '../constants/appAssetUrls';

const BACK_ICON = <img src={navBackSvg} width={25} height={25} alt="" />;
const FORWARD_ICON = <img src={navForwardSvg} width={25} height={25} alt="" />;
const RELOAD_ICON = <img src={navReloadSvg} width={15} height={15} alt="" />;
const STAR_EMPTY = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);
const STAR_FILLED = <img src={bookmarkStarFilledSvg} width={18} height={18} alt="" />;
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
  const { beginOverlay, endOverlay } = useTabOverlay();
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
  const [profiles, setProfiles] = useState([]);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileEditorMode, setProfileEditorMode] = useState('create');

  const loadProfiles = useCallback(async () => {
    const [allProfiles, activeProfile] = await Promise.all([
      window.electronAPI.profileList?.() || [],
      window.electronAPI.profileGetCurrent?.(),
    ]);
    setProfiles(Array.isArray(allProfiles) ? allProfiles : []);
    setCurrentProfile(activeProfile || null);
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!profileEditorOpen) return undefined;
    (async () => {
      await beginOverlay();
    })();
    return () => {
      endOverlay();
    };
  }, [profileEditorOpen, beginOverlay, endOverlay]);

  const handleBack = () => window.electronAPI.goBack(currentTabId);
  const handleForward = () => window.electronAPI.goForward(currentTabId);
  const handleReload = () => window.electronAPI.reload(currentTabId);

  // Restore the active tab view when the edit modal closes.
  const handleEditClose = useCallback(() => {
    setEditPopup(null);
    endOverlay();
  }, [endOverlay]);

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
      endOverlay();
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

    await beginOverlay();
    setEditPopup({ data: bookmarkData });
  }, [canBookmark, editPopup, existingBookmark, bookmarksData.bar, tab, currentUrl, beginOverlay, endOverlay]);

  const handleAddProfile = useCallback(() => {
    setProfileEditorMode('create');
    setProfileEditorOpen(true);
  }, []);

  const handleEditCurrentProfile = useCallback(() => {
    if (!currentProfile) return;
    setProfileEditorMode('edit');
    setProfileEditorOpen(true);
  }, [currentProfile]);

  const handleProfileEditorSaved = useCallback(
    async ({ mode, profile }) => {
      await loadProfiles();
      if (mode === 'create' && profile?.profileId) {
        await window.electronAPI.profileOpenWindow?.(profile.profileId);
      }
      setProfileEditorOpen(false);
    },
    [loadProfiles],
  );

  const handleOpenProfileWindow = useCallback(async (profileId) => {
    if (!profileId) return;
    await window.electronAPI.profileOpenWindow?.(profileId);
  }, []);

  return (
    <div className="nav-bar">
      <button id="back-btn" className="btn" onClick={handleBack}>{BACK_ICON}</button>
      <button id="forward-btn" className="btn" onClick={handleForward}>{FORWARD_ICON}</button>
      <button id="reload-btn" className="btn" onClick={handleReload}>{RELOAD_ICON}</button>

      <OmniboxInput currentTabId={currentTabId} tabsData={tabs} />

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

      <ProfileMenuButton
        profiles={profiles}
        activeProfile={currentProfile}
        onOpenProfile={handleOpenProfileWindow}
        onAddProfile={handleAddProfile}
        onEditProfile={handleEditCurrentProfile}
        triggerTitle={`Profiles (${currentProfile?.displayName || 'Profile'})`}
      />

      <ProfileEditorModal
        open={profileEditorOpen}
        mode={profileEditorMode}
        initialProfile={profileEditorMode === 'edit' ? currentProfile : null}
        onClose={() => setProfileEditorOpen(false)}
        onSaved={handleProfileEditorSaved}
      />

      {editPopup && (
        <BookmarkEditPopup
          data={editPopup.data}
          onClose={handleEditClose}
        />
      )}
    </div>
  );
}
