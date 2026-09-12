const { contextBridge, ipcRenderer, clipboard } = require('electron');

const appMajor = process.versions.chrome.split('.')[0] || '146';
const osPlatform = process.platform === 'darwin' ? 'macOS' : 'Windows';

const mappedStandardBrands = [
    { brand: 'Not_A Brand', version: '99' },
    { brand: 'Chromium', version: appMajor },
    { brand: 'Google Chrome', version: appMajor }
];

const compliantUserAgentData = {
    brands: mappedStandardBrands,
    mobile: false,
    platform: osPlatform,
    getHighEntropyValues: async (queryHints) => {
        const metadataPayload = {
            brands: mappedStandardBrands,
            mobile: false,
            platform: osPlatform
        };
        if (queryHints.includes('platformVersion')) {
            metadataPayload.platformVersion = process.platform === 'darwin' ? '14.0.0' : '10.0.0';
        }
        if (queryHints.includes('architecture')) {
            metadataPayload.architecture = 'x86';
        }
        if (queryHints.includes('bitness')) {
            metadataPayload.bitness = '64';
        }
        return metadataPayload;
    }
};

try {
    // Inject the spoofed userAgentData and other browser signals into the main world so scripts can see it.
    const { webFrame } = require('electron');
    if (webFrame && typeof webFrame.executeJavaScript === 'function') {
        webFrame.executeJavaScript(`
            try {
                // 1. Spoof navigator.userAgentData
                Object.defineProperty(navigator, 'userAgentData', {
                    get: () => (${JSON.stringify(compliantUserAgentData)}),
                    configurable: true,
                    enumerable: true
                });

                // 2. Spoof window.chrome (essential for Google login)
                if (!window.chrome) {
                    window.chrome = {};
                }
                window.chrome.app = window.chrome.app || {
                    isInstalled: false,
                    InstallState: {
                        DISABLED: 'disabled',
                        INSTALLED: 'installed',
                        NOT_INSTALLED: 'not_installed'
                    },
                    RunningState: {
                        CANNOT_RUN: 'cannot_run',
                        READY_TO_RUN: 'ready_to_run',
                        RUNNING: 'running'
                    }
                };
                window.chrome.runtime = window.chrome.runtime || {
                    OnInstalledReason: {
                        CHROME_UPDATE: 'chrome_update',
                        INSTALL: 'install',
                        SHARED_MODULE_UPDATE: 'shared_module_update',
                        UPDATE: 'update'
                    },
                    OnRestartRequiredReason: {
                        APP_UPDATE: 'app_update',
                        OS_UPDATE: 'os_update',
                        PERIODIC: 'periodic'
                    },
                    PlatformArch: {
                        ARM: 'arm',
                        ARM64: 'arm64',
                        MIPS: 'mips',
                        MIPS64: 'mips64',
                        X86_32: 'x86-32',
                        X86_64: 'x86-64'
                    },
                    PlatformNaclArch: {
                        ARM: 'arm',
                        MIPS: 'mips',
                        MIPS64: 'mips64',
                        X86_32: 'x86-32',
                        X86_64: 'x86-64'
                    },
                    PlatformOs: {
                        ANDROID: 'android',
                        CROS: 'cros',
                        LINUX: 'linux',
                        MAC: 'mac',
                        OPENBSD: 'openbsd',
                        WIN: 'win'
                    },
                    RequestUpdateCheckStatus: {
                        NO_UPDATE: 'no_update',
                        THROTTLED: 'throttled',
                        UPDATE_AVAILABLE: 'update_available'
                    }
                };
                // Mock loadTimes (deprecated but often checked by legacy scripts)
                window.chrome.loadTimes = window.chrome.loadTimes || function() {
                    return {
                        requestTime: performance.timing.navigationStart / 1000,
                        startLoadTime: performance.timing.navigationStart / 1000,
                        commitLoadTime: performance.timing.responseStart / 1000,
                        finishDocumentLoadTime: performance.timing.domContentLoadedEventEnd / 1000,
                        finishLoadTime: performance.timing.loadEventEnd / 1000,
                        firstPaintTime: (performance.timing.navigationStart + performance.now()) / 1000,
                        firstPaintAfterLoadTime: 0,
                        navigationType: "Other",
                        wasFetchedViaSpdy: true,
                        wasNpnNegotiated: true,
                        npnNegotiatedProtocol: "h2",
                        wasAlternateProtocolAvailable: false,
                        connectionInfo: "h2"
                    };
                };
                // Mock csi
                window.chrome.csi = window.chrome.csi || function() {
                    return {
                        startE: performance.timing.navigationStart,
                        onloadT: performance.timing.domContentLoadedEventEnd,
                        pageT: performance.timing.loadEventEnd - performance.timing.navigationStart,
                        tran: 15
                    };
                };

                // 3. Spoof Plugins and MimeTypes
                if (navigator.plugins.length === 0) {
                    const PluginArray = function() {};
                    PluginArray.prototype = Object.create(Array.prototype);
                    PluginArray.prototype.refresh = function() {};
                    PluginArray.prototype.item = function(i) { return this[i]; };
                    PluginArray.prototype.namedItem = function(name) {
                        for (let i = 0; i < this.length; i++) {
                            if (this[i].name === name) return this[i];
                        }
                        return null;
                    };

                    const plugins = new PluginArray();
                    const pdfPlugin = {
                        0: { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: null },
                        1: { type: "text/pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: null },
                        description: "Portable Document Format",
                        filename: "internal-pdf-viewer",
                        length: 2,
                        name: "Chrome PDF Plugin"
                    };
                    pdfPlugin[0].enabledPlugin = pdfPlugin;
                    pdfPlugin[1].enabledPlugin = pdfPlugin;
                    
                    const pdfViewer = {
                        0: { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: null },
                        1: { type: "text/pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: null },
                        description: "Portable Document Format",
                        filename: "internal-pdf-viewer",
                        length: 2,
                        name: "Chrome PDF Viewer"
                    };
                    pdfViewer[0].enabledPlugin = pdfViewer;
                    pdfViewer[1].enabledPlugin = pdfViewer;

                    const nativeClient = {
                        0: { type: "application/x-nacl", suffixes: "", description: "Native Client Executable", enabledPlugin: null },
                        1: { type: "application/x-pnacl", suffixes: "", description: "Portable Native Client Executable", enabledPlugin: null },
                        description: "",
                        filename: "internal-nacl-plugin",
                        length: 2,
                        name: "Native Client"
                    };
                    nativeClient[0].enabledPlugin = nativeClient;
                    nativeClient[1].enabledPlugin = nativeClient;

                    plugins.push(pdfPlugin, pdfViewer, nativeClient);
                    
                    Object.defineProperty(navigator, 'plugins', {
                        get: () => plugins,
                        configurable: true,
                        enumerable: true
                    });

                    const MimeTypeArray = function() {};
                    MimeTypeArray.prototype = Object.create(Array.prototype);
                    MimeTypeArray.prototype.item = function(i) { return this[i]; };
                    MimeTypeArray.prototype.namedItem = function(name) {
                        for (let i = 0; i < this.length; i++) {
                            if (this[i].type === name) return this[i];
                        }
                        return null;
                    };

                    const mimeTypes = new MimeTypeArray();
                    mimeTypes.push(pdfPlugin[0], pdfPlugin[1], nativeClient[0], nativeClient[1]);

                    Object.defineProperty(navigator, 'mimeTypes', {
                        get: () => mimeTypes,
                        configurable: true,
                        enumerable: true
                    });
                }

                // 4. Override WebAuthn (navigator.credentials)
                if (window.__invisurf_webauthn) {
                    const originalCreate = navigator.credentials.create.bind(navigator.credentials);
                    const originalGet = navigator.credentials.get.bind(navigator.credentials);

                    navigator.credentials.create = async function(options) {
                        if (options && options.publicKey) {
                            try {
                                const result = await window.__invisurf_webauthn.create(options.publicKey);
                                if (result && result.success) {
                                    // Convert base64url strings back to ArrayBuffers
                                    const base64urlToBuffer = (base64url) => {
                                        if (!base64url) return null;
                                        const padding = '='.repeat((4 - base64url.length % 4) % 4);
                                        const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
                                        const rawData = window.atob(base64);
                                        const outputArray = new Uint8Array(rawData.length);
                                        for (let i = 0; i < rawData.length; ++i) {
                                            outputArray[i] = rawData.charCodeAt(i);
                                        }
                                        return outputArray.buffer;
                                    };

                                    return {
                                        id: result.data.credentialId,
                                        rawId: base64urlToBuffer(result.data.credentialId),
                                        type: 'public-key',
                                        response: {
                                            clientDataJSON: base64urlToBuffer(result.data.clientDataJSON),
                                            attestationObject: base64urlToBuffer(result.data.attestationObject),
                                            getAuthenticatorData: () => base64urlToBuffer(result.data.authData),
                                            getPublicKey: () => base64urlToBuffer(result.data.publicKey),
                                            getPublicKeyAlgorithm: () => result.data.publicKeyAlgorithm,
                                            getTransports: () => result.data.transports
                                        },
                                        authenticatorAttachment: 'platform',
                                        getClientExtensionResults: () => ({})
                                    };
                                } else {
                                    throw new DOMException(result.error || 'NotAllowedError', result.error || 'NotAllowedError');
                                }
                            } catch (e) {
                                throw new DOMException(e.message, 'NotAllowedError');
                            }
                        }
                        return originalCreate(options);
                    };

                    navigator.credentials.get = async function(options) {
                        if (options && options.publicKey) {
                            try {
                                const result = await window.__invisurf_webauthn.get(options.publicKey);
                                if (result && result.success) {
                                    const base64urlToBuffer = (base64url) => {
                                        if (!base64url) return null;
                                        const padding = '='.repeat((4 - base64url.length % 4) % 4);
                                        const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
                                        const rawData = window.atob(base64);
                                        const outputArray = new Uint8Array(rawData.length);
                                        for (let i = 0; i < rawData.length; ++i) {
                                            outputArray[i] = rawData.charCodeAt(i);
                                        }
                                        return outputArray.buffer;
                                    };

                                    return {
                                        id: result.data.credentialId,
                                        rawId: base64urlToBuffer(result.data.credentialId),
                                        type: 'public-key',
                                        response: {
                                            clientDataJSON: base64urlToBuffer(result.data.clientDataJSON),
                                            authenticatorData: base64urlToBuffer(result.data.authenticatorData),
                                            signature: base64urlToBuffer(result.data.signature),
                                            userHandle: base64urlToBuffer(result.data.userHandle)
                                        },
                                        authenticatorAttachment: 'platform',
                                        getClientExtensionResults: () => ({})
                                    };
                                } else {
                                    throw new DOMException(result.error || 'NotAllowedError', result.error || 'NotAllowedError');
                                }
                            } catch (e) {
                                throw new DOMException(e.message, 'NotAllowedError');
                            }
                        }
                        return originalGet(options);
                    };
                }

            } catch (_) {}
        `);
    }

    // Also apply userAgentData to the isolated world just in case
    Object.defineProperty(navigator, 'userAgentData', {
        get: () => compliantUserAgentData,
        configurable: true,
        enumerable: true
    });
} catch (_) { }

