/**
 * BaseProvider — contract all autocomplete providers must implement.
 *
 * Suggestion shape:
 *   {
 *     text:        string   — primary display text shown in the dropdown
 *     url:         string   — the URL navigated to on selection
 *     type:        string   — 'history' | 'search' | 'keyword' | 'bookmark' | 'url'
 *     score:       number   — 0–1000 relevance (higher = ranked first)
 *     description: string   — secondary muted label (page title, domain, "Search for…")
 *     favicon:     string|null — favicon URL or null for generic icon
 *   }
 */
export default class BaseProvider {
  /** @param {string} _inputText @returns {Promise<Array>} */
  async getSuggestions(_inputText) {
    return [];
  }
}
