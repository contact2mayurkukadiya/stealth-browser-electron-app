/**
 * Single registry of string literals used in conditional checks (===, !==, switch,
 * startsWith, includes, array membership). ES module so Vite/Rollup can
 * statically detect all named exports used by renderer code.
 *
 * @see src/utils/omniboxDisplayUrl.js — omnibox unfocused URL formatting
 */
function freeze(obj) {
  return Object.freeze(obj);
}

/** URL schemes, internal pages, path fragments */
export const URL = freeze({
  SCHEME_HTTPS: 'https://',
  SCHEME_HTTP: 'http://',
  SCHEME_APP: 'app://',
  SCHEME_VIEW_SOURCE: 'view-source:',
  SCHEME_DATA: 'data:',
  ABOUT_BLANK: 'about:blank',
  PROTOCOL_INVISURF: 'invisurf:',
  SCHEME_INVISURF: 'invisurf://',
  SCHEME_INVISURF_DISPLAY: 'Invisurf://',
  SCHEME_STEALTH: 'stealth://',
  NTP_DISPLAY: 'app://newtab',
  NTP_CANONICAL_HTML: 'app://localhost/dist/newtab.html',
  NTP_LOCALHOST_PREFIX: 'app://localhost/dist/newtab',
  HISTORY_DISPLAY: 'invisurf://history',
  BOOKMARK_DISPLAY: 'invisurf://bookmark',
  SETTINGS_DISPLAY: 'invisurf://settings',
  HISTORY_NAVIGATE: 'invisurf://History',
  BOOKMARK_NAVIGATE: 'invisurf://Bookmark',
  SETTINGS_NAVIGATE: 'invisurf://Settings',
  STEALTH_HISTORY: 'stealth://history',
  STEALTH_BOOKMARK: 'stealth://bookmark',
  STEALTH_SETTINGS: 'stealth://settings',
  HISTORY_LOAD: 'app://localhost/dist/history.html',
  BOOKMARK_LOAD: 'app://localhost/dist/bookmark.html',
  SETTINGS_LOAD: 'app://localhost/dist/settings.html',
  NEW_TAB_LABEL: 'New Tab',
  PATH_NEWTAB_HTML: '/dist/newtab.html',
  PATH_HISTORY_HTML: '/dist/history.html',
  PATH_BOOKMARK_HTML: '/dist/bookmark.html',
  PATH_SETTINGS_HTML: '/dist/settings.html',
  FRAGMENT_HISTORY: 'history',
  FRAGMENT_BOOKMARK: 'bookmark',
  FRAGMENT_SETTINGS: 'settings',
  FRAGMENT_NEWTAB: 'newtab',
  GOOGLE_ORIGIN_PREFIX: 'https://www.google.com/',
  SEARCH_PATH: '/search',
  LOCALHOST_HOST: 'localhost',
});

/** Node/Electron process.platform */
export const PLATFORM = freeze({
  DARWIN: 'darwin',
  WIN32: 'win32',
});

/** KeyboardEvent.key values used in handlers */
export const KEYBOARD = freeze({
  ENTER: 'Enter',
  ESCAPE: 'Escape',
  TAB: 'Tab',
  BACKSPACE: 'Backspace',
  ARROW_DOWN: 'ArrowDown',
  ARROW_UP: 'ArrowUp',
  SPACE: ' ',
});

/** Bookmark tree and context-menu protocol */
export const BOOKMARK = freeze({
  TYPE_FOLDER: 'folder',
  TYPE_BOOKMARK: 'bookmark',
  TYPE_SEPARATOR: 'separator',
  ROOT_ID: 'root',
  MENU_OPEN: 'openBookmark',
  MENU_REMOVE: 'removeBookmark',
});

