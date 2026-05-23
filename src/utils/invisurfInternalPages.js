import { URL as URL_C } from '../constants/conditionStrings.js';

/**
 * Tabs that should show the InvSurf wordmark favicon (theme-aware) instead of a generic globe.
 */
export function isInvsurfBrandedInternalTab(tab) {
  if (!tab) return false;
  if (tab.isNewTab) return true;
  const raw = (tab.url || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower === URL_C.NTP_DISPLAY || lower.startsWith(URL_C.NTP_LOCALHOST_PREFIX)) return true;
  if (lower.includes(URL_C.PATH_NEWTAB_HTML)) return true;
  if (lower === URL_C.HISTORY_DISPLAY || lower.startsWith(URL_C.HISTORY_DISPLAY)) return true;
  if (lower === URL_C.STEALTH_HISTORY || lower.startsWith(URL_C.STEALTH_HISTORY)) return true;
  if (lower === URL_C.SETTINGS_DISPLAY || lower.startsWith(URL_C.SETTINGS_DISPLAY)) return true;
  if (lower === URL_C.STEALTH_SETTINGS || lower.startsWith(URL_C.STEALTH_SETTINGS)) return true;
  if (lower.includes(URL_C.PATH_HISTORY_HTML)) return true;
  if (lower.includes(URL_C.PATH_SETTINGS_HTML)) return true;
  return false;
}
