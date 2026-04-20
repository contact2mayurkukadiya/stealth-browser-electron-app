// --- START OF FILE authPolicy.js ---

/** 
 * Scoped URL filters ensuring we only spoof Google Services that 
 * enforce harsh hardware validations on Chromium variants.
 */
const GOOGLE_URLS = [
    "*://accounts.google.com/*",
    "*://myaccount.google.com/*",
    "*://mail.google.com/*",
    "*://*.youtube.com/*",
    "*://*.gstatic.com/*",
    "*://*.googleusercontent.com/*",
    "*://*.google.com/recaptcha/*"
];

function applyGoogleAuthPolicy(targetSession) {
    if (!targetSession) return;

    // Use onBeforeSendHeaders with a strict URL filter. 
    targetSession.webRequest.onBeforeSendHeaders(
        { urls: GOOGLE_URLS },
        (details, callback) => {
            const requestHeaders = Object.assign({}, details.requestHeaders);

            // 1. Remove Chromium "Client Hints" which contain Electron tracking
            const keysToStrip = ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];
            for (const key in requestHeaders) {
                if (keysToStrip.includes(key.toLowerCase())) {
                    delete requestHeaders[key];
                }
            }

            // 2. Override ONLY for Google Domains with a modern FireFox user-agent.
            // When Google's auth servers see Firefox, they disable the hardware Chromium 
            // "Secure Browser" checks that traditionally flag Electron.
            const firefoxSpoof = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0';
            requestHeaders['User-Agent'] = firefoxSpoof;
            requestHeaders['Accept-Language'] = 'en-US,en;q=0.5';

            callback({ requestHeaders });
        }
    );
}

module.exports = {
    applyGoogleAuthPolicy
};
// --- END OF FILE authPolicy.js ---