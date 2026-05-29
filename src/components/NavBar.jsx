import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTabOverlay } from '../context/TabOverlayContext';
import { useChromeShellMenuOverlay } from '../context/ChromeOverlayContext';
import { setBookmarks } from '../store/bookmarksSlice';
import { collectFolderOptions } from '../utils/bookmarkFolderList';
import { profileAvatarBackground, profileInitials } from '../utils/profileAvatar';
import OmniboxInput from './omnibox/OmniboxInput';
import ProfileMenuButton from './ProfileMenuButton';
import ProfileEditorModal from './ProfileEditorModal';
import { BOOKMARK, OVERLAY, PROFILE } from '../constants/conditionStrings.js';
import {
  bookmarkStarFilledSvg,
  menuAddProfileSvg,
  menuBookmarksSvg,
  menuCloseProfileSvg,
  menuCopySvg,
  menuCutSvg,
  menuDeleteDataSvg,
  menuDownloadsSvg,
  menuEditProfileSvg,
  menuFindSvg,
  menuHistorySvg,
  menuLensSvg,
  menuManageProfilesSvg,
  menuNewTabSvg,
  menuNewWindowSvg,
  menuPasteSvg,
  menuPrintSvg,
  menuProfileSvg,
  menuSettingsSvg,
  menuStealthWindowSvg,
  menuTabSvg,
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
    if (item.type === BOOKMARK.TYPE_BOOKMARK && item.id === bookmarkId) return 'root';
    if (item.type === BOOKMARK.TYPE_FOLDER && item.children) {
      for (const child of item.children) {
        if (child.type === BOOKMARK.TYPE_BOOKMARK && child.id === bookmarkId) return item.id;
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
    if (item.type === BOOKMARK.TYPE_BOOKMARK && norm(item.url || '') === target) return item;
    if (item.type === BOOKMARK.TYPE_FOLDER && item.children) {
      const found = findBookmarkByUrl(url, item.children);
      if (found) return found;
    }
  }
  return null;
}

function isValidFolderId(folderId, bar) {
  if (folderId === BOOKMARK.ROOT_ID) return true;
  return collectFolderOptions(bar).some((f) => f.id === folderId);
}

function flattenBookmarkMenuItems(items, depth = 0, out = []) {
  if (!Array.isArray(items) || out.length >= 12) return out;
  for (const item of items) {
    if (!item || out.length >= 12) continue;
    if (item.type === BOOKMARK.TYPE_BOOKMARK && item.url) {
      out.push({
        iconSrc: menuBookmarksSvg,
        label: `${depth > 0 ? '  '.repeat(depth) : ''}${item.title || item.url}`,
        commandId: 'openBookmark',
        url: item.url,
      });
    } else if (item.type === BOOKMARK.TYPE_FOLDER && Array.isArray(item.children)) {
      flattenBookmarkMenuItems(item.children, depth + 1, out);
    }
  }
  return out;
}

export default function NavBar({
  currentTabId,
  onNewTab,
  onOpenHistory,
  onDeleteBrowsingData,
  onOpenSettings,
  searchEngine = 'google',
}) {
  const dispatch = useDispatch();
  const { beginOverlay, endOverlay } = useTabOverlay();
  const { reset, acquire, release, post } = useChromeShellMenuOverlay();
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
  const moreBtnRef = useRef(null);

  const [profiles, setProfiles] = useState([]);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [recentlyClosed, setRecentlyClosed] = useState([]);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileEditorMode, setProfileEditorMode] = useState('create');
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const appMenuOpenRef = useRef(false);
  const appMenuSkipRefreshRef = useRef(false);
  const pendingOwnAppMenuResetRef = useRef(false);
  const appMenuAnchorRef = useRef(null);
  const profilesRef = useRef([]);
  const currentProfileRef = useRef(null);
  const recentlyClosedRef = useRef([]);
  const profileAvatarsRef = useRef({});

  const loadProfiles = useCallback(async () => {
    const [allProfiles, activeProfile] = await Promise.all([
      window.electronAPI.profileList?.() || [],
      window.electronAPI.profileGetCurrent?.(),
    ]);
    const nextProfiles = Array.isArray(allProfiles) ? allProfiles : [];
    profilesRef.current = nextProfiles;
    currentProfileRef.current = activeProfile || null;
    setProfiles(nextProfiles);
    setCurrentProfile(activeProfile || null);
    return { profiles: nextProfiles, currentProfile: activeProfile || null };
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);
  appMenuOpenRef.current = appMenuOpen;

  const isMac = window.electronAPI?.platform === 'darwin';
  const shortcut = useCallback((mac, other) => (isMac ? mac : other), [isMac]);

  const loadRecentlyClosed = useCallback(async () => {
    try {
      const rows = await window.electronAPI.recentlyClosedList?.();
      const next = Array.isArray(rows) ? rows : [];
      recentlyClosedRef.current = next;
      setRecentlyClosed(next);
      return next;
    } catch {
      recentlyClosedRef.current = [];
      setRecentlyClosed([]);
      return [];
    }
  }, []);

  const loadProfileAvatars = useCallback(async (profileList) => {
    const next = {};
    await Promise.all((profileList || []).map(async (profile) => {
      if (!profile?.profileId) return;
      if (!profile.hasCustomAvatar) return;
      try {
        const result = await window.electronAPI.profileGetAvatarDataUrl?.(profile.profileId);
        if (result?.dataUrl) next[profile.profileId] = result.dataUrl;
      } catch {
        // Initials fallback below is enough if an avatar cannot be read.
      }
    }));
    profileAvatarsRef.current = next;
    return next;
  }, []);

  const buildProfileAvatarPayload = useCallback((profile) => {
    if (!profile?.profileId) return null;
    const label = profile.displayName || profile.profileId;
    return {
      src: profileAvatarsRef.current[profile.profileId] || null,
      initials: profileInitials(label),
      background: profileAvatarBackground(profile.profileId),
      preset: profile.avatarSource === PROFILE.AVATAR_PRESET,
    };
  }, []);

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

  const openBookmarkEditorForCurrentPage = useCallback(async (anchorEl) => {
    if (!canBookmark || !anchorEl) return;
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
    await openStarBookmarkEditor(anchorEl, bookmarkDraft);
  }, [
    bookmarksData.bar,
    canBookmark,
    currentUrl,
    existingBookmark,
    openStarBookmarkEditor,
    tab,
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

    await openBookmarkEditorForCurrentPage(btn);
  }, [
    canBookmark,
    closeStarBookmarkEditor,
    openBookmarkEditorForCurrentPage,
  ]);

  const handleProfileEditorSaved = useCallback(
    async ({ mode, profile }) => {
      await loadProfiles();
      if (mode === PROFILE.MODE_CREATE && profile?.profileId) {
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

  const closeAppMenu = useCallback(async () => {
    if (!appMenuOpenRef.current) return;
    appMenuOpenRef.current = false;
    appMenuSkipRefreshRef.current = false;
    setAppMenuOpen(false);
    try {
      await release();
    } catch (err) {
      console.error('app menu overlay release', err);
    }
  }, [release]);

  const postAppMenuPatch = useCallback(async () => {
    if (!appMenuAnchorRef.current) return;
    const { left, top, width, height } = appMenuAnchorRef.current;
    const menuLeft = Math.max(8, Math.min(left + width - 320, window.innerWidth - 328));
    const menuTop = Math.round(top + height + 6);
    const profileList = profilesRef.current.length ? profilesRef.current : profiles;
    const activeProfile = currentProfileRef.current || currentProfile;
    const closedRows = recentlyClosedRef.current.length ? recentlyClosedRef.current : recentlyClosed;
    const activeProfileLabel = activeProfile?.displayName || activeProfile?.profileId || 'Profile';
    const activeProfileAvatar = buildProfileAvatarPayload(activeProfile);
    const bookmarkRows = flattenBookmarkMenuItems(bookmarksData.bar);
    const profileRows = [
      { header: true, label: `Signed in as ${activeProfileLabel}`, avatar: activeProfileAvatar, highlight: true },
      { type: 'separator' },
      { iconSrc: menuEditProfileSvg, label: 'Customize Your Chrome', commandId: 'customizeCurrentProfile' },
      { iconSrc: menuCloseProfileSvg, label: 'Close This Profile', commandId: 'closeCurrentProfile' },
      { type: 'separator' },
      { header: true, label: 'Other Chrome Profiles' },
      ...profileList
        .filter((p) => p?.profileId && p.profileId !== activeProfile?.profileId)
        .map((p) => ({
          avatar: buildProfileAvatarPayload(p),
          label: p.displayName || p.profileId,
          commandId: 'openProfile',
          profileId: p.profileId,
        })),
      { type: 'separator' },
      { iconSrc: menuAddProfileSvg, label: 'Add New Profile', commandId: 'addProfile' },
      { iconSrc: menuManageProfilesSvg, label: 'Manage Chrome Profiles', commandId: 'manageProfiles' },
    ];
    const historyRows = [
      { iconSrc: menuHistorySvg, label: 'Open History Page', shortcut: shortcut('⌘Y', 'Ctrl+Y'), commandId: 'openHistoryPage' },
      { iconSrc: menuHistorySvg, label: 'Show History in Side Panel', commandId: 'historySidePanel', disabled: true },
      { type: 'separator' },
      { header: true, label: 'Recent Tabs' },
      ...(closedRows.length ? closedRows.map((row) => ({
        iconSrc: row.type === 'window' ? menuNewWindowSvg : menuTabSvg,
        label: row.label || row.subtitle || 'Recently closed',
        shortcut: row.type === 'window' ? 'Window' : '',
        commandId: 'restoreRecentlyClosed',
        closedAt: row.closedAt,
      })) : [{ label: 'No recently closed tabs', disabled: true }]),
    ];
    const bookmarkRowsForMenu = [
      { iconSrc: menuBookmarksSvg, label: existingBookmark ? 'Edit bookmark for this tab' : 'Bookmark this tab', commandId: 'bookmarkCurrentTab', disabled: !canBookmark },
      { type: 'separator' },
      { header: true, label: 'Bookmarks' },
      ...(bookmarkRows.length ? bookmarkRows : [{ label: 'No bookmarks yet', disabled: true }]),
    ];
    const findRows = [
      { iconSrc: menuFindSvg, label: 'Find...', shortcut: shortcut('⌘F', 'Ctrl+F'), commandId: 'findInPage' },
      { type: 'separator' },
      { iconSrc: menuCutSvg, label: 'Cut', shortcut: shortcut('⌘X', 'Ctrl+X'), commandId: 'cut' },
      { iconSrc: menuCopySvg, label: 'Copy', shortcut: shortcut('⌘C', 'Ctrl+C'), commandId: 'copy' },
      { iconSrc: menuPasteSvg, label: 'Paste', shortcut: shortcut('⌘V', 'Ctrl+V'), commandId: 'paste' },
    ];
    let googleLensMenuDisabled = false;
    try {
      googleLensMenuDisabled = await window.electronAPI?.isGoogleLensActiveForProfile?.() === true;
    } catch (_) {
      googleLensMenuDisabled = false;
    }

    await post({
      kind: 'appMenu',
      menuRect: { left: menuLeft, top: menuTop, width: 320 },
      items: [
        { iconSrc: menuNewTabSvg, label: 'New Tab', shortcut: shortcut('⌘T', 'Ctrl+T'), commandId: 'newTab' },
        { iconSrc: menuNewWindowSvg, label: 'New Window', shortcut: shortcut('⌘N', 'Ctrl+N'), commandId: 'newWindow' },
        { iconSrc: menuStealthWindowSvg, label: 'New Incognito Window', shortcut: shortcut('⇧⌘N', 'Ctrl+Shift+N'), commandId: 'newStealthWindow' },
        { type: 'separator' },
        { label: activeProfileLabel, avatar: activeProfileAvatar, submenuKey: 'profile', highlight: true },
        { iconSrc: menuHistorySvg, label: 'History', submenuKey: 'history' },
        { iconSrc: menuDownloadsSvg, label: 'Downloads', shortcut: shortcut('⌥⌘L', 'Ctrl+J'), commandId: 'openDownloads' },
        { iconSrc: menuBookmarksSvg, label: 'Bookmarks and Lists', submenuKey: 'bookmarks' },
        { iconSrc: menuDeleteDataSvg, label: 'Delete Browsing Data...', shortcut: shortcut('⇧⌘⌫', 'Ctrl+Shift+Del'), commandId: 'deleteBrowsingData' },
        { type: 'separator' },
        { iconSrc: menuPrintSvg, label: 'Print...', shortcut: shortcut('⌘P', 'Ctrl+P'), commandId: 'print' },
        {
          iconSrc: menuLensSvg,
          label: 'Search this tab with Google Lens',
          commandId: 'searchWithGoogleLens',
          disabled: googleLensMenuDisabled,
        },
        { iconSrc: menuFindSvg, label: 'Find and Edit', submenuKey: 'find' },
        { type: 'separator' },
        { iconSrc: menuSettingsSvg, label: 'Settings', shortcut: shortcut('⌘,', 'Ctrl+,'), commandId: 'openSettings' },
      ],
      submenus: {
        profile: profileRows,
        history: historyRows,
        bookmarks: bookmarkRowsForMenu,
        find: findRows,
      },
    });
  }, [bookmarksData.bar, buildProfileAvatarPayload, canBookmark, currentProfile, existingBookmark, profiles, recentlyClosed, post, shortcut]);

  const openAppMenu = useCallback(async (e) => {
    const anchor = e.currentTarget?.getBoundingClientRect?.();
    if (!anchor) return;
    appMenuAnchorRef.current = anchor;
    if (appMenuOpenRef.current) {
      await closeAppMenu();
      return;
    }
    const { profiles: nextProfiles } = await loadProfiles();
    await Promise.all([
      loadProfileAvatars(nextProfiles),
      loadRecentlyClosed(),
    ]);
    pendingOwnAppMenuResetRef.current = true;
    try {
      await reset();
      await acquire();
      appMenuOpenRef.current = true;
      appMenuSkipRefreshRef.current = true;
      setAppMenuOpen(true);
      await postAppMenuPatch();
    } catch (err) {
      console.error('app menu overlay open', err);
      appMenuOpenRef.current = false;
      setAppMenuOpen(false);
      try {
        await release();
      } catch (_) {
        // ignore
      }
    } finally {
      pendingOwnAppMenuResetRef.current = false;
    }
  }, [acquire, closeAppMenu, loadProfileAvatars, loadProfiles, loadRecentlyClosed, postAppMenuPatch, release, reset]);

  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlayV1HostEvent?.((data) => {
      const t = data?.type;
      if (appMenuOpenRef.current) {
        if (t === OVERLAY.DISMISS) {
          void closeAppMenu();
          return;
        }
        if (t === OVERLAY.APP_MENU_COMMAND) {
          const commandId = data?.commandId;
          if (commandId === 'newTab') onNewTab?.();
          else if (commandId === 'newWindow') {
            if (currentProfile?.profileId) window.electronAPI.createWindow?.(currentProfile.profileId);
          } else if (commandId === 'newStealthWindow') window.electronAPI.createStealthWindow?.();
          else if (commandId === 'openSettings') onOpenSettings?.();
          else if (commandId === 'openHistoryPage') onOpenHistory?.();
          else if (commandId === 'openDownloads') window.electronAPI.runMenuCommand?.('open-downloads');
          else if (commandId === 'deleteBrowsingData') onDeleteBrowsingData?.();
          else if (commandId === 'print') window.electronAPI.runMenuCommand?.('print-active-tab');
          else if (commandId === 'searchWithGoogleLens') window.electronAPI.runMenuCommand?.('search-with-google-lens');
          else if (commandId === 'findInPage') window.electronAPI.runMenuCommand?.('find-in-page');
          else if (commandId === 'cut') window.electronAPI.runMenuCommand?.('edit-cut');
          else if (commandId === 'copy') window.electronAPI.runMenuCommand?.('edit-copy');
          else if (commandId === 'paste') window.electronAPI.runMenuCommand?.('edit-paste');
          else if (commandId === 'openProfile' && data?.profileId) window.electronAPI.profileOpenWindow?.(data.profileId);
          else if (commandId === 'addProfile') handleAddProfile();
          else if (commandId === 'manageProfiles') window.electronAPI.profilePickerOpen?.();
          else if (commandId === 'customizeCurrentProfile') handleEditCurrentProfile();
          else if (commandId === 'closeCurrentProfile') window.electronAPI.profileCloseCurrent?.();
          else if (commandId === 'restoreRecentlyClosed' && data?.closedAt) {
            window.electronAPI.recentlyClosedRestore?.(data.closedAt);
          } else if (commandId === 'openBookmark' && data?.url && currentTabId) {
            window.electronAPI.navigate(currentTabId, data.url, { source: 'bookmark' });
          } else if (commandId === 'bookmarkCurrentTab') {
            const anchor = moreBtnRef.current;
            void closeAppMenu().then(() => {
              setTimeout(() => {
                if (anchor) void openBookmarkEditorForCurrentPage(anchor);
              }, 0);
            });
            return;
          }
          void closeAppMenu();
          return;
        }
      }

      if (!starEditorActiveRef.current) return;
      if (t === OVERLAY.DISMISS) {
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
            const newFolder = [...result.bar].reverse().find((i) => i.type === BOOKMARK.TYPE_FOLDER);
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
        let folderId = data?.folderId === BOOKMARK.ROOT_ID ? 'root' : String(data?.folderId || 'root');
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
            const result = folderId === BOOKMARK.ROOT_ID
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
  }, [
    closeAppMenu,
    closeStarBookmarkEditor,
    currentProfile?.profileId,
    dispatch,
    handleAddProfile,
    handleEditCurrentProfile,
    onDeleteBrowsingData,
    onNewTab,
    onOpenHistory,
    onOpenSettings,
    openBookmarkEditorForCurrentPage,
    postStarEditorPatch,
  ]);

  useEffect(() => {
    const unsub = window.electronAPI?.onChromeShellMenuOverlaySuperseded?.(() => {
      if (pendingOwnStarResetRef.current || pendingOwnAppMenuResetRef.current) return;
      if (appMenuOpenRef.current) {
        appMenuOpenRef.current = false;
        setAppMenuOpen(false);
      }
      if (starEditorActiveRef.current) {
        starEditorActiveRef.current = false;
      }
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, []);

  useEffect(() => {
    if (!appMenuOpen) return;
    if (appMenuSkipRefreshRef.current) {
      appMenuSkipRefreshRef.current = false;
      return;
    }
    void postAppMenuPatch();
  }, [appMenuOpen, postAppMenuPatch]);

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
        ref={moreBtnRef}
        id="more-btn"
        className="btn"
        title="Customize and control InviSurf"
        aria-expanded={appMenuOpen}
        aria-haspopup="menu"
        onClick={openAppMenu}
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
        initialProfile={profileEditorMode === PROFILE.MODE_EDIT ? currentProfile : null}
        onClose={() => setProfileEditorOpen(false)}
        onSaved={handleProfileEditorSaved}
      />
    </div>
  );
}
