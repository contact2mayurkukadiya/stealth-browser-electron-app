'use strict';

/**
 * Enterprise Browser Permission System - Types and Constants
 */

const PERMISSION_NAMES = Object.freeze([
  'camera',
  'microphone',
  'geolocation',
  'notifications',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'pointerLock',
  'openExternal',
  'display-capture',
  'mediaKeySystem',
  'midi',
  'midiSysex',
  'sensors',
  'idle-detection',
  'usb',
  'hid',
  'serial',
  'bluetooth',
]);

const PERMISSION_STATES = Object.freeze([
  'allow',
  'deny',
  'prompt',
  'allow-this-session',
]);

/** User-friendly metadata for display in padlock popover and settings */
const PERMISSION_METADATA = Object.freeze({
  camera: {
    name: 'camera',
    label: 'Camera',
    description: 'Use your camera',
    icon: 'camera',
    category: 'hardware',
  },
  microphone: {
    name: 'microphone',
    label: 'Microphone',
    description: 'Use your microphone',
    icon: 'mic',
    category: 'hardware',
  },
  geolocation: {
    name: 'geolocation',
    label: 'Location',
    description: 'Know your location',
    icon: 'location',
    category: 'privacy',
  },
  notifications: {
    name: 'notifications',
    label: 'Notifications',
    description: 'Show notifications',
    icon: 'bell',
    category: 'communication',
  },
  'clipboard-read': {
    name: 'clipboard-read',
    label: 'Clipboard (Read)',
    description: 'See text and images copied to the clipboard',
    icon: 'clipboard',
    category: 'privacy',
  },
  'clipboard-sanitized-write': {
    name: 'clipboard-sanitized-write',
    label: 'Clipboard (Write)',
    description: 'Modify the clipboard',
    icon: 'clipboard',
    category: 'productivity',
  },
  'display-capture': {
    name: 'display-capture',
    label: 'Screen Sharing',
    description: 'Share your screen or browser window',
    icon: 'screen',
    category: 'hardware',
  },
  fullscreen: {
    name: 'fullscreen',
    label: 'Fullscreen',
    description: 'Open in fullscreen mode',
    icon: 'expand',
    category: 'display',
  },
  pointerLock: {
    name: 'pointerLock',
    label: 'Mouse Cursor Lock',
    description: 'Lock and hide the mouse pointer',
    icon: 'mouse',
    category: 'hardware',
  },
  openExternal: {
    name: 'openExternal',
    label: 'Open External Applications',
    description: 'Open links in external apps',
    icon: 'external-link',
    category: 'system',
  },
  usb: {
    name: 'usb',
    label: 'USB Devices',
    description: 'Connect to USB devices',
    icon: 'usb',
    category: 'hardware',
  },
  hid: {
    name: 'hid',
    label: 'HID Devices',
    description: 'Connect to Human Interface Devices',
    icon: 'keyboard',
    category: 'hardware',
  },
  serial: {
    name: 'serial',
    label: 'Serial Ports',
    description: 'Connect to serial devices',
    icon: 'cable',
    category: 'hardware',
  },
  bluetooth: {
    name: 'bluetooth',
    label: 'Bluetooth Devices',
    description: 'Connect to Bluetooth devices',
    icon: 'bluetooth',
    category: 'hardware',
  },
  midi: {
    name: 'midi',
    label: 'MIDI Devices',
    description: 'Use musical instrument digital interface devices',
    icon: 'music',
    category: 'hardware',
  },
  midiSysex: {
    name: 'midiSysex',
    label: 'MIDI (System Exclusive)',
    description: 'Control MIDI devices with system-exclusive messages',
    icon: 'music',
    category: 'hardware',
  },
  sensors: {
    name: 'sensors',
    label: 'Motion Sensors',
    description: 'Use motion and environmental sensors',
    icon: 'compass',
    category: 'hardware',
  },
  'idle-detection': {
    name: 'idle-detection',
    label: 'Idle Detection',
    description: 'Know when you are actively using your device',
    icon: 'clock',
    category: 'privacy',
  },
  mediaKeySystem: {
    name: 'mediaKeySystem',
    label: 'Protected Content (DRM)',
    description: 'Play protected digital audio and video',
    icon: 'shield',
    category: 'media',
  },
});

/**
 * Normalizes a URL string into an explicit RFC 6454 Origin (protocol://host:port).
 * Handles edge cases: null, invalid URLs, file://, app://.
 * @param {string} urlStr
 * @returns {string} Origin or empty string if invalid
 */
function normalizeOrigin(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return '';
  let trimmed = urlStr.trim();
  if (!trimmed || trimmed === 'null') return '';

  // If no scheme is present (e.g. "webcamtests.com" or "localhost:3000"),
  // prepend https:// so that new URL() can properly parse the origin.
  if (!trimmed.includes('://')) {
    trimmed = `https://${trimmed}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.origin && parsed.origin !== 'null') {
      return parsed.origin.toLowerCase();
    }
    return `${parsed.protocol}//${parsed.host || parsed.hostname}`.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Validates whether the given permission name is known.
 * @param {string} perm
 * @returns {boolean}
 */
function isValidPermission(perm) {
  return typeof perm === 'string' && PERMISSION_NAMES.includes(perm);
}

/**
 * Validates whether the given state is known.
 * @param {string} state
 * @returns {boolean}
 */
function isValidState(state) {
  return typeof state === 'string' && PERMISSION_STATES.includes(state);
}

module.exports = {
  PERMISSION_NAMES,
  PERMISSION_STATES,
  PERMISSION_METADATA,
  normalizeOrigin,
  isValidPermission,
  isValidState,
};
