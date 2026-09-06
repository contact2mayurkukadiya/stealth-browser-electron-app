/**
 * Windows Native Non-Activating ("Ghost") Window Hook
 *
 * Configures an Electron BrowserWindow's top-level and child HWNDs (Chrome_RenderWidgetHostHWND)
 * with WS_EX_NOACTIVATE and subclass procedures (comctl32!SetWindowSubclass) to intercept
 * WM_MOUSEACTIVATE, WM_NCMOUSEACTIVATE, and WM_NCLBUTTONDOWN, preventing window activation
 * or focus theft when clicked or dragged.
 */

const koffi = require('koffi');

let initialized = false;
let initError = null;

// User32 & ComCtl32 exports
let GetWindowLongPtrW;
let SetWindowLongPtrW;
let SetWindowPos;
let EnumChildWindows;
let PostMessageW;
let SetCapture;
let ReleaseCapture;
let IsWindow;
let SetWindowSubclass;
let RemoveWindowSubclass;
let DefSubclassProc;

let subclassCallbackPtr = null;
let enumChildCallbackPtr = null;

// Win32 Constants
const GWL_EXSTYLE = -20;
const WS_EX_NOACTIVATE = 0x08000000;

const WM_ACTIVATE = 0x0006;
const WM_CLOSE = 0x0010;
const WM_MOUSEACTIVATE = 0x0021;
const WM_NCMOUSEACTIVATE = 0x00A2;
const WM_NCLBUTTONDOWN = 0x00A1;

const WA_INACTIVE = 0;
const MA_NOACTIVATE = 3;
const HTCAPTION = 2;
const HTCLOSE = 20;

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;

const GHOST_SUBCLASS_ID = 0x47484F53; // 'GHOS'

const hookedHwnds = new Set();

function initWin32Native() {
    if (initialized) return true;
    if (process.platform !== 'win32') return false;

    try {
        const user32 = koffi.load('user32.dll');
        const comctl32 = koffi.load('comctl32.dll');

        GetWindowLongPtrW = user32.func('GetWindowLongPtrW', 'intptr_t', ['void*', 'int']);
        SetWindowLongPtrW = user32.func('SetWindowLongPtrW', 'intptr_t', ['void*', 'int', 'intptr_t']);
        SetWindowPos = user32.func('SetWindowPos', 'bool', ['void*', 'void*', 'int', 'int', 'int', 'int', 'uint32_t']);
        EnumChildWindows = user32.func('EnumChildWindows', 'bool', ['void*', 'void*', 'intptr_t']);
        PostMessageW = user32.func('PostMessageW', 'bool', ['void*', 'uint32_t', 'uintptr_t', 'intptr_t']);
        SetCapture = user32.func('SetCapture', 'void*', ['void*']);
        ReleaseCapture = user32.func('ReleaseCapture', 'bool', []);
        IsWindow = user32.func('IsWindow', 'bool', ['void*']);

        SetWindowSubclass = comctl32.func('SetWindowSubclass', 'bool', ['void*', 'void*', 'uintptr_t', 'uintptr_t']);
        RemoveWindowSubclass = comctl32.func('RemoveWindowSubclass', 'bool', ['void*', 'void*', 'uintptr_t']);
        DefSubclassProc = comctl32.func('DefSubclassProc', 'intptr_t', ['void*', 'uint32_t', 'uintptr_t', 'intptr_t']);

        const HTCLIENT = 1;

        // Define SubclassProc callback prototype:
        // LRESULT CALLBACK SubclassProc(HWND hWnd, UINT uMsg, WPARAM wParam, LPARAM lParam, UINT_PTR uIdSubclass, DWORD_PTR dwRefData);
        const SubclassProto = koffi.proto('intptr_t SubclassProto(void *hWnd, uint32_t uMsg, uintptr_t wParam, intptr_t lParam, uintptr_t uIdSubclass, uintptr_t dwRefData)');
        subclassCallbackPtr = koffi.register((hWnd, uMsg, wParam, lParam, uIdSubclass, dwRefData) => {
            // 1. Mouse activate: Only return MA_NOACTIVATE for non-client caption/drag areas to avoid focus theft on drag.
            // For client area (buttons, tabs, inputs), let DefSubclassProc handle so inputs and buttons function normally.
            if (uMsg === WM_MOUSEACTIVATE || uMsg === WM_NCMOUSEACTIVATE) {
                const hitTest = Number(lParam) & 0xffff;
                if (hitTest === HTCAPTION) {
                    return MA_NOACTIVATE;
                }
                return DefSubclassProc(hWnd, uMsg, wParam, lParam);
            }

            // 2. Non-client click (Close button / Caption)
            if (uMsg === WM_NCLBUTTONDOWN) {
                if (Number(wParam) === HTCLOSE) {
                    PostMessageW(hWnd, WM_CLOSE, 0, 0);
                    return 0;
                }
                if (Number(wParam) === HTCAPTION) {
                    // Suppress DefWindowProc activation on caption click
                    return 0;
                }
            }

            return DefSubclassProc(hWnd, uMsg, wParam, lParam);
        }, koffi.pointer(SubclassProto));

        // Define EnumWindowsProc callback prototype:
        // BOOL CALLBACK EnumChildProc(HWND hWnd, LPARAM lParam);
        const EnumProto = koffi.proto('bool EnumProto(void *hWnd, intptr_t lParam)');
        enumChildCallbackPtr = koffi.register((hWnd, lParam) => {
            // Child rendering windows must not be blocked from receiving focus/input
            return true;
        }, koffi.pointer(EnumProto));

        initialized = true;
        return true;
    } catch (err) {
        initError = err;
        console.error('[ghost-win32] Native initialization failed:', err);
        return false;
    }
}