// Keep preload self-contained: it runs with sandbox: true, where requiring
// arbitrary local project files can fail before electronAPI is exposed.
const C = Object.freeze({
    "IPC_INVOKE": {
        "RUN_MENU_COMMAND": "app:run-menu-command",
        "GOOGLE_LENS_ACTIVE_FOR_PROFILE": "google-lens:active-for-profile",
        "IS_STEALTH_WINDOW": "context:is-stealth-window",
        "IS_GHOST_WINDOW": "context:is-ghost-window",
        "WINDOW_CREATE": "window:create",
        "WINDOW_CREATE_STEALTH": "window:create-stealth",
        "WINDOW_CREATE_GHOST": "window:create-ghost",
        "WINDOW_CLOSE_IF_STEALTH": "window:close-if-stealth",
        "WINDOW_CLOSE_CURRENT": "window:close-current",
        "GHOST_CLOSE": "ghost:close",
        "WINDOW_GET_BOOTSTRAP": "window:get-bootstrap",
        "PROFILE_LIST": "profile:list",
        "PROFILE_GET_CURRENT": "profile:get-current",
        "PROFILE_CREATE": "profile:create",
        "PROFILE_UPDATE": "profile:update",
        "PROFILE_SET_AVATAR_DATA": "profile:setAvatarData",
        "PROFILE_SET_AVATAR_PRESET": "profile:setAvatarFromPresetPng",
        "PROFILE_VALIDATE_AVATAR": "profile:validateAvatarData",
        "PROFILE_LIST_PRESETS": "profile:list-preset-avatar-pngs",
        "PROFILE_CLEAR_AVATAR": "profile:clearAvatar",
        "PROFILE_GET_AVATAR": "profile:getAvatarDataUrl",
        "PROFILE_DELETE": "profile:delete",
        "PROFILE_OPEN_WINDOW": "profile:open-window",
        "PROFILE_PICKER_OPEN": "profile:picker-open",
        "PROFILE_CLOSE_CURRENT": "profile:close-current",
        "RECENTLY_CLOSED_LIST": "recently-closed:list",
        "RECENTLY_CLOSED_RESTORE": "recently-closed:restore",
        "CHROME_OVERLAY_RESET": "chrome-overlay:v1:reset",
        "CHROME_OVERLAY_ACQUIRE": "chrome-overlay:v1:acquire",
        "CHROME_OVERLAY_RELEASE": "chrome-overlay:v1:release",
        "CHROME_OVERLAY_POST": "chrome-overlay:v1:post",
        "CHROME_SHELL_MENU_OVERLAY_RESET": "chrome-shell-menu-overlay:v1:reset",
        "CHROME_SHELL_MENU_OVERLAY_ACQUIRE": "chrome-shell-menu-overlay:v1:acquire",
        "CHROME_SHELL_MENU_OVERLAY_RELEASE": "chrome-shell-menu-overlay:v1:release",
        "CHROME_SHELL_MENU_OVERLAY_POST": "chrome-shell-menu-overlay:v1:post",
        "SETTINGS_GET": "settings:get",
        "SETTINGS_SAVE": "settings:save",
        "SETTINGS_UPDATE": "settings:update",
        "COOKIE_SUMMARY": "cookies:summary",
        "COOKIE_DELETE_DOMAIN": "cookies:delete-domain",
        "COOKIE_CLEAR_ALL": "cookies:clear-all",
        "COOKIE_SETTINGS_GET": "cookies:settings-get",
        "COOKIE_SETTINGS_UPDATE": "cookies:settings-update",
        "CLIPBOARD_WRITE": "clipboard:write-text",
        "CLIPBOARD_READ": "clipboard:read-text",
        "APP_RELAUNCH": "app:relaunch",
        "APP_LOG_INFO": "app:log-info",
        "APP_LOG_FILES": "app:log-files",
        "APP_LOG_READ": "app:log-read",
        "APP_LOG_REVEAL": "app:log-reveal",
        "APP_LOG_DELETE": "app:log-delete",
        "APP_LOG_CLEAR": "app:log-clear",
        "COMPAT_GET_REPORT": "compatDiag:getReport",
        "COMPAT_CLEAR": "compatDiag:clear",
        "IDENTITY_DIAG_GET_REPORT": "identityDiag:getReport",
        "SESSION_LOAD": "session:load",
        "SESSION_SAVE": "session:save",
        "HISTORY_SEARCH": "history:search",
        "HISTORY_SUGGESTIONS": "history:get-suggestions",
        "HISTORY_DELETE_VISITS": "history:delete-visits",
        "HISTORY_DELETE_URLS": "history:delete-urls",
        "HISTORY_CLEAR": "history:clear",
        "NTP_TOP_SITES": "newtab:get-top-sites",
        "BOOKMARKS_GET": "bookmarks:get",
        "BOOKMARKS_GET_FOLDER": "bookmarks:getFolder",
        "BOOKMARKS_SEARCH": "bookmarks:search",
        "BOOKMARKS_DELETE": "bookmarks:delete",
        "BOOKMARKS_UPDATE": "bookmarks:update",
        "BOOKMARKS_SAVE": "bookmarks:save",
        "BOOKMARKS_ADD": "bookmarks:add",
        "BOOKMARKS_REMOVE": "bookmarks:remove",
        "BOOKMARKS_REORDER": "bookmarks:reorder",
        "BOOKMARKS_ADD_FOLDER": "bookmarks:addFolder",
        "BOOKMARKS_ADD_TO_FOLDER": "bookmarks:addToFolder",
        "TAB_HIDE_ACTIVE": "tab:hide-active",
        "TAB_RESTORE_ACTIVE": "tab:restore-active",
        "TAB_CAPTURE_SNAPSHOT": "tab:capture-active-snapshot",
        "TAB_PREPARE_SHELL_OVERLAY": "tab:prepare-shell-overlay",
        "TAB_MOVE_NEW_WINDOW": "tab:move-to-new-window",
        "TAB_STRIP_CONTEXT_MENU": "tab:strip-context-menu",
        "TAB_GET_INFO": "tab:get-info",
        "DEVTOOLS_UNDOCKED": "devtools:open-undocked",
        "PERMISSIONS_GET_ORIGIN_STATE": "permissions:get-origin-state",
        "PERMISSIONS_SET_ORIGIN_STATE": "permissions:set-origin-state",
        "PERMISSIONS_RESET_ORIGIN": "permissions:reset-origin",
        "PERMISSIONS_GET_ALL": "permissions:get-all",
        "PERMISSIONS_DELETE": "permissions:delete",
        "PERMISSIONS_CLEAR_ALL": "permissions:clear-all",
        "PERMISSIONS_PROMPT_RESPOND": "permissions:prompt-respond"
    },
    "IPC_SEND": {
        "NEW_TAB": "new-tab",
        "SWITCH_TAB": "switch-tab",
        "CLOSE_TAB": "close-tab",
        "NAVIGATE": "navigate",
        "GO_BACK": "go-back",
        "GO_FORWARD": "go-forward",
        "RELOAD": "reload",
        "TAB_SLEEP_REGISTER": "tab:sleep-register",
        "TAB_MENU_SYNC": "tab-menu:sync-labels",
        "TAB_SET_AUDIO_MUTED": "tab:set-audio-muted",
        "OMNIBOX_STEAL_FOCUS": "omnibox:steal-focus",
        "TOOLTIP_SHOW": "tooltip:show",
        "TOOLTIP_HIDE": "tooltip:hide",
        "CHROME_OVERLAY_FROM_OVERLAY": "chrome-overlay:v1:from-overlay",
        "APP_LOG": "app:log",
        "GHOST_DRAG": "ghost:drag"
    },
    "IPC_EVENT": {
        "URL_CHANGED": "url-changed",
        "TAB_UPDATE": "tab-update",
        "TAB_CREATED": "tab-created",
        "TAB_SWITCHED": "tab-switched",
        "OMNIBOX_FOCUS": "omnibox:focus",
        "SHORTCUT_NEW_TAB": "shortcut-new-tab",
        "SHORTCUT_HISTORY": "shortcut-history",
        "SHORTCUT_SETTINGS": "shortcut-settings",
        "SHORTCUT_CLOSE_TAB": "shortcut-close-tab",
        "SHORTCUT_RELOAD": "shortcut-reload",
        "SHORTCUT_SWITCH_TAB": "shortcut-switch-tab",
        "SHORTCUT_TAB_NEW_RIGHT": "shortcut-tab-new-to-right",
        "SHORTCUT_TAB_DUPLICATE": "shortcut-tab-duplicate",
        "SHORTCUT_TAB_MUTE": "shortcut-tab-mute-site",
        "SHORTCUT_TAB_PIN": "shortcut-tab-pin",
        "SHORTCUT_TAB_CLOSE_OTHERS": "shortcut-tab-close-others",
        "SHORTCUT_TAB_CLOSE_RIGHT": "shortcut-tab-close-right",
        "SHORTCUT_TAB_MOVE_WINDOW": "shortcut-tab-move-new-window",
        "SHORTCUT_TAB_SEARCH": "shortcut-tab-search",
        "SHORTCUT_COMMAND_PALETTE": "shortcut-command-palette",
        "TAB_STRIP_MENU_ACTION": "tab-strip-context-menu:action",
        "CHROME_OVERLAY_HOST": "chrome-overlay:v1:host-event",
        "CHROME_OVERLAY_SUPERSEDED": "chrome-overlay:v1:superseded",
        "CHROME_SHELL_MENU_OVERLAY_SUPERSEDED": "chrome-shell-menu-overlay:v1:superseded",
        "CHROME_OVERLAY_PATCH": "chrome-overlay:v1:patch",
        "OMNIBOX_OVERLAY_DELIVERED": "omnibox-overlay:delivered",
        "THEME_APPLY": "theme:apply",
        "TAB_AWOKEN": "tab:awoken",
        "TOOLTIP_UPDATE": "tooltip:update",
        "PERMISSION_PROMPT_REQUEST": "permission:prompt-request",
        "PERMISSION_PROMPT_DISMISSED": "permission:prompt-dismissed"
    }
});

