import { INPUT_KIND } from '../../constants/conditionStrings.js';

/**
 * AutocompleteInput — classifies raw omnibox text and builds navigation/search URLs.
 *
 * Classification rules (in priority order):
 *   1. 'keyword'  — starts with a registered keyword shortcut followed by a space
 *   2. 'url'      — matches URL-like patterns (has scheme, or no spaces + has a dot)
 *   3. 'search'   — everything else
 */

const KEYWORD_SHORTCUTS = {
  yt: 'https://www.youtube.com/results?search_query=',
  gh: 'https://github.com/search?q=',
  mdn: 'https://developer.mozilla.org/search?q=',
  so: 'https://stackoverflow.com/search?q=',
  npm: 'https://www.npmjs.com/search?q=',
};

/** Search engine base URLs — mirrors the map in main.js. */
const SEARCH_ENGINE_URLS = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  brave: 'https://search.brave.com/search?q=',
  duckDuckGo: 'https://duckduckgo.com/?q=',
};

/**
 * Returns a search URL for the given engine and query.
 * Falls back to Google when the engine key is unrecognised.
 * @param {string} engine
 * @param {string} query
 * @returns {string}
 */
export function buildSearchUrl(engine, query) {
  const base = SEARCH_ENGINE_URLS[engine] || SEARCH_ENGINE_URLS.google;
  return base + encodeURIComponent(query);
}

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
  if (!trimmed) return INPUT_KIND.SEARCH;

  // Keyword: "yt foo" — keyword token + space + query
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx > 0) {
    const keyword = trimmed.slice(0, spaceIdx).toLowerCase();
    if (KEYWORD_SHORTCUTS[keyword]) return INPUT_KIND.KEYWORD;
  }

  if (looksLikeUrl(trimmed)) return INPUT_KIND.URL;
  return INPUT_KIND.SEARCH;
}

/**
 * Converts raw text to a navigable URL.
 * For URLs missing a scheme, prepends https://.
 * For searches, builds a search URL using the specified engine.
 * @param {string} text
 * @param {string} [engine='google']
 * @returns {string}
 */
export function toNavigateUrl(text, engine = 'google') {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  const kind = classifyInput(trimmed);

  if (kind === INPUT_KIND.KEYWORD) {
    const spaceIdx = trimmed.indexOf(' ');
    const keyword = trimmed.slice(0, spaceIdx).toLowerCase();
    const query = trimmed.slice(spaceIdx + 1).trim();
    const base = KEYWORD_SHORTCUTS[keyword];
    return base + encodeURIComponent(query);
  }

  if (kind === INPUT_KIND.URL) {
    if (SCHEME_RE.test(trimmed)) return trimmed;
    if (LOCALHOST_RE.test(trimmed)) return `http://${trimmed}`;
    return `https://${trimmed}`;
  }

  return toSearchUrl(trimmed, engine);
}

/**
 * Builds a search URL for the given query string using the specified engine.
 * @param {string} query
 * @param {string} [engine='google']
 * @returns {string}
 */
export function toSearchUrl(query, engine = 'google') {
  return buildSearchUrl(engine, query);
}

export { KEYWORD_SHORTCUTS };
