import HistoryProvider from './providers/HistoryProvider.js';
import SearchSuggestionsProvider from './providers/SearchSuggestionsProvider.js';
import BookmarkProvider from './providers/BookmarkProvider.js';
import KeywordProvider from './providers/KeywordProvider.js';
import { OMNIBOX_SUGGESTION } from '../../constants/conditionStrings.js';

const MAX_SUGGESTIONS = 8;

/**
 * AutocompleteController — orchestrates all suggestion providers.
 *
 * Usage:
 *   const ctrl = new AutocompleteController();
 *   ctrl.query('github', (suggestions, ghost) => { ... });
 *
 * The callback is invoked once per provider as results arrive (progressive
 * rendering). History arrives synchronously-fast; search suggestions come later.
 *
 * List locking:
 *   Call lockList() the moment the user presses ArrowUp/Down so that
 *   late-arriving async results don't reorder the visible list mid-navigation.
 *   Call unlockList() when the user types again.
 */
export default class AutocompleteController {
  constructor() {
    this._history = new HistoryProvider();
    this._search = new SearchSuggestionsProvider();
    this._bookmarks = new BookmarkProvider();
    this._keywords = new KeywordProvider();

    /** @type {Array} */
    this._lockedResults = null;
    /** @type {number} — increments on each new query to discard stale callbacks */
    this._queryId = 0;
  }

  /** Prevent async updates from reordering the list while user navigates. */
  lockList() {
    // Snapshot the current locked state — set by mergeResults calls below
    this._locked = true;
  }

  /** Re-enable live updates (call when user resumes typing). */
  unlockList() {
    this._locked = false;
    this._lockedResults = null;
  }

  /**
   * Fan out to all providers, merge progressively, invoke callback on each update.
   *
   * @param {string} inputText
   * @param {function(suggestions: Array, ghostSuffix: string|null): void} callback
   */
  query(inputText, callback) {
    const queryId = ++this._queryId;
    this.unlockList();

    const accumulated = [];

    const publish = (newResults) => {
      if (queryId !== this._queryId) return; // superseded
      if (this._locked) return;             // user is navigating, don't reorder

      newResults.forEach(r => accumulated.push(r));
      const merged = this._mergeResults(accumulated);
      const ghost = this._getInlineAutocomplete(inputText, merged[0] ?? null);
      callback(merged, ghost);
    };

    // Fire all providers; history is near-sync so UI responds immediately
    Promise.all([
      this._history.getSuggestions(inputText).then(publish),
      this._keywords.getSuggestions(inputText).then(publish),
      this._bookmarks.getSuggestions(inputText).then(publish),
      this._search.getSuggestions(inputText).then(publish),
    ]).catch(() => {
      // Individual provider errors are caught inside each provider — this is
      // a safety net for unexpected Promise rejections.
    });
  }

  /**
   * Deduplicate by URL (keep highest score), sort descending, cap at MAX_SUGGESTIONS.
   * @param {Array} allResults
   * @returns {Array}
   */
  _mergeResults(allResults) {
    const byUrl = new Map();

    for (const suggestion of allResults) {
      const existing = byUrl.get(suggestion.url);
      if (!existing || suggestion.score > existing.score) {
        byUrl.set(suggestion.url, suggestion);
      }
    }

    return Array.from(byUrl.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SUGGESTIONS);
  }

  /**
   * Returns the suffix string to append as ghost text if the top suggestion
   * extends the current input, or null if no ghost is applicable.
   *
   * Ghost text is only shown for URL-like completions (history/bookmark/url),
   * not for plain search suggestions whose text diverges from what was typed.
   *
   * @param {string} input
   * @param {object|null} topSuggestion
   * @returns {string|null}
   */
  _getInlineAutocomplete(input, topSuggestion) {
    if (!topSuggestion || !input) return null;
    if (!OMNIBOX_SUGGESTION.DEFAULT_TYPES.includes(topSuggestion.type)) return null;

    const candidate = topSuggestion.url;
    const lower = input.toLowerCase();

    if (candidate.toLowerCase().startsWith(lower) && candidate.length > input.length) {
      return candidate.slice(input.length);
    }
    return null;
  }

  /** Free resources held by async providers. Call on component unmount. */
  dispose() {
    this._queryId = -1;
    this._search.dispose();
  }
}
