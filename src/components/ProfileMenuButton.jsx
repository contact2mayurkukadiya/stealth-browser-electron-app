import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useChromeShellMenuOverlay } from '../context/ChromeOverlayContext';
import ProfileAvatar from './ProfileAvatar';
import { PROFILE_MENU_WIDTH } from '../utils/profileMenuRows';
import './ProfileMenuButton.css';
import { OVERLAY } from '../constants/conditionStrings.js';

/**
 * Navbar profile control: avatar circle opens Chrome-style profile menu
 * (same rows as three-dot menu profile submenu) in the shell menu overlay.
 */
export default function ProfileMenuButton({
  profiles = [],
  activeProfile = null,
  getProfileMenuRows,
  prepareProfileMenu,
  onProfileMenuCommand,
  onOpenProfile,
  onAddProfile,
  onEditProfile,
  triggerTitle,
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const openRef = useRef(false);
  /** True while this control's `reset()` is in flight so we ignore self-triggered superseded. */
  const pendingOwnResetRef = useRef(false);
  /** Main `chrome-overlay:v1:reset` cleared our acquire; effect cleanup must not call `release()`. */
  const leaseRevokedByResetRef = useRef(false);
  const getProfileMenuRowsRef = useRef(getProfileMenuRows);
  const prepareProfileMenuRef = useRef(prepareProfileMenu);
  const { reset, acquire, release, post } = useChromeShellMenuOverlay();

  const close = useCallback(() => setOpen(false), []);
  openRef.current = open;
  getProfileMenuRowsRef.current = getProfileMenuRows;
  prepareProfileMenuRef.current = prepareProfileMenu;

  const buttonProfile = activeProfile || profiles[0] || null;

  const syncMenuToOverlay = useCallback(async () => {
    if (!triggerRef.current) return;
    const br = triggerRef.current.getBoundingClientRect();
    const menuWidth = PROFILE_MENU_WIDTH;
    let menuLeft = Math.round(br.right - menuWidth);
    menuLeft = Math.max(8, Math.min(menuLeft, window.innerWidth - menuWidth - 8));
    const menuTop = Math.round(br.bottom + 6);
    const getRows = getProfileMenuRowsRef.current;
    const rawRows = typeof getRows === 'function' ? getRows() : [];
    // Strip base64 data: URLs from avatar.src — the overlay falls back to initials.
    // This keeps the payload under CHROME_OVERLAY_POST_MAX_BYTES (256 KB).
    const rows = Array.isArray(rawRows) ? rawRows.map((row) => {
      if (!row || !row.avatar || !row.avatar.src) return row;
      if (String(row.avatar.src).startsWith('data:')) {
        return { ...row, avatar: { ...row.avatar, src: null } };
      }
      return row;
    }) : [];
    const payload = {
      kind: 'profileMenu',
      items: rows,
      menuRect: { left: menuLeft, top: menuTop, width: menuWidth },
    };
    try {
      await post(payload);
    } catch (err) {
      console.error('ProfileMenuButton chromeShellMenuOverlayV1Post', err);
    }
  }, [post]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      pendingOwnResetRef.current = true;
      try {
        await reset();
        await acquire();
        if (cancelled) {
          await release();
          return;
        }
        const prepare = prepareProfileMenuRef.current;
        if (typeof prepare === 'function') {
          await prepare();
        }
        if (cancelled) {
          await release();
          return;
        }
        await syncMenuToOverlay();
      } catch (err) {
        console.error('ProfileMenuButton overlay open', err);
      } finally {
        pendingOwnResetRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
      pendingOwnResetRef.current = false;
      if (leaseRevokedByResetRef.current) {
        leaseRevokedByResetRef.current = false;
        return;
      }
      void release();
    };
  }, [open, reset, acquire, release, syncMenuToOverlay]);

  useEffect(() => {
    if (!open) return;
    void syncMenuToOverlay();
  }, [profiles, activeProfile, open, syncMenuToOverlay]);

  useEffect(() => {
    if (!open) return undefined;
    const onResize = () => {
      void syncMenuToOverlay();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, syncMenuToOverlay]);

  useEffect(() => {
    const unsub = window.electronAPI?.onChromeShellMenuOverlaySuperseded?.(() => {
      if (pendingOwnResetRef.current) return;
      if (!openRef.current) return;
      leaseRevokedByResetRef.current = true;
      close();
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, [close]);

  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlayV1HostEvent?.((data) => {
      if (!openRef.current) return;
      const t = data?.type;
      if (t === OVERLAY.DISMISS) {
        close();
        return;
      }
      if (t === OVERLAY.APP_MENU_COMMAND) {
        close();
        if (typeof onProfileMenuCommand === 'function') {
          onProfileMenuCommand(data);
        }
        return;
      }
      // Legacy overlay events (simple profile menu payloads)
      if (t === OVERLAY.SELECT_PROFILE) {
        close();
        onOpenProfile?.(data.profileId);
        return;
      }
      if (t === OVERLAY.EDIT_PROFILE) {
        close();
        onEditProfile?.();
        return;
      }
      if (t === OVERLAY.ADD_PROFILE) {
        close();
        onAddProfile?.();
      }
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, [close, onProfileMenuCommand, onOpenProfile, onEditProfile, onAddProfile]);

  return (
    <div className="profile-menu">
      <button
        ref={triggerRef}
        type="button"
        className="profile-menu__trigger profile-menu__trigger--avatar-only"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          buttonProfile
            ? `Profiles — ${buttonProfile.displayName || 'Profile'}`
            : 'Profiles'
        }
        title={
          triggerTitle ||
          (buttonProfile ? `${buttonProfile.displayName || 'Profile'} — profiles` : 'Profiles')
        }
        onClick={() => setOpen((v) => !v)}
      >
        <ProfileAvatar profile={buttonProfile} size="md" />
      </button>
    </div>
  );
}
