import theme from './chromeTheme.cjs';

export default theme;

export const {
  ACCENT_PRESETS,
  ACCENT_IDS,
  normalizeColorTheme,
  normalizeAccentTheme,
  normalizeAccentHex,
  normalizeAccentFields,
  deriveAccentPalettes,
  resolveAppliedTokens,
  resolveEffectiveDarkFromSettings,
  getTitleBarOverlayFromSettings,
  applyChromeTokensToRoot,
  setForcedAppearanceAttr,
  getAccentPresetsForUi,
  hexToRgb,
  rgbToHex,
} = theme;
