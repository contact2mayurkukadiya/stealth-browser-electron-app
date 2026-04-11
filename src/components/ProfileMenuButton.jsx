import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTabOverlay } from '../context/TabOverlayContext';
import ProfileAvatar from './ProfileAvatar';
import './ProfileMenuButton.css';

const CHEVRON = (
  <svg className="profile-menu__chevron-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden>
    <path fill="currentColor" d="M7 10l5 5 5-5z" />
  </svg>
);

/**
 * Navbar profile control: avatar + chevron opens menu (profiles + add new).
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
  const rootRef = useRef(null);
  const { beginOverlay, endOverlay } = useTabOverlay();

  const buttonProfile = activeProfile || profiles[0] || null;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) {
      endOverlay();
      return undefined;
    }
    (async () => {
      await beginOverlay();
    })();
    return () => {
      endOverlay();
    };
  }, [open, beginOverlay, endOverlay]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        close();
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const handleSelect = useCallback(
    (profileId) => {
      close();
      onOpenProfile?.(profileId);
    },
    [close, onOpenProfile],
  );

  const handleAdd = useCallback(async () => {
    close();
    await onAddProfile?.();
  }, [close, onAddProfile]);

  return (
    <div className="profile-menu profile-menu--compact" ref={rootRef}>
      <button
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

      {open && (
        <div className="profile-menu__dropdown" role="menu">
          {profiles.map((p) => (
            <button
              key={p.profileId}
              type="button"
              role="menuitem"
              className="profile-menu__row"
              onClick={() => handleSelect(p.profileId)}
            >
              <ProfileAvatar profile={p} size="sm" />
              <span className="profile-menu__row-label">{p.displayName || p.profileId}</span>
            </button>
          ))}
          {typeof onEditProfile === 'function' && activeProfile?.profileId && (
            <>
              <div className="profile-menu__divider" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="profile-menu__row"
                onClick={() => {
                  close();
                  onEditProfile();
                }}
              >
                <span className="profile-menu__row-label">Edit profile…</span>
              </button>
            </>
          )}
          <div className="profile-menu__divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="profile-menu__row profile-menu__row--add"
            onClick={handleAdd}
          >
            <span className="profile-menu__add-icon" aria-hidden>
              +
            </span>
            <span>Add new profile</span>
          </button>
        </div>
      )}
    </div>
  );
}
