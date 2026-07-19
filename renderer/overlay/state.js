export const DOM = {
    backdrop: document.getElementById('backdrop'),
    panel: document.getElementById('panel'),
    submenu: document.getElementById('submenu'),
};

const overlaySearch = window.location.search || '';
export const IS_SHELL_MENU_OVERLAY = overlaySearch.indexOf('shellMenu=1') >= 0;
export const IS_OMNIBOX_OVERLAY = overlaySearch.indexOf('omnibox=1') >= 0;
export const IS_LENS_OVERLAY = !IS_SHELL_MENU_OVERLAY && !IS_OMNIBOX_OVERLAY;

const resetHooks = [];
export function onHideAll(fn) {
    if (typeof fn === 'function') {
        resetHooks.push(fn);
    }
}

export function hideAll(options = { hideLens: true }) {
    // 1. Defensively clear DOM classes and ALL inline styles
    try {
        if (DOM.backdrop) {
            DOM.backdrop.classList.remove('co-visible', 'co-backdrop--omnibox');
        }

        if (DOM.panel) {
            DOM.panel.classList.remove(
                'co-visible', 'co-panel--editor', 'co-panel--omnibox',
                'co-panel--folder-menu', 'co-panel--app-menu'
            );
            DOM.panel.style.cssText = ''; // Completely wipes leftover inline styles!
            DOM.panel.innerHTML = '';
        }

        if (DOM.submenu) {
            DOM.submenu.classList.remove('co-visible');
            DOM.submenu.style.cssText = ''; // Completely wipes leftover inline styles!
            DOM.submenu.innerHTML = '';
        }
    } catch (err) {
        console.error('Error clearing DOM in hideAll:', err);
    }

    // 2. Defensively execute all registered cleanup hooks
    try {
        resetHooks.forEach(hook => {
            try {
                hook(options);
            } catch (err) {
                console.error('Error in hideAll hook:', err);
            }
        });
    } catch (err) {
        console.error('Error iterating resetHooks:', err);
    }
}