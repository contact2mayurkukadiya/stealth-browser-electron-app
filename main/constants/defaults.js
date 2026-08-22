// src/main/constants/defaults.js
const path = require('path');
const { app } = require('electron');
const C = require('../../src/constants/conditionStrings.cjs');

const UI_HEIGHT = 122; // Height of our tabs + nav bar + bookmark bar
const MAX_RECENTLY_CLOSED_TABS = 25;

// Google Lens layout limits
const LENS_SIDEBAR_MIN_WIDTH = 260;
const LENS_SIDEBAR_DEFAULT_RATIO = 0.42;
const LENS_SIDEBAR_MAX_RATIO = 0.7;
const LENS_PANEL_GAP = 14;
const LENS_WORKSPACE_PADDING = 8;
const LENS_SITE_CONTAINER_MAX_SCALE = 1;
const LENS_PAGE_MIN_SCALE = 0.05;
const LENS_PANEL_RADIUS = 24;
const LENS_MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// Profile defaults
const MAX_PROFILE_AVATAR_BYTES = 512 * 1024;
const PRESET_AVATAR_PNG_DIR = path.join(app.getAppPath(), 'renderer', 'assets', 'images', 'profiles');

// Navigation guards
const MAX_MAINFRAME_REDIRECTS = 12;
const REDIRECT_WINDOW_MS = 10000;
const TRACKING_REDIRECT_HOST_MARKERS = [
    'doubleclick.net',
    'googlesyndication.com',
    'adservice.google.com',
    'taboola.com',
    'outbrain.com',
    'criteo.com',
    'pubmatic.com',
    'openx.net',
    'smartadserver.com',
    'smilewanted.com',
    'adsrvr.org',
];

const CANONICAL_NTP_HTML = C.URL.NTP_CANONICAL_HTML;

// Overlay limitations
const CHROME_OVERLAY_POST_MAX_BYTES = 256 * 1024;
const SHELL_MENU_OVERLAY_KINDS = new Set([
    'appMenu',
    'profileMenu',
    'bookmarkContextMenu',
    'bookmarkFolderMenu',
    'bookmarkEditor',
    'siteInfo',
    'cookieControls',
    'downloadPanel',
]);

const COOKIE_CONFIG_DEFAULTS = {
    globalPolicy: 'allow',
    exceptions: [],
};

const SETTINGS_DEFAULTS = {
    contentProtection: true,
    nonActivatingInteraction: false,
    startupBehavior: 'continue', // 'fresh' | 'continue' | 'clearHistory'
    compatibilityDiagnosticsEnabled: false,
    searchEngine: 'google', // 'google' | 'bing' | 'brave' | 'duckDuckGo'
    colorTheme: 'automatic', // 'automatic' | 'dark' | 'light'
    accentTheme: 'default',
    accentCustomHex: null,
    cookieConfig: COOKIE_CONFIG_DEFAULTS,
    cookieConfigByProfile: {},
};

const SEARCH_ENGINES = {
    google: 'https://www.google.com/search?q=',
    bing: 'https://www.bing.com/search?q=',
    brave: 'https://search.brave.com/search?q=',
    duckDuckGo: 'https://duckduckgo.com/?q=',
};

const TAB_STRIP_CONTEXT_MENU_MAX_ITEMS = 30;
const TAB_STRIP_CONTEXT_MENU_ACTION_IDS = new Set([
    'newTabRight',
    'moveNewWindow',
    C.IPC_SEND.RELOAD,
    'duplicate',
    'togglePin',
    'toggleMuteSite',
    'close',
    'closeOthers',
    'closeRight',
]);

module.exports = {
    UI_HEIGHT,
    MAX_RECENTLY_CLOSED_TABS,
    LENS_SIDEBAR_MIN_WIDTH,
    LENS_SIDEBAR_DEFAULT_RATIO,
    LENS_SIDEBAR_MAX_RATIO,
    LENS_PANEL_GAP,
    LENS_WORKSPACE_PADDING,
    LENS_SITE_CONTAINER_MAX_SCALE,
    LENS_PAGE_MIN_SCALE,
    LENS_PANEL_RADIUS,
    LENS_MOBILE_USER_AGENT,
    MAX_PROFILE_AVATAR_BYTES,
    PRESET_AVATAR_PNG_DIR,
    MAX_MAINFRAME_REDIRECTS,
    REDIRECT_WINDOW_MS,
    TRACKING_REDIRECT_HOST_MARKERS,
    CANONICAL_NTP_HTML,
    CHROME_OVERLAY_POST_MAX_BYTES,
    SHELL_MENU_OVERLAY_KINDS,
    COOKIE_CONFIG_DEFAULTS,
    SETTINGS_DEFAULTS,
    SEARCH_ENGINES,
    TAB_STRIP_CONTEXT_MENU_MAX_ITEMS,
    TAB_STRIP_CONTEXT_MENU_ACTION_IDS
};