/** Chrome overlay host ↔ shell message types */
export const OVERLAY = freeze({
  DISMISS: 'dismiss',
  OMNIBOX_SUGGEST_PICK: 'omniboxSuggestPick',
  OMNIBOX_INPUT_CHANGE: 'omniboxInputChange',
  OMNIBOX_INPUT_COMMIT: 'omniboxInputCommit',
  OMNIBOX_KEY_DOWN: 'omniboxKeyDown',
  BOOKMARK_MENU: 'bookmarkMenu',
  BOOKMARK_FOLDER_PICK: 'bookmarkFolderPick',
  BOOKMARK_EDITOR_REMOVE: 'bookmarkEditorRemove',
  BOOKMARK_EDITOR_DONE: 'bookmarkEditorDone',
  SELECT_PROFILE: 'selectProfile',
  EDIT_PROFILE: 'editProfile',
  ADD_PROFILE: 'addProfile',
  APP_MENU_COMMAND: 'appMenuCommand',
});

/** app:run-menu-command and palette command ids */
export const MENU_COMMAND = freeze({
  OPEN_SETTINGS: 'open-settings',
  NAVIGATE_HOME: 'navigate-home',
  HISTORY_BACK: 'history-back',
  HISTORY_FORWARD: 'history-forward',
  VIEW_SOURCE: 'view-source',
  DEVTOOLS_ELEMENTS: 'devtools-elements',
  DEVTOOLS_CONSOLE: 'devtools-console',
  TOGGLE_FULLSCREEN: 'toggle-fullscreen',
  QUIT: 'quit',
  NEW_WINDOW_CURRENT_PROFILE: 'new-window-current-profile',
  EDIT_UNDO: 'edit-undo',
  EDIT_REDO: 'edit-redo',
  EDIT_CUT: 'edit-cut',
  EDIT_COPY: 'edit-copy',
  EDIT_PASTE: 'edit-paste',
  EDIT_SELECT_ALL: 'edit-select-all',
  OPEN_DOWNLOADS: 'open-downloads',
  PRINT_ACTIVE_TAB: 'print-active-tab',
  FIND_IN_PAGE: 'find-in-page',
  SEARCH_WITH_GOOGLE_LENS: 'search-with-google-lens',
});

/** Navigation source strings (renderer → main) */
export const NAV_SOURCE = freeze({
  TYPED: 'typed',
  SEARCH: 'search',
  KEYWORD: 'keyword',
  BOOKMARK: 'bookmark',
  RELOAD: 'reload',
  HISTORY: 'history',
  TOP_SITE: 'top-site',
  TOPSITE: 'topsite',
  LINK: 'link',
});

/** History DB transition column values */
export const HISTORY_TRANSITION = freeze({
  TYPED: 'TYPED',
  RELOAD: 'RELOAD',
  BOOKMARK: 'BOOKMARK',
  LINK: 'LINK',
});

/** Omnibox input classification kinds */
export const INPUT_KIND = freeze({
  KEYWORD: 'keyword',
  URL: 'url',
  SEARCH: 'search',
});

/** Omnibox autocomplete suggestion kinds */
export const OMNIBOX_SUGGESTION = freeze({
  HISTORY: 'history',
  SEARCH: 'search',
  BOOKMARK: 'bookmark',
  KEYWORD: 'keyword',
  URL: 'url',
  DEFAULT_TYPES: Object.freeze(['history', 'bookmark', 'url', 'keyword']),
});

/** Settings enums (align with chromeTheme normalizers) */
export const SETTINGS = freeze({
  COLOR_AUTOMATIC: 'automatic',
  COLOR_DARK: 'dark',
  COLOR_LIGHT: 'light',
  ACCENT_CUSTOM: 'custom',
  ACCENT_DEFAULT: 'default',
  STARTUP_CONTINUE: 'continue',
  STARTUP_FRESH: 'fresh',
  STARTUP_CLEAR_HISTORY: 'clearHistory',
  SEARCH_ENGINE_GOOGLE: 'google',
});

/** DOM appearance override */
export const APPEARANCE = freeze({
  FORCED_DARK: 'dark',
  FORCED_LIGHT: 'light',
});

