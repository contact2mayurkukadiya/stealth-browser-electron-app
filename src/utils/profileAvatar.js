/** Two-letter initials for avatar display (Chrome-style). */
export function profileInitials(displayName) {
  const s = (displayName || '?').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  }
  return s.slice(0, 2).toUpperCase() || '?';
}

/** Stable hue from profile id for avatar background. */
export function profileAvatarHue(profileId) {
  let h = 0;
  const id = String(profileId || '');
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) % 360;
  }
  return h;
}

export function profileAvatarBackground(profileId) {
  const h = profileAvatarHue(profileId);
  return `hsl(${h} 52% 42%)`;
}
