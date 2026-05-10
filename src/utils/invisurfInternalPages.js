/**
 * Tabs that should show the InvSurf wordmark favicon (theme-aware) instead of a generic globe.
 */
export function isInvsurfBrandedInternalTab(tab) {
  if (!tab) return false;
  if (tab.isNewTab) return true;
  const raw = (tab.url || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower === 'app://newtab' || lower.startsWith('app://localhost/dist/newtab')) return true;
  if (lower.includes('/dist/newtab.html')) return true;
  if (lower === 'invisurf://history' || lower.startsWith('invisurf://history')) return true;
  if (lower === 'stealth://history' || lower.startsWith('stealth://history')) return true;
  if (lower === 'invisurf://settings' || lower.startsWith('invisurf://settings')) return true;
  if (lower === 'stealth://settings' || lower.startsWith('stealth://settings')) return true;
  if (lower.includes('/dist/history.html')) return true;
  if (lower.includes('/dist/settings.html')) return true;
  return false;
}
