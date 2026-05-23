import BaseProvider from './BaseProvider.js';

/**
 * HistoryProvider — asks the main-process SQLCipher history service for a
 * small frecency-ranked suggestion set. The renderer never loads full history.
 */
export default class HistoryProvider extends BaseProvider {
  constructor() {
    super();
    this._queryId = 0;
  }

  /**
   * @param {string} inputText
   * @returns {Promise<Array>}
   */
  async getSuggestions(inputText) {
    const query = inputText.trim();
    if (!query) return [];

    const queryId = ++this._queryId;
    try {
      const raw = await window.electronAPI.historyGetSuggestions(query);
      if (queryId !== this._queryId) return [];
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((entry) => entry && entry.url)
        .map((entry) => ({
          text: entry.text || entry.url,
          url: entry.url,
          type: 'history',
          score: Number.isFinite(Number(entry.score)) ? Number(entry.score) : 0,
          description: entry.description || entry.title || entry.url,
          favicon: entry.favicon || null,
        }));
    } catch (err) {
      console.warn('[HistoryProvider] Failed to load history suggestions:', err);
      return [];
    }
  }
}
