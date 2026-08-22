/**
 * Applies nonActivatingInteraction setting changes across ghost window + shadow input.
 */
const { applyGhostModeFromSettings } = require('../ghostWindow/GhostWindowController');
const globalInputController = require('../input/GlobalInputController');

function applyNonActivatingInteractionFromSettings(settings) {
    const enabled = settings?.nonActivatingInteraction === true;

    applyGhostModeFromSettings();

    if (enabled) {
        globalInputController.enableNonActivatingMode();
    } else {
        globalInputController.disableNonActivatingMode();
    }
}

function initNonActivatingInteractionFromSettings() {
    const { loadSettings } = require('./settingsService');
    applyNonActivatingInteractionFromSettings(loadSettings());
}

module.exports = {
    applyNonActivatingInteractionFromSettings,
    initNonActivatingInteractionFromSettings,
};