/** Profile editor */
export const PROFILE = freeze({
  MODE_CREATE: 'create',
  MODE_EDIT: 'edit',
  AVATAR_PRESET: 'preset',
  AVATAR_UPLOAD: 'upload',
});

/** Native tab strip context menu item ids */
export const TAB_STRIP_MENU = freeze({
  NEW_TAB_RIGHT: 'newTabRight',
  MOVE_NEW_WINDOW: 'moveNewWindow',
  RELOAD: 'reload',
  DUPLICATE: 'duplicate',
  TOGGLE_PIN: 'togglePin',
  TOGGLE_MUTE_SITE: 'toggleMuteSite',
  CLOSE: 'close',
  CLOSE_OTHERS: 'closeOthers',
  CLOSE_RIGHT: 'closeRight',
});

/** Context menu row types */
export const CONTEXT_MENU = freeze({
  TYPE_ITEM: 'item',
  TYPE_SEPARATOR: 'separator',
  TYPE_TAB: 'tab',
});

/** History UI sidebar view ids */
export const HISTORY_VIEW = freeze({
  CHROME_HISTORY: 'chrome-history',
});

/** New tab tile kinds */
export const NTP_TILE = freeze({
  SITE: 'site',
});

/** WebRequest resource types */
export const RESOURCE_TYPE = freeze({
  MAIN_FRAME: 'mainFrame',
});

/** Permission names */
export const PERMISSION = freeze({
  FULLSCREEN: 'fullscreen',
});

/** DevTools panel names */
export const DEVTOOLS_PANEL = freeze({
  ELEMENTS: 'elements',
  CONSOLE: 'console',
});

/** Compat diagnostics event types */
export const COMPAT_EVENT = freeze({
  NAVIGATED: 'navigated',
  LOAD_FAILED: 'load-failed',
});

/** Encryption storage kinds */
export const ENCRYPTION_STORAGE = freeze({
  SAFE_STORAGE: 'safeStorage',
  FALLBACK: 'fallback',
});

/** File extensions (protocol handler / avatars) */
export const FILE_EXT = freeze({
  HTML: '.html',
  JS: '.js',
  CSS: '.css',
  JSON: '.json',
  SVG: '.svg',
  PNG: '.png',
  JPEG: 'jpeg',
});

/** MIME types */
export const MIME = freeze({
  HTML: 'text/html',
  JAVASCRIPT: 'text/javascript',
  CSS: 'text/css',
  JSON: 'application/json',
  SVG: 'image/svg+xml',
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  IMAGE_PREFIX: 'data:image/',
});

