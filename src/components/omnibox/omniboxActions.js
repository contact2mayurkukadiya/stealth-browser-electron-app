import { menuFindSvg, adjustSvg, menuDownloadsSvg, cookieSvg, googleSvg, bingSvg, duckduckgoSvg, braveSvg } from '../../constants/appAssetUrls.js';
import { OMNIBOX_POPUP } from './omniboxConstants.js';
import { URL as URL_C } from '../../constants/conditionStrings.js';
import { isNtpOmniboxUrl } from '../../utils/omniboxDisplayUrl.js'; // Extract native URL parsing hook 

const SEARCH_ENGINES = {
  google: { name: 'Google', icon: googleSvg },
  bing: { name: 'Bing', icon: bingSvg },
  duckduckgo: { name: 'DuckDuckGo', icon: duckduckgoSvg },
  brave: { name: 'Brave', icon: braveSvg },
};


function isInternalUrl(url) {
  const u = String(url || '').toLowerCase();
  return u.startsWith(URL_C.SCHEME_INVISURF) || u.startsWith(URL_C.SCHEME_STEALTH);
}

function hasDisplayUrl(tab) {
  return !!(tab && !tab.isNewTab && tab.url);
}

export function getOmniboxActions(ctx) {
  const { tab, displayParts, isSecure, searchEngine = 'google', isFocused, hasUncommittedDraft, barDisplayValue } = ctx;

  // const showPageActions = hasDisplayUrl(tab) && !isInternalUrl(tab?.url);

  const actions = [];
  const rawUrl = tab?.url || barDisplayValue || '';
  const isNtp = !!tab?.isNewTab || isNtpOmniboxUrl(rawUrl) || (!tab?.url && !String(barDisplayValue || '').trim());
  const isInternal = isInternalUrl(rawUrl) && !isNtp;

  const activeEngine = SEARCH_ENGINES[String(searchEngine).toLowerCase()] || SEARCH_ENGINES.google;

  // Render left-side Prefix Block:
  // While NTP page is active, show the selected search engine icon.
  // When ANY site is loaded on the active tab, the padlock (siteInfo) button is always visible.
  if (isNtp) {
    actions.push({
      id: 'new-tab',
      slot: 'prefix',
      visible: true,
      nonClickable: true,
      isColorIcon: true,
      iconSrc: activeEngine.icon,
    });
  } else if (isInternal) {
    actions.push({
      id: 'search-engine-chip',
      slot: 'prefix',
      visible: true,
      nonClickable: true,
      isColorIcon: true,
      iconSrc: activeEngine.icon,
      chipText: activeEngine.name,
    });
  } else {
    actions.push({
      id: 'siteInfo',
      slot: 'prefix',
      title: 'View site information',
      visible: true,
      nonClickable: false,
      isColorIcon: false,
      opensPopup: OMNIBOX_POPUP.SITE_INFO,
      iconSrc: adjustSvg,
    });
  }

  // Inject Standard Downloads / Optional Extra suffixes
  actions.push({
    id: 'download',
    slot: 'suffix',
    title: 'Downloads',
    visible: false,
    isColorIcon: false,
    opensPopup: OMNIBOX_POPUP.DOWNLOAD,
    iconSrc: menuDownloadsSvg,
  });

  return actions.filter((a) => a.visible);

  // return [
  //   {
  //     id: 'siteInfo',
  //     slot: 'prefix',
  //     title: 'View site information',
  //     visible: showPageActions && !!displayParts,
  //     opensPopup: OMNIBOX_POPUP.SITE_INFO,
  //     iconType: isSecure ? 'tune' : 'search',
  //     iconSrc: isSecure ? adjustSvg : menuFindSvg,
  //   },
  //   {
  //     id: 'download',
  //     slot: 'suffix',
  //     title: 'Downloads',
  //     visible: false,
  //     opensPopup: OMNIBOX_POPUP.DOWNLOAD,
  //     iconType: 'download',
  //     iconSrc: menuDownloadsSvg,
  //   },
  // ].filter((a) => a.visible);
}
