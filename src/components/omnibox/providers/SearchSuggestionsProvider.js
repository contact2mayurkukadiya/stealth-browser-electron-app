import BaseProvider from './BaseProvider.js';

const SUGGEST_BASE = 'https://suggestqueries.google.com/complete/search?client=firefox&q=';
const DEBOUNCE_MS = 150;
const MAX_RESULTS = 5;

/**
 * SearchSuggestionsProvider — fetches real-time suggestions from the Google
 * Suggest API. Requests are debounced and aborted when superseded.
 *
 * Score range: 600 (first/best suggestion) → 400 (last), mapped linearly.
 *
 * CORS: Electron renderers can usually reach the endpoint directly. If the
 * request is blocked (net::ERR_FAILED or a CORS error), the provider silently
 * returns [] so history results are unaffected.
 */
export default class SearchSuggestionsProvider extends BaseProvider {
  constructor() {
    super();
    this._debounceTimer = null;
    this._controller = null;
  }

  /**
   * @param {string} inputText
   * @returns {Promise<Array>}
   */
  getSuggestions(inputText) {
    const query = inputText.trim();
    if (!query) return Promise.resolve([]);

    // Cancel any in-flight request
    if (this._controller) {
      this._controller.abort();
      this._controller = null;
    }

    return new Promise((resolve) => {
      clearTimeout(this._debounceTimer);

      this._debounceTimer = setTimeout(async () => {
        this._controller = new AbortController();
        const { signal } = this._controller;

        try {
          const url = SUGGEST_BASE + encodeURIComponent(query);
          const response = await fetch(url, { signal });

          if (!response.ok) {
            resolve([]);
            return;
          }

          // Google Suggest returns [query, [suggestions], ...]
          const data = await response.json();
          const suggestions = Array.isArray(data[1]) ? data[1] : [];
          const total = Math.min(suggestions.length, MAX_RESULTS);

          const results = suggestions.slice(0, total).map((text, i) => {
            const score = Math.round(600 - (i / Math.max(total - 1, 1)) * 200);
            return {
              text,
              url: `https://www.google.com/search?q=${encodeURIComponent(text)}`,
              type: 'search',
              score,
              description: 'Search Google',
              favicon: null,
            };
          });

          resolve(results);
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.warn('[SearchSuggestionsProvider] Fetch failed:', err.message);
          }
          resolve([]);
        } finally {
          this._controller = null;
        }
      }, DEBOUNCE_MS);
    });
  }

  /** Cancel pending debounce + in-flight request (call on unmount). */
  dispose() {
    clearTimeout(this._debounceTimer);
    if (this._controller) {
      this._controller.abort();
      this._controller = null;
    }
  }
}