/** IPC invoke channels (preload ↔ main) */
export const IPC_INVOKE = freeze({
  RUN_MENU_COMMAND: 'app:run-menu-command',
  GOOGLE_LENS_ACTIVE_FOR_PROFILE: 'google-lens:active-for-profile',
  IS_STEALTH_WINDOW: 'context:is-stealth-window',
  IS_GHOST_WINDOW: 'context:is-ghost-window',
  WINDOW_CREATE: 'window:create',
  WINDOW_CREATE_STEALTH: 'window:create-stealth',
  WINDOW_CREATE_GHOST: 'window:create-ghost',
  WINDOW_CLOSE_IF_STEALTH: 'window:close-if-stealth',
  WINDOW_CLOSE_CURRENT: 'window:close-current',
  GHOST_CLOSE: 'ghost:close',
  WINDOW_GET_BOOTSTRAP: 'window:get-bootstrap',
  PROFILE_LIST: 'profile:list',
  PROFILE_GET_CURRENT: 'profile:get-current',
  PROFILE_CREATE: 'profile:create',
  PROFILE_UPDATE: 'profile:update',
  PROFILE_SET_AVATAR_DATA: 'profile:setAvatarData',
  PROFILE_SET_AVATAR_PRESET: 'profile:setAvatarFromPresetPng',
  PROFILE_VALIDATE_AVATAR: 'profile:validateAvatarData',
  PROFILE_LIST_PRESETS: 'profile:list-preset-avatar-pngs',
  PROFILE_CLEAR_AVATAR: 'profile:clearAvatar',
  PROFILE_GET_AVATAR: 'profile:getAvatarDataUrl',
  PROFILE_DELETE: 'profile:delete',
  PROFILE_OPEN_WINDOW: 'profile:open-window',
  PROFILE_PICKER_OPEN: 'profile:picker-open',
  PROFILE_CLOSE_CURRENT: 'profile:close-current',
  RECENTLY_CLOSED_LIST: 'recently-closed:list',
  RECENTLY_CLOSED_RESTORE: 'recently-closed:restore',
  CHROME_OVERLAY_RESET: 'chrome-overlay:v1:reset',
  CHROME_OVERLAY_ACQUIRE: 'chrome-overlay:v1:acquire',
  CHROME_OVERLAY_RELEASE: 'chrome-overlay:v1:release',
  CHROME_OVERLAY_POST: 'chrome-overlay:v1:post',
  CHROME_SHELL_MENU_OVERLAY_RESET: 'chrome-shell-menu-overlay:v1:reset',
  CHROME_SHELL_MENU_OVERLAY_ACQUIRE: 'chrome-shell-menu-overlay:v1:acquire',
  CHROME_SHELL_MENU_OVERLAY_RELEASE: 'chrome-shell-menu-overlay:v1:release',
  CHROME_SHELL_MENU_OVERLAY_POST: 'chrome-shell-menu-overlay:v1:post',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  SETTINGS_UPDATE: "settings:update",
  COOKIE_SUMMARY: 'cookies:summary',
  COOKIE_DELETE_DOMAIN: 'cookies:delete-domain',
  COOKIE_CLEAR_ALL: 'cookies:clear-all',
  COOKIE_SETTINGS_GET: 'cookies:settings-get',
  COOKIE_SETTINGS_UPDATE: 'cookies:settings-update',
  CLIPBOARD_WRITE: 'clipboard:write-text',
  APP_RELAUNCH: 'app:relaunch',
  APP_LOG_INFO: 'app:log-info',
  APP_LOG_FILES: 'app:log-files',
  APP_LOG_READ: 'app:log-read',
  APP_LOG_REVEAL: 'app:log-reveal',
  APP_LOG_DELETE: 'app:log-delete',
  APP_LOG_CLEAR: 'app:log-clear',
  COMPAT_GET_REPORT: 'compatDiag:getReport',
  COMPAT_CLEAR: 'compatDiag:clear',
  IDENTITY_DIAG_GET_REPORT: 'identityDiag:getReport',
  SESSION_LOAD: 'session:load',
  SESSION_SAVE: 'session:save',
  HISTORY_SEARCH: 'history:search',
  HISTORY_SUGGESTIONS: 'history:get-suggestions',
  HISTORY_DELETE_VISITS: 'history:delete-visits',
  HISTORY_DELETE_URLS: 'history:delete-urls',
  HISTORY_CLEAR: 'history:clear',
  NTP_TOP_SITES: 'newtab:get-top-sites',
  BOOKMARKS_GET: 'bookmarks:get',
  BOOKMARKS_GET_FOLDER: 'bookmarks:getFolder',
  BOOKMARKS_SEARCH: 'bookmarks:search',
  BOOKMARKS_DELETE: 'bookmarks:delete',
  BOOKMARKS_UPDATE: 'bookmarks:update',
  BOOKMARKS_SAVE: 'bookmarks:save',
  BOOKMARKS_ADD: 'bookmarks:add',
  BOOKMARKS_REMOVE: 'bookmarks:remove',
  BOOKMARKS_REORDER: 'bookmarks:reorder',
  BOOKMARKS_ADD_FOLDER: 'bookmarks:addFolder',
  BOOKMARKS_ADD_TO_FOLDER: 'bookmarks:addToFolder',
  TAB_HIDE_ACTIVE: 'tab:hide-active',
  TAB_RESTORE_ACTIVE: 'tab:restore-active',
  TAB_CAPTURE_SNAPSHOT: 'tab:capture-active-snapshot',
  TAB_PREPARE_SHELL_OVERLAY: 'tab:prepare-shell-overlay',
  TAB_MOVE_NEW_WINDOW: 'tab:move-to-new-window',
  TAB_STRIP_CONTEXT_MENU: 'tab:strip-context-menu',
  TAB_GET_INFO: 'tab:get-info',
  DEVTOOLS_UNDOCKED: 'devtools:open-undocked',
});

