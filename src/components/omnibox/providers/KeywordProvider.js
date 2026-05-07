import BaseProvider from './BaseProvider.js';
import { KEYWORD_SHORTCUTS } from '../AutocompleteInput.js';

/**
 * KeywordProvider — matches registered site-search keyword shortcuts.
 *
 * Format: "<keyword> <query>"  e.g. "yt lo-fi beats"
 * Returns a single high-priority suggestion (score 950) when a keyword is matched.
 */
export default class KeywordProvider extends BaseProvider {
  async getSuggestions(inputText) {
    const trimmed = (inputText || '').trim();
    if (!trimmed.includes(' ')) return [];

    const spaceIdx = trimmed.indexOf(' ');
    const keyword = trimmed.slice(0, spaceIdx).toLowerCase();
    const query = trimmed.slice(spaceIdx + 1).trim();

    if (!query || !KEYWORD_SHORTCUTS[keyword]) return [];

    const base = KEYWORD_SHORTCUTS[keyword];
    const navigateUrl = base + encodeURIComponent(query);

    const LABELS = {
      yt:  'YouTube',
      gh:  'GitHub',
      mdn: 'MDN',
      so:  'Stack Overflow',
      npm: 'npm',
    };

    return [
      {
        text: `${LABELS[keyword] || keyword}: ${query}`,
        url: navigateUrl,
        type: 'keyword',
        score: 950,
        description: `Search ${LABELS[keyword] || keyword} for "${query}"`,
        favicon: null,
      },
    ];
  }
}