function serializeRendererError(value) {
    if (!value) return null;
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
    }
    return { message: String(value) };
}

function sendRendererLog(level, event, data = {}) {
    try {
        ipcRenderer.send(C.IPC_SEND.APP_LOG, { level, event, data: { ...data, href: typeof window !== 'undefined' ? window.location.href : '' } });
    } catch (_) {
        // Logging must never break the renderer.
    }
}

window.addEventListener('error', (event) => {
    sendRendererLog('error', 'renderer:uncaught-error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: serializeRendererError(event.error),
    });
});

window.addEventListener('unhandledrejection', (event) => {
    sendRendererLog('error', 'renderer:unhandled-rejection', {
        reason: serializeRendererError(event.reason),
    });
});

contextBridge.exposeInMainWorld('__invisurf_webauthn', {
    create: (options) => ipcRenderer.invoke('webauthn:create', options),
    get: (options) => ipcRenderer.invoke('webauthn:get', options)
});

contextBridge.exposeInMainWorld('electronAPI', {
    // Tab management
    newTab: (id, isStealth = false, url = null, options = {}) => ipcRenderer.send(C.IPC_SEND.NEW_TAB, { id, isStealth, url, source: options && typeof options.source === 'string' ? options.source : undefined, history: options && options.history ? options.history : undefined }),
    switchTab: (id) => ipcRenderer.send(C.IPC_SEND.SWITCH_TAB, { id }),
    closeTab: (id, options = {}) => ipcRenderer.send(C.IPC_SEND.CLOSE_TAB, { id, closeWindowIfLast: options.closeWindowIfLast === true }),
    navigate: (id, url, options = {}) => ipcRenderer.send(C.IPC_SEND.NAVIGATE, { id, url, source: options && typeof options.source === 'string' ? options.source : undefined }),
    goBack: (id) => ipcRenderer.send(C.IPC_SEND.GO_BACK, { id }),
    goForward: (id) => ipcRenderer.send(C.IPC_SEND.GO_FORWARD, { id }),
    reload: (id) => ipcRenderer.send(C.IPC_SEND.RELOAD, { id }),
    appLog: (level, event, data = {}) => sendRendererLog(level, event, data),
    appLogInfo: () => ipcRenderer.invoke(C.IPC_INVOKE.APP_LOG_INFO),
    appLogFiles: () => ipcRenderer.invoke(C.IPC_INVOKE.APP_LOG_FILES),
    appLogRead: (filePath) => ipcRenderer.invoke(C.IPC_INVOKE.APP_LOG_READ, { filePath }),
    appLogReveal: (filePath) => ipcRenderer.invoke(C.IPC_INVOKE.APP_LOG_REVEAL, { filePath }),
    appLogDelete: (filePath) => ipcRenderer.invoke(C.IPC_INVOKE.APP_LOG_DELETE, { filePath }),
    appLogClear: (payload = {}) => ipcRenderer.invoke(C.IPC_INVOKE.APP_LOG_CLEAR, payload),
    onUrlChanged: (callback) => ipcRenderer.on(C.IPC_EVENT.URL_CHANGED, (event, data) => callback(data)),
    onTabUpdate: (callback) => ipcRenderer.on(C.IPC_EVENT.TAB_UPDATE, (event, data) => callback(data)),
    onTabCreated: (callback) => ipcRenderer.on(C.IPC_EVENT.TAB_CREATED, (event, data) => callback(data)),
    onTabSwitched: (callback) => ipcRenderer.on(C.IPC_EVENT.TAB_SWITCHED, (event, data) => callback(data)),
    onOmniboxFocus: (callback) => ipcRenderer.on(C.IPC_EVENT.OMNIBOX_FOCUS, (event, data) => callback(data)),
    onShortcutNewTab: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_NEW_TAB, () => callback()),
    onShortcutHistory: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_HISTORY, () => callback()),
    onShortcutSettings: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_SETTINGS, () => callback()),
    onShortcutCloseTab: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_CLOSE_TAB, () => callback()),
    onShortcutReload: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_RELOAD, () => callback()),
    onShortcutSwitchTab: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_SWITCH_TAB, (event, data) => callback(data)),
    onShortcutTabNewToRight: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_NEW_RIGHT, () => callback()),
    onShortcutTabDuplicate: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_DUPLICATE, () => callback()),
    onShortcutTabMuteSite: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_MUTE, () => callback()),
    onShortcutTabPin: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_PIN, () => callback()),
    onShortcutTabCloseOthers: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_CLOSE_OTHERS, () => callback()),
    onShortcutTabCloseRight: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_CLOSE_RIGHT, () => callback()),
    onShortcutTabMoveNewWindow: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_MOVE_WINDOW, () => callback()),
    onShortcutTabSearch: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_TAB_SEARCH, () => callback()),
    onShortcutCommandPalette: (callback) => ipcRenderer.on(C.IPC_EVENT.SHORTCUT_COMMAND_PALETTE, () => callback()),

    runMenuCommand: (commandId) => ipcRenderer.invoke(C.IPC_INVOKE.RUN_MENU_COMMAND, commandId),
    isGoogleLensActiveForProfile: () => ipcRenderer.invoke(C.IPC_INVOKE.GOOGLE_LENS_ACTIVE_FOR_PROFILE),
    createWindow: (payload = {}) => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_CREATE, typeof payload === 'string' ? { profileId: payload } : payload),
    createStealthWindow: (payload = {}) => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_CREATE_STEALTH, typeof payload === 'string' ? { profileId: payload } : payload),
    createGhostWindow: (payload = {}) => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_CREATE_GHOST, typeof payload === 'string' ? { profileId: payload } : payload),
    closeStealthWindow: () => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_CLOSE_IF_STEALTH),
    closeCurrentWindow: () => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_CLOSE_CURRENT),
    ghostClose: () => ipcRenderer.invoke(C.IPC_INVOKE.GHOST_CLOSE),
    ghostDrag: (deltaX, deltaY) => ipcRenderer.send(C.IPC_SEND.GHOST_DRAG, { deltaX, deltaY }),
    windowGetBootstrap: () => ipcRenderer.invoke(C.IPC_INVOKE.WINDOW_GET_BOOTSTRAP),
    isStealthWindow: () => ipcRenderer.invoke(C.IPC_INVOKE.IS_STEALTH_WINDOW),
    isGhostWindow: () => ipcRenderer.invoke(C.IPC_INVOKE.IS_GHOST_WINDOW),

    tabSetAudioMuted: (id, muted) => ipcRenderer.send(C.IPC_SEND.TAB_SET_AUDIO_MUTED, { id, muted }),
    tabMenuSyncLabels: (payload) => ipcRenderer.send(C.IPC_SEND.TAB_MENU_SYNC, payload),
    tabMoveToNewWindow: (id, fallbackTabId) => ipcRenderer.invoke(C.IPC_INVOKE.TAB_MOVE_NEW_WINDOW, { id, fallbackTabId }),

    // Bookmarks
    bookmarksGet: () => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_GET),
    bookmarkGetFolder: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_GET_FOLDER, payload),
    bookmarkSearch: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_SEARCH, payload),
    bookmarkDelete: (ids) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_DELETE, ids),
    bookmarkUpdate: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_UPDATE, payload),
    bookmarksSave: (data) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_SAVE, data),
    bookmarksAdd: (item) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_ADD, item),
    bookmarksRemove: (id) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_REMOVE, id),
    bookmarksReorder: (bar) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_REORDER, bar),
    bookmarksAddFolder: (name) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_ADD_FOLDER, name),
    bookmarksAddToFolder: (folderId, item) => ipcRenderer.invoke(C.IPC_INVOKE.BOOKMARKS_ADD_TO_FOLDER, folderId, item),
    onBookmarksUpdated: (callback) => {
        const handler = () => callback();
        ipcRenderer.on('bookmarks:updated', handler);
        return () => ipcRenderer.removeListener('bookmarks:updated', handler);
    },

    // History
    historySearch: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.HISTORY_SEARCH, payload),
    historyGetSuggestions: (query) => ipcRenderer.invoke(C.IPC_INVOKE.HISTORY_SUGGESTIONS, query),
    historyDeleteVisits: (visitIds) => ipcRenderer.invoke(C.IPC_INVOKE.HISTORY_DELETE_VISITS, visitIds),
    historyDeleteUrls: (urls) => ipcRenderer.invoke(C.IPC_INVOKE.HISTORY_DELETE_URLS, urls),
    historyClear: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.HISTORY_CLEAR, payload),

    // Profiles
    profileList: () => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_LIST),
    profileGetCurrent: () => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_GET_CURRENT),
    profileCreate: (displayName) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_CREATE, { displayName }),
    profileUpdate: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_UPDATE, payload),
    profileSetAvatarData: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_SET_AVATAR_DATA, payload),
    profileSetAvatarFromPresetPng: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_SET_AVATAR_PRESET, payload),
    profileValidateAvatarData: (dataUrl) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_VALIDATE_AVATAR, { dataUrl }),
    profileListPresetAvatarPngs: () => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_LIST_PRESETS),
    profileClearAvatar: (profileId) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_CLEAR_AVATAR, { profileId }),
    profileGetAvatarDataUrl: (profileId) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_GET_AVATAR, { profileId }),
    profileDelete: (profileId) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_DELETE, { profileId }),
    profileOpenWindow: (profileId, options = {}) => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_OPEN_WINDOW, { profileId, closeProfilePicker: options.closeProfilePicker === true }),
    profilePickerOpen: () => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_PICKER_OPEN),
    profileCloseCurrent: () => ipcRenderer.invoke(C.IPC_INVOKE.PROFILE_CLOSE_CURRENT),
    recentlyClosedList: () => ipcRenderer.invoke(C.IPC_INVOKE.RECENTLY_CLOSED_LIST),
    recentlyClosedRestore: (closedAt) => ipcRenderer.invoke(C.IPC_INVOKE.RECENTLY_CLOSED_RESTORE, { closedAt }),

    // Session
    sessionSave: (data) => ipcRenderer.invoke(C.IPC_INVOKE.SESSION_SAVE, data),
    sessionLoad: () => ipcRenderer.invoke(C.IPC_INVOKE.SESSION_LOAD),

    // WebAuthn / Cookies
    webauthnGetCookieUsage: () => ipcRenderer.invoke('webauthn:getCookieUsage'),
    webauthnDeleteCookies: (domain) => ipcRenderer.invoke('webauthn:deleteCookies', domain),
    webauthnBlockCookies: (domain) => ipcRenderer.invoke('webauthn:blockCookies', domain),

    getTabInfo: (id) => ipcRenderer.invoke(C.IPC_INVOKE.TAB_GET_INFO, { id }),
    tabHideActive: () => ipcRenderer.invoke(C.IPC_INVOKE.TAB_HIDE_ACTIVE),
    tabRestoreActive: () => ipcRenderer.invoke(C.IPC_INVOKE.TAB_RESTORE_ACTIVE),
    tabCaptureActiveSnapshot: () => ipcRenderer.invoke(C.IPC_INVOKE.TAB_CAPTURE_SNAPSHOT),
    tabPrepareShellOverlay: () => ipcRenderer.invoke(C.IPC_INVOKE.TAB_PREPARE_SHELL_OVERLAY),
    /** Native tab strip context menu (Menu.popup); actions via onTabStripContextMenuAction. */
    tabStripContextMenuShow: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.TAB_STRIP_CONTEXT_MENU, payload),
    onTabStripContextMenuAction: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(C.IPC_EVENT.TAB_STRIP_MENU_ACTION, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.TAB_STRIP_MENU_ACTION, handler);
    },

    chromeOverlayV1Reset: () => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_OVERLAY_RESET),
    chromeOverlayV1Acquire: () => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_OVERLAY_ACQUIRE),
    chromeOverlayV1Release: () => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_OVERLAY_RELEASE),
    chromeOverlayV1Post: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_OVERLAY_POST, payload),
    chromeShellMenuOverlayV1Reset: () => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_RESET),
    chromeShellMenuOverlayV1Acquire: () => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_ACQUIRE),
    chromeShellMenuOverlayV1Release: () => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_RELEASE),
    chromeShellMenuOverlayV1Post: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.CHROME_SHELL_MENU_OVERLAY_POST, payload),
    onChromeOverlayV1HostEvent: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(C.IPC_EVENT.CHROME_OVERLAY_HOST, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.CHROME_OVERLAY_HOST, handler);
    },
    onChromeOverlaySuperseded: (callback) => {
        const handler = () => callback();
        ipcRenderer.on(C.IPC_EVENT.CHROME_OVERLAY_SUPERSEDED, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.CHROME_OVERLAY_SUPERSEDED, handler);
    },
    onOmniboxOverlayDelivered: (callback) => {
        const handler = () => callback();
        ipcRenderer.on(C.IPC_EVENT.OMNIBOX_OVERLAY_DELIVERED, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.OMNIBOX_OVERLAY_DELIVERED, handler);
    },
    onChromeShellMenuOverlaySuperseded: (callback) => {
        const handler = () => callback();
        ipcRenderer.on(C.IPC_EVENT.CHROME_SHELL_MENU_OVERLAY_SUPERSEDED, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.CHROME_SHELL_MENU_OVERLAY_SUPERSEDED, handler);
    },
    chromeOverlayNotifyHost: (data) => ipcRenderer.send(C.IPC_SEND.CHROME_OVERLAY_FROM_OVERLAY, data),
    onChromeOverlayV1Patch: (callback) => {
        const handler = (_event, payload) => callback(payload);
        ipcRenderer.on(C.IPC_EVENT.CHROME_OVERLAY_PATCH, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.CHROME_OVERLAY_PATCH, handler);
    },

    // Lazy tab loading: register a tab as sleeping (no WebContentsView created yet)
    tabSleepRegister: (id, url, meta = {}) => ipcRenderer.send(C.IPC_SEND.TAB_SLEEP_REGISTER, { id, url, title: meta.title, favicon: meta.favicon, history: meta.history }),
    onTabAwoken: (callback) => ipcRenderer.on(C.IPC_EVENT.TAB_AWOKEN, (event, data) => callback(data)),

    // Settings
    settingsGet: () => ipcRenderer.invoke(C.IPC_INVOKE.SETTINGS_GET),
    settingsSave: (data) => ipcRenderer.invoke(C.IPC_INVOKE.SETTINGS_SAVE, data),
    settingsUpdated: (callback) => ipcRenderer.on(C.IPC_INVOKE.SETTINGS_UPDATE, (event, data) => callback(data)),
    appRelaunch: () => ipcRenderer.invoke(C.IPC_INVOKE.APP_RELAUNCH),

    // Theme
    onThemeApply: (callback) => {
        const handler = (_event, payload) => callback(payload);
        ipcRenderer.on(C.IPC_EVENT.THEME_APPLY, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.THEME_APPLY, handler);
    },

    // Compatibility Diagnostics
    compatDiagGetReport: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.COMPAT_GET_REPORT, payload),
    compatDiagClear: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.COMPAT_CLEAR, payload),
    identityDiagGetReport: (payload) => ipcRenderer.invoke(C.IPC_INVOKE.IDENTITY_DIAG_GET_REPORT, payload),
    clipboardWriteText: (text) => ipcRenderer.invoke(C.IPC_INVOKE.CLIPBOARD_WRITE, { text: String(text || '') }),
    clipboardReadText: () => ipcRenderer.invoke(C.IPC_INVOKE.CLIPBOARD_READ),

    // New Tab Page
    ntpGetTopSites: () => ipcRenderer.invoke(C.IPC_INVOKE.NTP_TOP_SITES),
    ntpStealFocus: () => ipcRenderer.send(C.IPC_SEND.OMNIBOX_STEAL_FOCUS),

    // Tooltip Overlay
    tooltipShow: (data) => ipcRenderer.send(C.IPC_SEND.TOOLTIP_SHOW, data),
    tooltipHide: () => ipcRenderer.send(C.IPC_SEND.TOOLTIP_HIDE),
    onTooltipUpdate: (callback) => ipcRenderer.on(C.IPC_EVENT.TOOLTIP_UPDATE, (event, v) => callback(v)),

    // Permissions & Site Settings
    permissionsGetOriginState: (origin, profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_GET_ORIGIN_STATE, { origin, profileId }),
    permissionsSetOriginState: (origin, permission, state, profileId = null, persist = true) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_SET_ORIGIN_STATE, { origin, permission, state, profileId, persist }),
    permissionsResetOrigin: (origin, profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_RESET_ORIGIN, { origin, profileId }),
    permissionsGetAll: (profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_GET_ALL, { profileId }),
    permissionsDelete: (origin, permission, profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_DELETE, { origin, permission, profileId }),
    permissionsClearAll: (profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_CLEAR_ALL, { profileId }),
    permissionsPromptRespond: (promptId, decision, persist = false) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_PROMPT_RESPOND, { promptId, decision, persist }),
    onPermissionPromptRequest: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(C.IPC_EVENT.PERMISSION_PROMPT_REQUEST, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.PERMISSION_PROMPT_REQUEST, handler);
    },
    onPermissionPromptDismissed: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on(C.IPC_EVENT.PERMISSION_PROMPT_DISMISSED, handler);
        return () => ipcRenderer.removeListener(C.IPC_EVENT.PERMISSION_PROMPT_DISMISSED, handler);
    },

    // Platform identifier
    platform: process.platform,
});

