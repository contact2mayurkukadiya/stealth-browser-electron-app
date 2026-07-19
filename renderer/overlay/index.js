import { DOM, hideAll, IS_OMNIBOX_OVERLAY, IS_LENS_OVERLAY } from './state.js';
import { applyChromeThemeTokens, notifyHost } from './api.js';

import { renderAppMenu } from './components/appMenu.js';
import { renderProfileMenu } from './components/profileMenu.js';
import { renderBookmarkContextMenu } from './components/bookmarkContextMenu.js';
import { renderBookmarkFolderMenu } from './components/bookmarkFolderMenu.js';
import { renderBookmarkEditor } from './components/bookmarkEditor.js';
import { renderSiteInfo } from './components/siteInfo.js';
import { renderCookieControls, renderDownloadPanel } from './components/compactPanels.js';
import { renderOmniboxSuggestions } from './components/omnibox.js';
import { renderLensSelection } from './components/lensSelection.js';

DOM.backdrop.addEventListener('mousedown', function () {
    notifyHost({ type: 'dismiss' });
});

document.addEventListener('keydown', function (e) {
    const lensLayer = document.querySelector('.co-lens-layer');
    if (lensLayer && (e.key === ' ' || e.code === 'Space')) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    if (e.key === 'Escape') {
        if (DOM.panel.classList.contains('co-visible') || DOM.submenu.classList.contains('co-visible')) {
            e.preventDefault();
            e.stopPropagation();
            notifyHost({ type: 'dismiss' });
            return;
        }
        if (lensLayer) {
            e.preventDefault();
            e.stopPropagation();
            notifyHost({ type: 'lensSelectionCancel', closeSidebar: true });
            return;
        }
        notifyHost({ type: 'dismiss' });
    }
});

if (window.electronAPI && window.electronAPI.onChromeOverlayV1Patch) {
    window.electronAPI.onChromeOverlayV1Patch(function (patch) {
        try {
            if (!patch || patch.kind === 'hide') return hideAll();
            if (patch.kind === 'chromeTheme') return applyChromeThemeTokens(patch);

            if (IS_OMNIBOX_OVERLAY) {
                if (patch.kind === 'omniboxSuggestions') renderOmniboxSuggestions(patch);
                return;
            }
            if (IS_LENS_OVERLAY) {
                if (patch.kind === 'lensSelection') renderLensSelection(patch);
                return;
            }

            if (patch.kind === 'lensSelection' || patch.kind === 'omniboxSuggestions') return;

            switch (patch.kind) {
                case 'profileMenu': return renderProfileMenu(patch);
                case 'siteInfo': return renderSiteInfo(patch);
                case 'cookieControls': return renderCookieControls(patch);
                case 'downloadPanel': return renderDownloadPanel(patch);
                case 'appMenu': return renderAppMenu(patch);
                case 'bookmarkContextMenu': return renderBookmarkContextMenu(patch);
                case 'bookmarkFolderMenu': return renderBookmarkFolderMenu(patch);
                case 'bookmarkEditor': return renderBookmarkEditor(patch);
            }
        } catch (err) {
            // If any menu crashes, log it and safely reset the overlay to prevent freezing
            console.error('Overlay rendering error:', err);
            hideAll();
            notifyHost({ type: 'dismiss' });
        }
    });
}