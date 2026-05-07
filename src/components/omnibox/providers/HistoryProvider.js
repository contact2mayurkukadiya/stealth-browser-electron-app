import BaseProvider from './BaseProvider.js';

const MS_PER_DAY = 86_400_000;
const MAX_RESULTS = 6;

/**
 * HistoryProvider — surfaces visited URLs from the persisted history store.
 *
 * Frecency scoring:
 *   Exact URL match:    900–1000
 *   Partial URL/title:  600–850, decayed by age (recency weight)
 *
 * The history list is loaded once and cached; it refreshes after each
 * navigation (the cache TTL is 30 seconds to avoid stale data on long sessions).
 */
export default class HistoryProvider extends BaseProvider {
  constructor() {
    super();
    /** @type {Array<{url: string, title: string, timestamp: number}>} */
    this._cache = [];
    this._loadedAt = 0;
    this._loading = false;
  }

  /** Ensures cache is warm; re-fetches if older than 30 s. */
  async _ensureCache() {
    const age = Date.now() - this._loadedAt;
    if (this._cache.length > 0 && age < 30_000) return;
    if (this._loading) return;

    this._loading = true;
    try {
      const raw = await window.electronAPI.historyGet();
      if (Array.isArray(raw)) {
        // historyGet returns newest-first; keep that order
        this._cache = raw.filter(e => e && e.url);
      }
      this._loadedAt = Date.now();
    } catch (err) {
      console.warn('[HistoryProvider] Failed to load history:', err);
    } finally {
      this._loading = false;
    }
  }

  /** Invalidates the cache so the next query triggers a fresh load. */
  invalidate() {
    this._loadedAt = 0;
  }

  /**
   * @param {string} inputText
   * @returns {Promise<Array>}
   */
  async getSuggestions(inputText) {
    await this._ensureCache();

    const query = inputText.trim().toLowerCase();
    if (!query) return [];

    const now = Date.now();
    const seen = new Set();
    const results = [];

    for (const entry of this._cache) {
      const urlLower = (entry.url || '').toLowerCase();
      const titleLower = (entry.title || '').toLowerCase();

      const exactUrl = urlLower === query || urlLower === `https://${query}` || urlLower === `http://${query}`;
      const urlMatch = urlLower.includes(query);
      const titleMatch = titleLower.includes(query);

      if (!exactUrl && !urlMatch && !titleMatch) continue;

      // Deduplicate by URL — keep first (highest recency, since list is newest-first)
      if (seen.has(entry.url)) continue;
      seen.add(entry.url);

      const daysSince = Math.max(0, (now - entry.timestamp) / MS_PER_DAY);
      const recencyWeight = 1 / (1 + daysSince * 0.1);

      let baseScore;
      if (exactUrl) {
        baseScore = 950;
      } else if (urlLower.startsWith(query)) {
        baseScore = 850;
      } else if (urlMatch) {
        baseScore = 700;
      } else if (titleLower.startsWith(query)) {
        baseScore = 680;   // title starts with query
      } else {
        baseScore = 620;   // title contains query somewhere
      }

      const score = Math.round(baseScore * recencyWeight);

      // Surface the matched field as the primary text so the user can see
      // what they typed against. Title-only matches show the page title
      // prominently; URL matches (or both) show the URL prominently.
      const titleOnly = titleMatch && !urlMatch && !exactUrl;
      const primaryText   = titleOnly ? (entry.title || entry.url) : entry.url;
      const secondaryText = titleOnly ? entry.url : (entry.title || entry.url);

      results.push({
        text:        primaryText,
        url:         entry.url,
        type:        'history',
        score,
        description: secondaryText,
        favicon:     null,
      });

      if (results.length >= MAX_RESULTS) break;
    }

    return results;
  }
}
