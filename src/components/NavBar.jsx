import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTabOverlay } from '../context/TabOverlayContext';
import { useChromeOverlay } from '../context/ChromeOverlayContext';
import { setBookmarks } from '../store/bookmarksSlice';
import { collectFolderOptions } from '../utils/bookmarkFolderList';
import OmniboxInput from './omnibox/OmniboxInput';
import ProfileMenuButton from './ProfileMenuButton';
import ProfileEditorModal from './ProfileEditorModal';
import {
  bookmarkStarFilledSvg,
  navBackSvg,
  navForwardSvg,
  navReloadSvg,
} from '../constants/appAssetUrls';

const BACK_ICON = <img className="chrome-toolbar-icon-img" src={navBackSvg} width={25} height={25} alt="" />;
const FORWARD_ICON = <img className="chrome-toolbar-icon-img" src={navForwardSvg} width={25} height={25} alt="" />;
const RELOAD_ICON = <img className="chrome-toolbar-icon-img" src={navReloadSvg} width={15} height={15} alt="" />;
const STAR_EMPTY = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);
const STAR_FILLED = <img className="chrome-toolbar-icon-img" src={bookmarkStarFilledSvg} width={18} height={18} alt="" />;
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

function isValidFolderId(folderId, bar) {
  if (folderId === 'root') return true;
  return collectFolderOptions(bar).some((f) => f.id === folderId);
}

