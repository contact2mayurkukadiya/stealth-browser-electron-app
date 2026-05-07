/**
 * AutocompleteInput — classifies raw omnibox text and builds navigation/search URLs.
 *
 * Classification rules (in priority order):
 *   1. 'keyword'  — starts with a registered keyword shortcut followed by a space
 *   2. 'url'      — matches URL-like patterns (has scheme, or no spaces + has a dot)
 *   3. 'search'   — everything else
 */

const KEYWORD_SHORTCUTS = {
  yt:  'https://www.youtube.com/results?search_query=',
  gh:  'https://github.com/search?q=',
  mdn: 'https://developer.mozilla.org/search?q=',
  so:  'https://stackoverflow.com/search?q=',
  npm: 'https://www.npmjs.com/search?q=',
};

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//;
const LOCALHOST_RE = /^localhost(:\d+)?(\/.*)?$/;
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/;

/** Returns whether raw text looks like a navigable URL. */
function looksLikeUrl(text) {
  if (!text || text.trim() === '') return false;
  const trimmed = text.trim();

  if (SCHEME_RE.test(trimmed)) return true;
  if (LOCALHOST_RE.test(trimmed)) return true;
  if (IP_RE.test(trimmed)) return true;

  // No spaces, contains a dot (e.g. "github.com/foo")
  if (!trimmed.includes(' ') && trimmed.includes('.')) return true;

  return false;
}

/**
 * Returns 'url' | 'search' | 'keyword'.
 * @param {string} text
 * @returns {'url'|'search'|'keyword'}
 */
export function classifyInput(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return 'search';

  // Keyword: "yt foo" — keyword token + space + query
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx > 0) {
    const keyword = trimmed.slice(0, spaceIdx).toLowerCase();
    if (KEYWORD_SHORTCUTS[keyword]) return 'keyword';
  }

  if (looksLikeUrl(trimmed)) return 'url';
  return 'search';
}

/**
 * Converts raw text to a navigable URL.
 * For URLs missing a scheme, prepends https://.
 * For searches, builds a Google search URL.
 * @param {string} text
 * @returns {string}
 */
export function toNavigateUrl(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return 'https://www.google.com/';

  const kind = classifyInput(trimmed);

  if (kind === 'keyword') {
    const spaceIdx = trimmed.indexOf(' ');
    const keyword = trimmed.slice(0, spaceIdx).toLowerCase();
    const query = trimmed.slice(spaceIdx + 1).trim();
    const base = KEYWORD_SHORTCUTS[keyword];
    return base + encodeURIComponent(query);
  }

  if (kind === 'url') {
    if (SCHEME_RE.test(trimmed)) return trimmed;
    if (LOCALHOST_RE.test(trimmed)) return `http://${trimmed}`;
    return `https://${trimmed}`;
  }

  return toSearchUrl(trimmed);
}

/**
 * Builds a Google search URL for the given query string.
 * @param {string} query
 * @returns {string}
 */
export function toSearchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

export { KEYWORD_SHORTCUTS };
