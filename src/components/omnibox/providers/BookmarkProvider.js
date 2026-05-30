import BaseProvider from './BaseProvider.js';

/**
 * BookmarkProvider — stub implementation.
 *
 * To wire in real bookmarks:
 *   1. Call `window.electronAPI.bookmarksGet()` (or equivalent IPC channel)
 *      to retrieve the flat/tree bookmark list.
 *   2. Filter by URL/title match against inputText.
 *   3. Return suggestions with type: 'bookmark', score: 700–800.
 */
export default class BookmarkProvider extends BaseProvider {
  async getSuggestions(_inputText) {
    // TODO: implement once a bookmarks IPC channel is available
    return [];
  }
}
