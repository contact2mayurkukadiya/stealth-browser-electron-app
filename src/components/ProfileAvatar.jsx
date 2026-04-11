import React, { useEffect, useState } from 'react';
import { profileInitials, profileAvatarBackground } from '../utils/profileAvatar';
import './ProfileAvatar.css';

/**
 * Circular avatar: custom image when available, else initials on colored background.
 * Optional imageOverride (data URL or app:// asset URL) skips IPC (e.g. editor preview).
 */
export default function ProfileAvatar({
  profile,
  size = 'md',
  compactTrigger = false,
  imageOverride = undefined,
}) {
  const [dataUrl, setDataUrl] = useState(null);
  const pid = profile?.profileId || '';
  const name = profile?.displayName || profile?.profileId || '?';
  const initials = profileInitials(name);
  const bg = profile ? profileAvatarBackground(pid) : 'hsl(0 0% 45%)';

  let sizeClass = 'profile-avatar--md';
  if (size === 'lg') sizeClass = 'profile-avatar--lg';
  else if (size === 'sm') sizeClass = 'profile-avatar--sm';
  else if (compactTrigger) sizeClass = 'profile-avatar--md-compact';

  const showImg = imageOverride !== undefined ? !!imageOverride : !!dataUrl;
  const imgSrc = imageOverride !== undefined ? imageOverride : dataUrl;

  useEffect(() => {
    if (imageOverride !== undefined) return;
    const pid = profile?.profileId;
    if (!profile?.hasCustomAvatar || !pid || String(pid).startsWith('__')) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await window.electronAPI.profileGetAvatarDataUrl?.(pid);
        if (!cancelled && r?.dataUrl) setDataUrl(r.dataUrl);
        else if (!cancelled) setDataUrl(null);
      } catch {
        if (!cancelled) setDataUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.profileId, profile?.hasCustomAvatar, profile?.updatedAt, imageOverride]);

  const presetInset = showImg && imgSrc && profile?.avatarSource === 'preset';

  return (
    <span
      className={`profile-avatar profile-avatar--wrap ${sizeClass}${presetInset ? ' profile-avatar--photo-preset' : ''}`}
      style={showImg && imgSrc ? undefined : { background: bg }}
    >
      {showImg && imgSrc ? (
        <img className="profile-avatar__img" src={imgSrc} alt="" draggable={false} />
      ) : (
        <span className="profile-avatar__initials" aria-hidden>{initials}</span>
      )}
    </span>
  );
}