export default function NavBar({ currentTabId, onOpenSettings, searchEngine = 'google' }) {
  const dispatch = useDispatch();
  const { beginOverlay, endOverlay } = useTabOverlay();
  const { reset, acquire, release, post } = useChromeOverlay();
  const tabs = useSelector(s => s.browser.tabs);
  const bookmarksData = useSelector(s => s.bookmarks.data);
  const bookmarksBarRef = useRef(bookmarksData.bar);
  bookmarksBarRef.current = bookmarksData.bar;

  const tab = tabs[currentTabId];
  const currentUrl = tab && !tab.isNewTab ? (tab.url || '') : '';

  const existingBookmark = findBookmarkByUrl(currentUrl, bookmarksData.bar);
  const isBookmarked = !!existingBookmark;
  const canBookmark = currentUrl && !(
    currentUrl.startsWith('app://') ||
    (currentUrl.startsWith('https://www.google.com/') && !currentUrl.includes('/search'))
  );

  const starEditorActiveRef = useRef(false);
  const pendingOwnStarResetRef = useRef(false);
  const starAnchorRef = useRef(null);
  const starEditorSessionRef = useRef({ url: '', bookmarkId: null, favicon: null });

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

  const closeStarBookmarkEditor = useCallback(async () => {
    if (!starEditorActiveRef.current) return;
    starEditorActiveRef.current = false;
    try {
      await release();
    } catch (err) {
      console.error('star bookmark overlay release', err);
    }
  }, [release]);

  const postStarEditorPatch = useCallback(async (bookmarkDraft, barForFolders) => {
    const anchor = starAnchorRef.current;
    if (!anchor) return;
    const bar = barForFolders || bookmarksBarRef.current;
    const folders = collectFolderOptions(bar).map((f) => ({ id: f.id, label: f.label }));
    const payload = {
      kind: 'bookmarkEditor',
      mode: bookmarkDraft.id ? 'edit' : 'add',
      anchorRect: anchor,
      initialTitle: bookmarkDraft.title || '',
      initialFolderId: bookmarkDraft.folderId || 'root',
      url: bookmarkDraft.url || '',
      bookmarkId: bookmarkDraft.id || null,
      folders,
    };
    await post(payload);
  }, [post]);

  const openStarBookmarkEditor = useCallback(async (anchorEl, bookmarkDraft) => {
    const br = anchorEl.getBoundingClientRect();
    starAnchorRef.current = { left: br.left, top: br.top, width: br.width, height: br.height };
    starEditorSessionRef.current = {
      url: bookmarkDraft.url || '',
      bookmarkId: bookmarkDraft.id || null,
      favicon: bookmarkDraft.favicon ?? null,
    };
    pendingOwnStarResetRef.current = true;
    try {
      await reset();
      await acquire();
      starEditorActiveRef.current = true;
      await postStarEditorPatch(bookmarkDraft, bookmarksBarRef.current);
    } catch (err) {
      console.error('star bookmark overlay open', err);
      starEditorActiveRef.current = false;
      try {
        await release();
      } catch (releaseErr) {
        console.error('star bookmark overlay release after error', releaseErr);
      }
    } finally {
      pendingOwnStarResetRef.current = false;
    }
  }, [reset, acquire, release, postStarEditorPatch]);

  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlayV1HostEvent?.((data) => {
      if (!starEditorActiveRef.current) return;
      const t = data?.type;
      if (t === 'dismiss') {
        void closeStarBookmarkEditor();
        return;
      }
      if (t === 'bookmarkEditorRemove') {
        const id = data?.bookmarkId;
        const sessionId = starEditorSessionRef.current.bookmarkId;
        if (!id || id !== sessionId) {
          void closeStarBookmarkEditor();
          return;
        }
        void (async () => {
          try {
            const result = await window.electronAPI.bookmarksRemove(id);
            dispatch(setBookmarks(result));
          } catch (err) {
            console.error('bookmark editor remove', err);
          } finally {
            void closeStarBookmarkEditor();
          }
        })();
        return;
      }
      if (t === 'bookmarkEditorCreateFolder') {
        const name = String(data?.name || '').trim();
        const draftTitle = String(data?.draftTitle ?? '');
        if (!name) return;
        void (async () => {
          try {
            const result = await window.electronAPI.bookmarksAddFolder(name);
            dispatch(setBookmarks(result));
            const newFolder = [...result.bar].reverse().find((i) => i.type === 'folder');
            const newFolderId = newFolder?.id || 'root';
            await postStarEditorPatch(
              {
                id: starEditorSessionRef.current.bookmarkId || undefined,
                title: draftTitle.slice(0, 500),
                url: starEditorSessionRef.current.url,
                favicon: starEditorSessionRef.current.favicon,
                folderId: newFolderId,
              },
              result.bar,
            );
          } catch (err) {
            console.error('bookmark editor new folder', err);
          }
        })();
        return;
      }
      if (t === 'bookmarkEditorDone') {
        const url = String(data?.url || '');
        const session = starEditorSessionRef.current;
        if (!url || url !== session.url) {
          void closeStarBookmarkEditor();
          return;
        }
        let folderId = data?.folderId === 'root' ? 'root' : String(data?.folderId || 'root');
        const bar = bookmarksBarRef.current;
        if (!isValidFolderId(folderId, bar)) folderId = 'root';
        const title = String(data?.title || '').trim().slice(0, 500) || session.url;
        const isEdit = !!session.bookmarkId;
        const item = {
          id: isEdit ? session.bookmarkId : `bk-${Date.now()}`,
          type: 'bookmark',
          title,
          url: session.url,
          favicon: session.favicon ?? null,
        };
        void (async () => {
          try {
            const result = folderId === 'root'
              ? await window.electronAPI.bookmarksAdd(item)
              : await window.electronAPI.bookmarksAddToFolder(folderId, item);
            dispatch(setBookmarks(result));
          } catch (err) {
            console.error('bookmark editor done', err);
          } finally {
            void closeStarBookmarkEditor();
          }
        })();
      }
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, [closeStarBookmarkEditor, dispatch, postStarEditorPatch]);

  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlaySuperseded?.(() => {
      if (pendingOwnStarResetRef.current) return;
      if (starEditorActiveRef.current) {
        starEditorActiveRef.current = false;
      }
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, []);

  const handleBack = () => window.electronAPI.goBack(currentTabId);
  const handleForward = () => window.electronAPI.goForward(currentTabId);
  const handleReload = () => window.electronAPI.reload(currentTabId);

  const handleBookmark = useCallback(async (e) => {
    if (!canBookmark) return;

    const btn = e.currentTarget;
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
    btn.addEventListener('animationend', () => btn.classList.remove('pop'), { once: true });

    if (starEditorActiveRef.current) {
      void closeStarBookmarkEditor();
      return;
    }

    const bookmarkDraft = existingBookmark
      ? {
          ...existingBookmark,
          folderId: findFolderIdForBookmark(existingBookmark.id, bookmarksData.bar),
          url: currentUrl,
        }
      : {
          title: tab?.title || currentUrl,
          url: currentUrl,
          favicon: tab?.favicon ?? null,
          folderId: 'root',
        };

    await openStarBookmarkEditor(btn, bookmarkDraft);
  }, [
    canBookmark,
    closeStarBookmarkEditor,
    openStarBookmarkEditor,
    existingBookmark,
    bookmarksData.bar,
    tab,
    currentUrl,
  ]);

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

      <OmniboxInput currentTabId={currentTabId} tabsData={tabs} searchEngine={searchEngine} />

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
    </div>
  );
}
