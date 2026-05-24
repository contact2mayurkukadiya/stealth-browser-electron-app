import { URL as URL_C } from '../constants/conditionStrings.js';

/** True when the URL is a new-tab sentinel and must not appear in the omnibox. */
export function isNtpOmniboxUrl(url) {
  if (url == null || !String(url).trim()) return true;
  const lower = String(url).trim().toLowerCase();
  if (lower === URL_C.NTP_DISPLAY || lower.startsWith(URL_C.NTP_LOCALHOST_PREFIX)) return true;
  return lower.startsWith(URL_C.SCHEME_APP) && lower.includes(URL_C.FRAGMENT_NEWTAB);
}

/** Omnibox bar value — never shows internal new-tab pseudo-URLs. */
export function toOmniboxBarValue(url) {
  return isNtpOmniboxUrl(url) ? '' : String(url || '');
}

/**
 * Splits a tab URL into omnibox overlay segments for unfocused display.
 * @returns {{ prefix: string, domain: string, suffix: string } | null}
 */
export function buildDisplayParts(url) {
  if (!url || url.startsWith(URL_C.SCHEME_APP) || url === URL_C.NEW_TAB_LABEL) return null;
  try {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol + '//';

    if (urlObj.protocol === URL_C.PROTOCOL_INVISURF) {
      const isBareHostWithSlash = url.endsWith('/')
        && urlObj.pathname === '/'
        && !urlObj.search
        && !urlObj.hash;
      const full = isBareHostWithSlash ? url.slice(0, -1) : url;
      const canonicalScheme = URL_C.SCHEME_INVISURF;
      const displayScheme = URL_C.SCHEME_INVISURF_DISPLAY;
      const rest = full.toLowerCase().startsWith(canonicalScheme)
        ? full.slice(canonicalScheme.length)
        : full;
      return {
        prefix: displayScheme,
        domain: rest,
        suffix: '',
      };
    }

    let displayUrl = url.replace(protocol, '');
    if (displayUrl.endsWith('/') && displayUrl.split('/').length === 2) {
      displayUrl = displayUrl.slice(0, -1);
    }
    const domain = urlObj.hostname;
    const idx = displayUrl.indexOf(domain);
    if (idx === -1) return { prefix: '', domain: displayUrl, suffix: '' };
    return {
      prefix: displayUrl.substring(0, idx),
      domain,
      suffix: displayUrl.substring(idx + domain.length),
    };
  } catch {
    return { prefix: '', domain: url, suffix: '' };
  }
}
