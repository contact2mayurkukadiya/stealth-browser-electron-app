import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useChromeShellMenuOverlay } from '../context/ChromeOverlayContext';
import ProfileAvatar from './ProfileAvatar';
import './ProfileMenuButton.css';
import { OVERLAY } from '../constants/conditionStrings.js';

const CHEVRON = (
  <svg className="profile-menu__chevron-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden>
    <path fill="currentColor" d="M7 10l5 5 5-5z" />
  </svg>
);

/**
 * Navbar profile control: avatar + chevron opens menu (profiles + add new).
 * Menu UI renders in the chrome overlay WebContentsView (Tier 2) above the tab layer.
 */
export default function ProfileMenuButton({
  profiles = [],
  activeProfile = null,
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
  const { reset, acquire, release, post } = useChromeShellMenuOverlay();

  const close = useCallback(() => setOpen(false), []);
  openRef.current = open;

  const buttonProfile = activeProfile || profiles[0] || null;

  const syncMenuToOverlay = useCallback(async () => {
    if (!triggerRef.current) return;
    const br = triggerRef.current.getBoundingClientRect();
    const menuWidth = 260;
    let menuLeft = Math.round(br.right - menuWidth);
    menuLeft = Math.max(8, Math.min(menuLeft, window.innerWidth - menuWidth - 8));
    const menuTop = Math.round(br.bottom + 6);
    const payload = {
      kind: 'profileMenu',
      items: profiles.map((p) => ({
        profileId: p.profileId,
        label: p.displayName || p.profileId,
      })),
      showEdit: typeof onEditProfile === 'function' && !!activeProfile?.profileId,
      menuRect: { left: menuLeft, top: menuTop, width: menuWidth },
    };
    try {
      await post(payload);
    } catch (err) {
      console.error('ProfileMenuButton chromeShellMenuOverlayV1Post', err);
    }
  }, [profiles, activeProfile, onEditProfile, post]);

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
  }, [close, onOpenProfile, onEditProfile, onAddProfile]);

  return (
    <div className="profile-menu profile-menu--compact">
      <button
        ref={triggerRef}
        type="button"
        className="profile-menu__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        title={
          triggerTitle ||
          (buttonProfile ? `${buttonProfile.displayName || 'Profile'} — profiles` : 'Profiles')
        }
        onClick={() => setOpen((v) => !v)}
      >
        <ProfileAvatar profile={buttonProfile} size="md" compactTrigger />
        <span className="profile-menu__chevron" aria-hidden>
          {CHEVRON}
        </span>
      </button>
    </div>
  );
}
