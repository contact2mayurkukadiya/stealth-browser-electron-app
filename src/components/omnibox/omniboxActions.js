import { menuFindSvg, adjustSvg, menuDownloadsSvg, cookieSvg } from '../../constants/appAssetUrls.js';
import { OMNIBOX_POPUP } from './omniboxConstants.js';
import { URL as URL_C } from '../../constants/conditionStrings.js';

function isInternalUrl(url) {
  const u = String(url || '').toLowerCase();
  return u.startsWith(URL_C.SCHEME_INVISURF) || u.startsWith(URL_C.SCHEME_STEALTH);
}

function hasDisplayUrl(tab) {
  return !!(tab && !tab.isNewTab && tab.url);
}

/**
 * Declarative prefix/suffix actions for the omnibox bar.
 * @param {{ tab: object|null, displayParts: object|null, isSecure: boolean }} ctx
 */
export function getOmniboxActions(ctx) {
  const { tab, displayParts, isSecure } = ctx;
  const showPageActions = hasDisplayUrl(tab) && !isInternalUrl(tab?.url);

  return [
    {
      id: 'siteInfo',
      slot: 'prefix',
      title: 'View site information',
      visible: showPageActions && !!displayParts,
      opensPopup: OMNIBOX_POPUP.SITE_INFO,
      iconType: isSecure ? 'tune' : 'search',
      iconSrc: isSecure ? adjustSvg : menuFindSvg,
    },
    {
      id: 'download',
      slot: 'suffix',
      title: 'Downloads',
      visible: false,
      opensPopup: OMNIBOX_POPUP.DOWNLOAD,
      iconType: 'download',
      iconSrc: menuDownloadsSvg,
    },
  ].filter((a) => a.visible);
}