function resolveHwndPointer(handleBuffer) {
    if (!handleBuffer || !Buffer.isBuffer(handleBuffer)) return null;
    const hwndVal = handleBuffer.length === 8
        ? handleBuffer.readBigUInt64LE()
        : BigInt(handleBuffer.readUInt32LE(0));
    if (!hwndVal || hwndVal === 0n) return null;
    return koffi.as(hwndVal, 'void*');
}

/**
 * Configure an HWND pointer as a non-activating ghost window.
 * @param {Buffer} handleBuffer Buffer returned by win.getNativeWindowHandle()
 */
function makeGhostWin32(handleBuffer) {
    if (!initWin32Native()) return false;
    const hwnd = resolveHwndPointer(handleBuffer);
    if (!hwnd || !IsWindow(hwnd)) return false;

    try {
        // 1. Set WS_EX_NOACTIVATE extended style on top-level HWND
        const currentExStyle = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
        const newExStyle = currentExStyle | WS_EX_NOACTIVATE;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, newExStyle);

        // 2. Refresh frame with SWP_NOACTIVATE
        SetWindowPos(hwnd, null, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);

        // 3. Subclass top-level HWND
        if (!hookedHwnds.has(hwnd)) {
            hookedHwnds.add(hwnd);
            SetWindowSubclass(hwnd, subclassCallbackPtr, GHOST_SUBCLASS_ID, 0);
        }

        // 4. Subclass all child Chromium HWNDs
        hookChildWindowsWin32(handleBuffer);

        return true;
    } catch (err) {
        console.error('[ghost-win32] Failed to make window ghost:', err);
        return false;
    }
}

/**
 * Re-enumerate and subclass all child windows (e.g. after tab or WebContentsView changes).
 * @param {Buffer} handleBuffer Buffer returned by win.getNativeWindowHandle()
 */
function hookChildWindowsWin32(handleBuffer) {
    if (!initWin32Native()) return false;
    const hwnd = resolveHwndPointer(handleBuffer);
    if (!hwnd || !IsWindow(hwnd)) return false;

    try {
        EnumChildWindows(hwnd, enumChildCallbackPtr, 0);
        return true;
    } catch (err) {
        console.error('[ghost-win32] Failed to hook child windows:', err);
        return false;
    }
}

module.exports = {
    makeGhostWin32,
    hookChildWindowsWin32,
};
