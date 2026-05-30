import { profileAvatarBackground, profileInitials } from './profileAvatar';
import { PROFILE } from '../constants/conditionStrings.js';
import {
  menuAddProfileSvg,
  menuCloseProfileSvg,
  menuEditProfileSvg,
  menuManageProfilesSvg,
} from '../constants/appAssetUrls';

/** Width matches three-dot app menu profile submenu. */
export const PROFILE_MENU_WIDTH = 320;

/**
 * Avatar payload for chrome overlay `makeRow` (app menu / profile menu).
 */
export function buildProfileAvatarPayload(profile, avatarDataByProfileId = {}) {
  if (!profile?.profileId) return null;
  const label = profile.displayName || profile.profileId;
  return {
    src: avatarDataByProfileId[profile.profileId] || null,
    initials: profileInitials(label),
    background: profileAvatarBackground(profile.profileId),
    preset: profile.avatarSource === PROFILE.AVATAR_PRESET,
  };
}

/**
 * Chrome-style profile submenu rows (signed-in header, other profiles, add/manage).
 */
export function buildProfileMenuRows({ profiles = [], activeProfile = null, avatarDataByProfileId = {} }) {
  const profileList = Array.isArray(profiles) ? profiles : [];
  const activeProfileLabel = activeProfile?.displayName || activeProfile?.profileId || 'Profile';
  const activeProfileAvatar = buildProfileAvatarPayload(activeProfile, avatarDataByProfileId);

  return [
    {
      header: true,
      label: `Signed in as ${activeProfileLabel}`,
      avatar: activeProfileAvatar,
      highlight: true,
    },
    { type: 'separator' },
    {
      iconSrc: menuEditProfileSvg,
      label: 'Customize Your Chrome',
      commandId: 'customizeCurrentProfile',
    },
    {
      iconSrc: menuCloseProfileSvg,
      label: 'Close This Profile',
      commandId: 'closeCurrentProfile',
    },
    { type: 'separator' },
    { header: true, label: 'Other Chrome Profiles' },
    ...profileList
      .filter((p) => p?.profileId && p.profileId !== activeProfile?.profileId)
      .map((p) => ({
        avatar: buildProfileAvatarPayload(p, avatarDataByProfileId),
        label: p.displayName || p.profileId,
        commandId: 'openProfile',
        profileId: p.profileId,
      })),
    { type: 'separator' },
    { iconSrc: menuAddProfileSvg, label: 'Add New Profile', commandId: 'addProfile' },
    { iconSrc: menuManageProfilesSvg, label: 'Manage Chrome Profiles', commandId: 'manageProfiles' },
  ];
}
