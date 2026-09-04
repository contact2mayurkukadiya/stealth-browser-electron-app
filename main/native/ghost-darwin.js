/**
 * macOS Native Non-Activating ("Ghost") Window Hook
 *
 * Safely configures an Electron BrowserWindow's underlying NSWindow/NSPanel
 * as a floating, non-activating panel via Koffi C FFI and AppKit APIs.
 * Includes defensive selector guards and runtime type checking to eliminate
 * any possibility of uncaught Objective-C exceptions (SIGTRAP/SIGABRT).
 */

const koffi = require('koffi');

let initialized = false;
let initError = null;

let sel_registerName = null;
let objc_getClass = null;
let object_getClassName = null;
let msgSend_id = null;
let msgSend_uint64 = null;
let msgSend_void_uint64 = null;
let msgSend_void_bool = null;
let msgSend_bool_id = null;

let sel_window = null;
let sel_styleMask = null;
let sel_setStyleMask = null;
let sel_setLevel = null;
let sel_collectionBehavior = null;
let sel_setCollectionBehavior = null;
let sel_setHidesOnDeactivate = null;
let sel_isKindOfClass = null;
let sel_respondsToSelector = null;

let nsWindowClass = null;
let nsPanelClass = null;

function initDarwinNative() {
    if (initialized) return true;
    if (process.platform !== 'darwin') return false;

    try {
        koffi.load('/System/Library/Frameworks/AppKit.framework/AppKit');
        const libobjc = koffi.load('/usr/lib/libobjc.A.dylib');

        sel_registerName = libobjc.func('sel_registerName', 'void*', ['str']);
        objc_getClass = libobjc.func('objc_getClass', 'void*', ['str']);
        object_getClassName = libobjc.func('object_getClassName', 'str', ['void*']);

        msgSend_id = libobjc.func('objc_msgSend', 'void*', ['void*', 'void*']);
        msgSend_uint64 = libobjc.func('objc_msgSend', 'uint64_t', ['void*', 'void*']);
        msgSend_void_uint64 = libobjc.func('objc_msgSend', 'void', ['void*', 'void*', 'uint64_t']);
        msgSend_void_bool = libobjc.func('objc_msgSend', 'void', ['void*', 'void*', 'bool']);
        msgSend_bool_id = libobjc.func('objc_msgSend', 'bool', ['void*', 'void*', 'void*']);

        sel_window = sel_registerName('window');
        sel_styleMask = sel_registerName('styleMask');
        sel_setStyleMask = sel_registerName('setStyleMask:');
        sel_setLevel = sel_registerName('setLevel:');
        sel_collectionBehavior = sel_registerName('collectionBehavior');
        sel_setCollectionBehavior = sel_registerName('setCollectionBehavior:');
        sel_setHidesOnDeactivate = sel_registerName('setHidesOnDeactivate:');
        sel_isKindOfClass = sel_registerName('isKindOfClass:');
        sel_respondsToSelector = sel_registerName('respondsToSelector:');

        nsWindowClass = objc_getClass('NSWindow');
        nsPanelClass = objc_getClass('NSPanel');

        initialized = true;
        return true;
    } catch (err) {
        initError = err;
        console.error('[ghost-darwin] Native initialization failed:', err);
        return false;
    }
}

/**
 * Safely resolves an NSWindow pointer from an NSWindow or NSView handle.
 * Never calls -window on an object unless it explicitly responds to it.
 */
function safeResolveNSWindow(ptr) {
    if (!ptr || ptr === 0n) return 0n;
    try {
        // If ptr is already an NSWindow or subclass (e.g. ElectronNSWindow / ElectronNSPanel)
        if (nsWindowClass && msgSend_bool_id(ptr, sel_isKindOfClass, nsWindowClass)) {
            return ptr;
        }
        // If ptr is an NSView (e.g. contentView), check if it responds to -window
        if (sel_respondsToSelector && sel_window && msgSend_bool_id(ptr, sel_respondsToSelector, sel_window)) {
            return msgSend_id(ptr, sel_window);
        }
    } catch (err) {
        console.warn('[ghost-darwin] safeResolveNSWindow error:', err?.message || err);
    }
    return 0n;
}