contextBridge.exposeInMainWorld('permissionAPI', {
    getOriginState: (origin, profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_GET_ORIGIN_STATE, { origin, profileId }),
    setOriginState: (origin, permission, state, profileId = null, persist = true) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_SET_ORIGIN_STATE, { origin, permission, state, profileId, persist }),
    resetOrigin: (origin, profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_RESET_ORIGIN, { origin, profileId }),
    getAll: (profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_GET_ALL, { profileId }),
    deletePermission: (origin, permission, profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_DELETE, { origin, permission, profileId }),
    clearAll: (profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_CLEAR_ALL, { profileId }),
    respondToPrompt: (promptId, decision, persist = false) => ipcRenderer.invoke(C.IPC_INVOKE.PERMISSIONS_PROMPT_RESPOND, { promptId, decision, persist }),
});

contextBridge.exposeInMainWorld('cookieAPI', {
    getCookieSummary: (profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.COOKIE_SUMMARY, { profileId }),
    deleteCookiesForDomain: (profileIdOrDomain, maybeDomain) => {
        const hasProfile = maybeDomain !== undefined;
        return ipcRenderer.invoke(C.IPC_INVOKE.COOKIE_DELETE_DOMAIN, {
            profileId: hasProfile ? profileIdOrDomain : null,
            domain: String(hasProfile ? maybeDomain : profileIdOrDomain || ''),
        });
    },
    clearAllSiteData: (profileId = null, options = {}) => ipcRenderer.invoke(C.IPC_INVOKE.COOKIE_CLEAR_ALL, {
        profileId,
        since: options?.since ?? null,
    }),
    getSettings: (profileId = null) => ipcRenderer.invoke(C.IPC_INVOKE.COOKIE_SETTINGS_GET, { profileId }),
    updateSettings: (config) => ipcRenderer.invoke(C.IPC_INVOKE.COOKIE_SETTINGS_UPDATE, { config }),
    updateConfig: (profileId, config) => ipcRenderer.invoke(C.IPC_INVOKE.COOKIE_SETTINGS_UPDATE, { profileId, config }),
});

