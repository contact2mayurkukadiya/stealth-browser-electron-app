/**
 * Static assets under renderer/assets/, served via app:// (see main.js).
 * Do not use for SVGs that rely on currentColor or CSS fill/stroke — those must stay inline.
 */
const BASE = 'app://localhost/assets/images';
const ASSETS_BASE = 'app://localhost/assets';

export const logoPurpleLightSvg = `${ASSETS_BASE}/logo/purple-light.svg`;

export const tabStealthSvg = `${BASE}/tab-stealth.svg`;
export const tabCloseSvg = `${BASE}/tab-close.svg`;
export const tabAddSvg = `${BASE}/tab-add.svg`;
export const navBackSvg = `${BASE}/nav-back.svg`;
export const navForwardSvg = `${BASE}/nav-forward.svg`;
export const navReloadSvg = `${BASE}/nav-reload.svg`;
export const bookmarkStarFilledSvg = `${BASE}/bookmark-star-filled.svg`;
export const bookmarkAddFolderSvg = `${BASE}/bookmark-add-folder.svg`;
export const historyGoogleLogoSvg = `${BASE}/history-google-logo.svg`;