/** IPC send channels */
export const IPC_SEND = freeze({
  NEW_TAB: 'new-tab',
  SWITCH_TAB: 'switch-tab',
  CLOSE_TAB: 'close-tab',
  NAVIGATE: 'navigate',
  GO_BACK: 'go-back',
  GO_FORWARD: 'go-forward',
  RELOAD: 'reload',
  TAB_SLEEP_REGISTER: 'tab:sleep-register',
  TAB_MENU_SYNC: 'tab-menu:sync-labels',
  TAB_SET_AUDIO_MUTED: 'tab:set-audio-muted',
  OMNIBOX_STEAL_FOCUS: 'omnibox:steal-focus',
  TOOLTIP_SHOW: 'tooltip:show',
  TOOLTIP_HIDE: 'tooltip:hide',
  CHROME_OVERLAY_FROM_OVERLAY: 'chrome-overlay:v1:from-overlay',
  APP_LOG: 'app:log',
  GHOST_DRAG: 'ghost:drag',
});

/** IPC event channels (main → renderer) */
export const IPC_EVENT = freeze({
  URL_CHANGED: 'url-changed',
  TAB_UPDATE: 'tab-update',
  TAB_CREATED: 'tab-created',
  TAB_SWITCHED: 'tab-switched',
  OMNIBOX_FOCUS: 'omnibox:focus',
  SHORTCUT_NEW_TAB: 'shortcut-new-tab',
  SHORTCUT_HISTORY: 'shortcut-history',
  SHORTCUT_SETTINGS: 'shortcut-settings',
  SHORTCUT_CLOSE_TAB: 'shortcut-close-tab',
  SHORTCUT_RELOAD: 'shortcut-reload',
  SHORTCUT_SWITCH_TAB: 'shortcut-switch-tab',
  SHORTCUT_TAB_NEW_RIGHT: 'shortcut-tab-new-to-right',
  SHORTCUT_TAB_DUPLICATE: 'shortcut-tab-duplicate',
  SHORTCUT_TAB_MUTE: 'shortcut-tab-mute-site',
  SHORTCUT_TAB_PIN: 'shortcut-tab-pin',
  SHORTCUT_TAB_CLOSE_OTHERS: 'shortcut-tab-close-others',
  SHORTCUT_TAB_CLOSE_RIGHT: 'shortcut-tab-close-right',
  SHORTCUT_TAB_MOVE_WINDOW: 'shortcut-tab-move-new-window',
  SHORTCUT_TAB_SEARCH: 'shortcut-tab-search',
  SHORTCUT_COMMAND_PALETTE: 'shortcut-command-palette',
  TAB_STRIP_MENU_ACTION: 'tab-strip-context-menu:action',
  CHROME_OVERLAY_HOST: 'chrome-overlay:v1:host-event',
  CHROME_OVERLAY_SUPERSEDED: 'chrome-overlay:v1:superseded',
  CHROME_SHELL_MENU_OVERLAY_SUPERSEDED: 'chrome-shell-menu-overlay:v1:superseded',
  CHROME_OVERLAY_PATCH: 'chrome-overlay:v1:patch',
  OMNIBOX_OVERLAY_DELIVERED: 'omnibox-overlay:delivered',
  THEME_APPLY: 'theme:apply',
  TAB_AWOKEN: 'tab:awoken',
  TOOLTIP_UPDATE: 'tooltip:update',
});

/** Custom DOM events (renderer-only) */
export const DOM_EVENT = freeze({
  OMNIBOX_REQUEST_FOCUS: 'omnibox:request-focus',
});
