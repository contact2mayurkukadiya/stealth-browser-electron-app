
const path = require('path');
const C = require('../../src/constants/conditionStrings.cjs');
const State = require('../state');

const {
    focusedShellWebContents,
    getWindowContextForShellFallback,
    getWindowContextByEventSender
} = require('../windows/windowContextUtils');

const { restoreRecentlyClosed } = require('../services/sessionService');

// Helper to handle keyboard shortcuts across different WebContents
function handleShortcuts(event, input) {
    if (input.type !== 'keyDown') return;

    const key = input.key.toLowerCase();
    const isCommandOrControlPressed = input.control || input.meta;

    const senderContext = event?.sender ? getWindowContextByEventSender(event.sender) : null;
    const context = senderContext || getWindowContextForShellFallback();
    const { getLensSession, closeGoogleLensSelection } = require('../windows/lensManager');
    const lensSelectionActive = getLensSession(context, context?.activeTabId, false)?.selectionActive;

    if (lensSelectionActive) {
        if (key === ' ' || key === 'space' || input.code === 'Space') {
            event.preventDefault();
            return;
        }
        if (key === 'escape') {
            event.preventDefault();
            closeGoogleLensSelection(context, { closeSidebar: true });
            return;
        }
    }

    if (isCommandOrControlPressed && key === 'y') {
        event.preventDefault();
        focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_HISTORY);
        return;
    }

    if (isCommandOrControlPressed && input.shift && key === 't') {
        event.preventDefault();
        restoreRecentlyClosed(null, context);
        return;
    }

    if (isCommandOrControlPressed && !input.shift && key === 'p') {
        event.preventDefault();
        const { printActiveTab } = require('../windows/tabManager');
        printActiveTab();
        return;
    }

    // Only handle Ctrl+Tab here, as others are handled by the Menu
    if (input.control && input.key === 'Tab') {
        event.preventDefault();
        focusedShellWebContents()?.send(C.IPC_EVENT.SHORTCUT_SWITCH_TAB, { direction: input.shift ? -1 : 1 });
    }
}

module.exports = {
    handleShortcuts
};