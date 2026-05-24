/**
 * Static assets under renderer/assets/, served via app:// (see main.js).
 * Do not use for SVGs that rely on currentColor or CSS fill/stroke — those must stay inline.
 */
const BASE = 'app://localhost/assets/images';
const ASSETS_BASE = 'app://localhost/assets';

/** Dark-violet artwork for light surfaces */
export const logoPurpleLightSvg = `${ASSETS_BASE}/logo/purple-light.svg`;
/** Lavender / light artwork for dark surfaces */
export const logoPurpleDarkSvg = `${ASSETS_BASE}/logo/purple-dark.svg`;
/** Incognito mark for light backgrounds (optional / legacy) */
export const logoIcognitoLightSvg = `${ASSETS_BASE}/logo/purple-icognito-light.svg`;
/** Stealth tab strip, NTP hero, and internal-page favicon — dark-chrome artwork */
export const logoIcognitoDarkSvg = `${ASSETS_BASE}/logo/purple-icognito-dark.svg`;
export const tabCloseSvg = `${BASE}/tab-close.svg`;
export const tabAddSvg = `${BASE}/tab-add.svg`;
export const navBackSvg = `${BASE}/nav-back.svg`;
export const navForwardSvg = `${BASE}/nav-forward.svg`;
export const navReloadSvg = `${BASE}/nav-reload.svg`;
export const bookmarkStarFilledSvg = `${BASE}/bookmark-star-filled.svg`;
export const bookmarkAddFolderSvg = `${BASE}/bookmark-add-folder.svg`;
export const historyGoogleLogoSvg = `${BASE}/history-google-logo.svg`;
export const menuNewTabSvg = `${BASE}/menu-new-tab.svg`;
export const menuNewWindowSvg = `${BASE}/menu-new-window.svg`;
export const menuStealthWindowSvg = `${BASE}/menu-stealth-window.svg`;
export const menuProfileSvg = `${BASE}/menu-profile.svg`;
export const menuHistorySvg = `${BASE}/menu-history.svg`;
export const menuSettingsSvg = `${BASE}/menu-settings.svg`;
export const menuEditProfileSvg = `${BASE}/menu-edit-profile.svg`;
export const menuCloseProfileSvg = `${BASE}/menu-close-profile.svg`;
export const menuAddProfileSvg = `${BASE}/menu-add-profile.svg`;
export const menuManageProfilesSvg = `${BASE}/menu-manage-profiles.svg`;
export const menuTabSvg = `${BASE}/menu-tab.svg`;
export const menuDownloadsSvg = `${BASE}/menu-downloads.svg`;
export const menuBookmarksSvg = `${BASE}/menu-bookmarks.svg`;
export const menuDeleteDataSvg = `${BASE}/menu-delete-data.svg`;
export const menuPrintSvg = `${BASE}/menu-print.svg`;
export const menuLensSvg = `${BASE}/menu-lens.svg`;
export const menuFindSvg = `${BASE}/menu-find.svg`;
export const menuCutSvg = `${BASE}/menu-cut.svg`;
export const menuCopySvg = `${BASE}/menu-copy.svg`;
export const menuPasteSvg = `${BASE}/menu-paste.svg`;