/**
 * Configure an NSWindow/NSPanel pointer as a non-activating ghost panel.
 * @param {Buffer} handleBuffer Buffer returned by win.getNativeWindowHandle()
 */
function makeGhostDarwin(handleBuffer) {
    if (!initDarwinNative()) return false;
    if (!handleBuffer || !Buffer.isBuffer(handleBuffer)) return false;

    try {
        const rawPtr = handleBuffer.length === 8
            ? handleBuffer.readBigUInt64LE()
            : BigInt(handleBuffer.readUInt32LE(0));

        if (!rawPtr || rawPtr === 0n) return false;

        const nsWindow = safeResolveNSWindow(rawPtr);
        if (!nsWindow || nsWindow === 0n) return false;

        // 1. Set window level to floating (NSFloatingWindowLevel = 3)
        try {
            if (sel_respondsToSelector && sel_setLevel && msgSend_bool_id(nsWindow, sel_respondsToSelector, sel_setLevel)) {
                const NSFloatingWindowLevel = 3n;
                msgSend_void_uint64(nsWindow, sel_setLevel, NSFloatingWindowLevel);
            }
        } catch (e) {
            console.warn('[ghost-darwin] setLevel failed:', e?.message || e);
        }

        // 2. Set collection behavior:
        //    CanJoinAllSpaces (1 << 0 = 1) | Stationary (1 << 4 = 16) | IgnoresCycle (1 << 6 = 64)
        try {
            if (sel_respondsToSelector && sel_setCollectionBehavior && msgSend_bool_id(nsWindow, sel_respondsToSelector, sel_setCollectionBehavior)) {
                let currentBehavior = 0n;
                if (sel_collectionBehavior && msgSend_bool_id(nsWindow, sel_respondsToSelector, sel_collectionBehavior)) {
                    currentBehavior = BigInt(msgSend_uint64(nsWindow, sel_collectionBehavior));
                }
                const behaviors = 1n | 16n | 64n;
                msgSend_void_uint64(nsWindow, sel_setCollectionBehavior, currentBehavior | behaviors);
            }
        } catch (e) {
            console.warn('[ghost-darwin] setCollectionBehavior failed:', e?.message || e);
        }

        // 3. Set hidesOnDeactivate to NO
        try {
            if (sel_respondsToSelector && sel_setHidesOnDeactivate && msgSend_bool_id(nsWindow, sel_respondsToSelector, sel_setHidesOnDeactivate)) {
                msgSend_void_bool(nsWindow, sel_setHidesOnDeactivate, false);
            }
        } catch (e) {
            console.warn('[ghost-darwin] setHidesOnDeactivate failed:', e?.message || e);
        }

        // 4. If window is an NSPanel, safely apply NSWindowStyleMaskNonactivatingPanel (1 << 7 = 128)
        try {
            const isPanel = nsPanelClass ? msgSend_bool_id(nsWindow, sel_isKindOfClass, nsPanelClass) : false;
            if (isPanel && sel_respondsToSelector && sel_setStyleMask && msgSend_bool_id(nsWindow, sel_respondsToSelector, sel_setStyleMask)) {
                let currentMask = 0n;
                if (sel_styleMask && msgSend_bool_id(nsWindow, sel_respondsToSelector, sel_styleMask)) {
                    currentMask = BigInt(msgSend_uint64(nsWindow, sel_styleMask));
                }
                const NSWindowStyleMaskNonactivatingPanel = 128n;
                msgSend_void_uint64(nsWindow, sel_setStyleMask, currentMask | NSWindowStyleMaskNonactivatingPanel);
            }
        } catch (e) {
            console.warn('[ghost-darwin] setStyleMask failed:', e?.message || e);
        }

        return true;
    } catch (err) {
        console.error('[ghost-darwin] Failed to make window ghost:', err);
        return false;
    }
}

function setGhostApplicationModeDarwin(enabled) {
    // Kept for interface compatibility
}

module.exports = {
    makeGhostDarwin,
    setGhostApplicationModeDarwin,
};
