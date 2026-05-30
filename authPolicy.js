// --- START OF FILE authPolicy.js ---

const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0';

const GOOGLE_AUTH_DOMAINS = [
    'accounts.google.com',
    'myaccount.google.com',
    'mail.google.com',
    'accounts.youtube.com'
];

function isGoogleAuthUrl(urlStr) {
    try {
        const hostname = new URL(urlStr).hostname;
        return GOOGLE_AUTH_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
    } catch {
        return false;
    }
}

/** Applies Strict URL filtering solely to Google Services handling Network Hooks */
function applyGoogleAuthPolicy(targetSession) {
    if (!targetSession) return;

    // Apply header mutations narrowly—preventing disruptions across other basic Google APIs
    const authUrlsFilter = { urls: ['*://accounts.google.com/*', '*://mail.google.com/*', '*://accounts.youtube.com/*', '*://myaccount.google.com/*'] };

    targetSession.webRequest.onBeforeSendHeaders(authUrlsFilter, (details, callback) => {
        const requestHeaders = Object.assign({}, details.requestHeaders);

        // Annihilate internal native Client Hints exposing "Electron" or standard "Chrome" details.
        delete requestHeaders['sec-ch-ua'];
        delete requestHeaders['sec-ch-ua-mobile'];
        delete requestHeaders['sec-ch-ua-platform'];
        delete requestHeaders['sec-ch-ua-arch'];
        delete requestHeaders['sec-ch-ua-full-version-list'];

        // Synchronize Network Request strictly to match standard Mozilla footprints.
        requestHeaders['User-Agent'] = FIREFOX_UA;
        requestHeaders['Accept-Language'] = 'en-US,en;q=0.5';

        callback({ requestHeaders });
    });
}

/** 
 * Solves "Identity Desynchronization"!
 * Binds specifically into Tabs to securely mirror network/JavaScript realities avoiding intermittent mismatch flags
 */
function setupTabForGoogleAuth(webContents, getStandardAppUserAgentFn) {
    // Determine the base identity to restore to globally 
    const baseStandardChromeIdentity = getStandardAppUserAgentFn();

    // Assign Base User Agent automatically on load natively!
    webContents.setUserAgent(baseStandardChromeIdentity);

    // Watch for url hopping: when heading into Google SSO, become FireFox instantly in JS too.
    webContents.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
        if (!isMainFrame) return;

        if (isGoogleAuthUrl(url)) {
            // Apply DOM level Javascript impersonation safely synchronizing headers seamlessly 
            webContents.setUserAgent(FIREFOX_UA);

            // Destroy "navigator.userAgentData" using JS which does not natively exist in Firefox
            webContents.executeJavaScript(`
                try {
                    if (window.navigator.userAgentData) {
                        Object.defineProperty(window.navigator, 'userAgentData', { get: () => undefined, configurable: true });
                    }
                } catch(_) {}
            `).catch(() => { });

        } else {
            // Returning outside Google environments naturally resumes perfect Standard Chrome identity
            webContents.setUserAgent(baseStandardChromeIdentity);
        }
    });
}

module.exports = {
    applyGoogleAuthPolicy,
    setupTabForGoogleAuth
};

// --- END OF FILE authPolicy.js ---