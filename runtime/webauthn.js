const { ipcMain, BrowserWindow } = require('electron');
const webauthn = require('electron-webauthn');

function setupWebAuthn() {
    ipcMain.handle('webauthn:create', async (event, publicKeyOptions) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            return { success: false, error: 'AbortError' };
        }

        const additionalOptions = {
            currentOrigin: new URL(event.senderFrame.url).origin,
            topFrameOrigin: new URL(event.sender.getURL()).origin,
            nativeWindowHandle: window.getNativeWindowHandle()
        };

        try {
            return await webauthn.createCredential(publicKeyOptions, additionalOptions);
        } catch (error) {
            console.error('WebAuthn create error:', error);
            return { success: false, error: 'AbortError', errorObject: error };
        }
    });

    ipcMain.handle('webauthn:get', async (event, publicKeyOptions) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            return { success: false, error: 'AbortError' };
        }

        const additionalOptions = {
            currentOrigin: new URL(event.senderFrame.url).origin,
            topFrameOrigin: new URL(event.sender.getURL()).origin,
            nativeWindowHandle: window.getNativeWindowHandle()
        };

        try {
            return await webauthn.getCredential(publicKeyOptions, additionalOptions);
        } catch (error) {
            console.error('WebAuthn get error:', error);
            return { success: false, error: 'AbortError', errorObject: error };
        }
    });
}

module.exports = { setupWebAuthn };
