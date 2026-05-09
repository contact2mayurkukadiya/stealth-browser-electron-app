/**
 * Chrome semantic tokens + accent presets + seed derivation.
 * CommonJS so Electron main can require() synchronously; Vite bundles this for renderer.
 */

'use strict';

// ── Color utilities ──────────────────────────────────────────────────────────

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function hexToRgb(hex) {
  const s = String(hex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  const h = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function rgbToHsl(r, g, b) {
  let rn = r / 255;
  let gn = g / 255;
  let bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb(h, s, l) {
  let hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;

  if (ss === 0) {
    const v = Math.round(ll * 255);
    return { r: v, g: v, b: v };
  }

  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const hk = hh / 360;

  const tR = hk + 1 / 3;
  const tG = hk;
  const tB = hk - 1 / 3;

  const hue2rgb = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  return {
    r: Math.round(hue2rgb(tR) * 255),
    g: Math.round(hue2rgb(tG) * 255),
    b: Math.round(hue2rgb(tB) * 255),
  };
}

function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const lin = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const r = lin(rgb.r);
  const g = lin(rgb.g);
  const b = lin(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fgHex, bgHex) {
  const L1 = relativeLuminance(fgHex);
  const L2 = relativeLuminance(bgHex);
  const light = Math.max(L1, L2);
  const dark = Math.min(L1, L2);
  return (light + 0.05) / (dark + 0.05);
}

function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  if (!A || !B) return a;
  const u = clamp(t, 0, 1);
  return rgbToHex(
    A.r + (B.r - A.r) * u,
    A.g + (B.g - A.g) * u,
    A.b + (B.b - A.b) * u,
  );
}

function hslHex(h, s, l) {
  const { r, g, b } = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

function pickAccentHintFromTokens(next) {
  const st = next['--chrome-shell-tint'];
  if (typeof st === 'string' && /^#[0-9a-fA-F]{6}$/.test(st.trim())) return st.trim();
  const uw = next['--chrome-url-well'];
  if (typeof uw === 'string' && /^#[0-9a-fA-F]{6}$/.test(uw.trim())) return uw.trim();
  return '#f1f3f4';
}

/** When preset sheet/nav are pure white, blend toward accent hint — parallels chroma in dark strips vs shell. */
const LIGHT_SHEET_TINT_MIX = 0.24;

function isPureWhiteHex(hex) {
  const raw = typeof hex === 'string' ? hex.trim().toLowerCase() : '';
  return raw === '#ffffff' || raw === '#fff';
}

function lightSheetHexFromPreset(next) {
  const hint = pickAccentHintFromTokens(next);
  const rawSlider = typeof next['--chrome-slider'] === 'string' ? next['--chrome-slider'].trim() : '';
  const rawNav = typeof next['--chrome-nav-bg'] === 'string' ? next['--chrome-nav-bg'].trim() : '';

  if (/^#[0-9a-fA-F]{6}$/.test(rawSlider) && !isPureWhiteHex(rawSlider)) {
    return rawSlider;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(rawNav) && !isPureWhiteHex(rawNav)) {
    return rawNav;
  }
  return mixHex('#ffffff', hint, LIGHT_SHEET_TINT_MIX);
}

const STEALTH = {
  '--chrome-slider-stealth': '#5c2020',
  '--chrome-nav-stealth': '#5c2020',
  '--chrome-url-well-stealth': '#5c2020',
};

function ensureFgOnBg(fgHex, bgHex, minRatio = 4) {
  let out = fgHex;
  for (let i = 0; i < 8; i += 1) {
    if (contrastRatio(out, bgHex) >= minRatio) return out;
    const towardLight = contrastRatio('#ffffff', bgHex) > contrastRatio('#171b20', bgHex);
    out = mixHex(out, towardLight ? '#ffffff' : '#171b20', 0.22);
  }
  return contrastRatio('#ffffff', bgHex) > contrastRatio('#171b20', bgHex) ? '#ffffff' : '#171b20';
}

function clampSat(s) {
  return Math.max(18, Math.min(75, s));
}

function deriveAccentPalettes(seedHex) {
  const rgb = hexToRgb(seedHex);
  if (!rgb) {
    return null;
  }
  const { h, s: sat0 } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const sAccent = clampSat(sat0);

  const dark = buildDarkBranch(h, sAccent);
  const light = buildLightBranch(h, sAccent);

  return { light, dark };
}

function buildDarkBranch(h, s) {
  const shell = hslHex(h, Math.min(s, 16), 17);
  const header = shell;
  const nav = hslHex(h, Math.min(s + 4, 22), 22);
  const slider = hslHex(h, Math.min(s + 2, 20), 25);
  const urlWell = hslHex(h, Math.min(s, 14), 15);
  const bookmark = hslHex(h, Math.min(s, 16), 19);
  const domain = ensureFgOnBg('#ffffff', urlWell, 3.2);
  const fg = 'rgba(255, 255, 255, 0.95)';
  const ghost = 'rgba(255, 255, 255, 0.4)';
  const tabSep = 'rgba(255, 255, 255, 0.12)';

  return {
    '--chrome-shell-bg': shell,
    '--chrome-body-bg': header,
    '--chrome-bg-snapshot': shell,
    '--chrome-header-bg': header,
    '--chrome-fg': fg,
    '--chrome-slider': slider,
    '--chrome-nav-bg': nav,
    '--chrome-url-well': urlWell,
    '--chrome-domain': domain,
    '--chrome-url-ghost': ghost,
    '--chrome-bookmark-bar': bookmark,
    '--chrome-bkm-text': 'rgba(255, 255, 255, 0.88)',
    '--chrome-tab-separator': tabSep,
    '--chrome-tab-hover-bg': 'rgba(255, 255, 255, 0.1)',
    '--chrome-close-hover': 'rgba(255, 255, 255, 0.1)',
    '--chrome-star-muted': 'rgba(255, 255, 255, 0.5)',
    ...STEALTH,
  };
}

function buildLightBranch(h, s) {
  const tint = hslHex(h, Math.min(s, 35), 94);
  const sheet = mixHex('#ffffff', tint, LIGHT_SHEET_TINT_MIX);
  const urlWell = mixHex('#ebecef', hslHex(h, Math.min(s, 45), 88), 0.35);
  const domain = ensureFgOnBg('#171b20', '#ffffff', 4);
  return {
    '--chrome-shell-bg': '#ffffff',
    '--chrome-body-bg': '#ffffff',
    '--chrome-bg-snapshot': '#ffffff',
    '--chrome-header-bg': '#ffffff',
    '--chrome-fg': '#171b20',
    '--chrome-slider': sheet,
    '--chrome-nav-bg': sheet,
    '--chrome-url-well': urlWell,
    '--chrome-domain': domain,
    '--chrome-url-ghost': 'rgba(23, 27, 32, 0.45)',
    '--chrome-bookmark-bar': sheet,
    '--chrome-bkm-text': 'rgba(23, 27, 32, 0.88)',
    '--chrome-tab-separator': 'rgba(0, 0, 0, 0.1)',
    '--chrome-tab-hover-bg': 'rgba(0, 0, 0, 0.045)',
    '--chrome-close-hover': 'rgba(0, 0, 0, 0.07)',
    '--chrome-star-muted': 'rgba(23, 27, 32, 0.42)',
    '--chrome-shell-tint': tint,
    ...STEALTH,
  };
}

// ── Presets (match legacy InvSurf “default”; extras are hue-shifted families) ─

const DEFAULT_DARK = {
  '--chrome-shell-bg': '#253035',
  '--chrome-body-bg': '#253035',
  '--chrome-bg-snapshot': '#253035',
  '--chrome-header-bg': '#253035',
  '--chrome-fg': 'rgba(255, 255, 255, 0.95)',
  '--chrome-slider': '#394d55',
  '--chrome-nav-bg': '#394d55',
  '--chrome-url-well': '#2f3c42',
  '--chrome-domain': '#ffffff',
  '--chrome-url-ghost': 'rgba(255, 255, 255, 0.4)',
  '--chrome-bookmark-bar': '#2d3e45',
  '--chrome-bkm-text': 'rgba(255, 255, 255, 0.85)',
  '--chrome-tab-separator': 'rgba(74, 97, 107, 0.62)',
  '--chrome-tab-hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--chrome-close-hover': 'rgba(255, 255, 255, 0.1)',
  '--chrome-star-muted': 'rgba(255, 255, 255, 0.5)',
  ...STEALTH,
};

const DEFAULT_LIGHT = {
  '--chrome-shell-bg': '#ffffff',
  '--chrome-shell-tint': '#f1f3f4',
  '--chrome-body-bg': '#ffffff',
  '--chrome-bg-snapshot': '#ffffff',
  '--chrome-header-bg': '#ffffff',
  '--chrome-fg': '#171b20',
  '--chrome-slider': '#ffffff',
  '--chrome-nav-bg': '#ffffff',
  '--chrome-url-well': '#ebecef',
  '--chrome-domain': '#171b20',
  '--chrome-url-ghost': 'rgba(23, 27, 32, 0.45)',
  '--chrome-bookmark-bar': '#ffffff',
  '--chrome-bkm-text': 'rgba(23, 27, 32, 0.88)',
  '--chrome-tab-separator': 'rgba(0, 0, 0, 0.1)',
  '--chrome-tab-hover-bg': 'rgba(0, 0, 0, 0.045)',
  '--chrome-close-hover': 'rgba(0, 0, 0, 0.07)',
  '--chrome-star-muted': 'rgba(23, 27, 32, 0.42)',
  ...STEALTH,
};

const SLATE_DARK = {
  '--chrome-shell-bg': '#262d34',
  '--chrome-body-bg': '#262d34',
  '--chrome-bg-snapshot': '#262d34',
  '--chrome-header-bg': '#262d34',
  '--chrome-fg': 'rgba(255, 255, 255, 0.95)',
  '--chrome-slider': '#3d4956',
  '--chrome-nav-bg': '#343e48',
  '--chrome-url-well': '#323b44',
  '--chrome-domain': '#ffffff',
  '--chrome-url-ghost': 'rgba(255, 255, 255, 0.4)',
  '--chrome-bookmark-bar': '#303942',
  '--chrome-bkm-text': 'rgba(255, 255, 255, 0.88)',
  '--chrome-tab-separator': 'rgba(120, 136, 150, 0.45)',
  '--chrome-tab-hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--chrome-close-hover': 'rgba(255, 255, 255, 0.1)',
  '--chrome-star-muted': 'rgba(255, 255, 255, 0.5)',
  ...STEALTH,
};

const SLATE_LIGHT = {
  '--chrome-shell-bg': '#ffffff',
  '--chrome-body-bg': '#ffffff',
  '--chrome-bg-snapshot': '#ffffff',
  '--chrome-header-bg': '#ffffff',
  '--chrome-fg': '#171b20',
  '--chrome-slider': '#f3f5f8',
  '--chrome-nav-bg': '#ffffff',
  '--chrome-url-well': '#e8ecf2',
  '--chrome-domain': '#171b20',
  '--chrome-url-ghost': 'rgba(23, 27, 32, 0.45)',
  '--chrome-bookmark-bar': '#ffffff',
  '--chrome-bkm-text': 'rgba(23, 27, 32, 0.88)',
  '--chrome-tab-separator': 'rgba(0, 0, 0, 0.1)',
  '--chrome-tab-hover-bg': 'rgba(0, 0, 0, 0.045)',
  '--chrome-close-hover': 'rgba(0, 0, 0, 0.07)',
  '--chrome-star-muted': 'rgba(23, 27, 32, 0.42)',
  '--chrome-shell-tint': '#eef2f7',
  ...STEALTH,
};

const OCEAN_DARK = {
  '--chrome-shell-bg': '#1a2f36',
  '--chrome-body-bg': '#1a2f36',
  '--chrome-bg-snapshot': '#1a2f36',
  '--chrome-header-bg': '#1a2f36',
  '--chrome-fg': 'rgba(255, 255, 255, 0.95)',
  '--chrome-slider': '#2e5865',
  '--chrome-nav-bg': '#244a56',
  '--chrome-url-well': '#223e48',
  '--chrome-domain': '#e8fbff',
  '--chrome-url-ghost': 'rgba(200, 245, 255, 0.45)',
  '--chrome-bookmark-bar': '#1f3f49',
  '--chrome-bkm-text': 'rgba(230, 252, 255, 0.88)',
  '--chrome-tab-separator': 'rgba(120, 200, 220, 0.35)',
  '--chrome-tab-hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--chrome-close-hover': 'rgba(255, 255, 255, 0.1)',
  '--chrome-star-muted': 'rgba(200, 240, 255, 0.5)',
  ...STEALTH,
};

const OCEAN_LIGHT = {
  '--chrome-shell-bg': '#ffffff',
  '--chrome-body-bg': '#ffffff',
  '--chrome-bg-snapshot': '#ffffff',
  '--chrome-header-bg': '#ffffff',
  '--chrome-fg': '#0d1f26',
  '--chrome-slider': '#e8f7fb',
  '--chrome-nav-bg': '#ffffff',
  '--chrome-url-well': '#dceef4',
  '--chrome-domain': '#0d1f26',
  '--chrome-url-ghost': 'rgba(13, 31, 38, 0.45)',
  '--chrome-bookmark-bar': '#ffffff',
  '--chrome-bkm-text': 'rgba(13, 31, 38, 0.88)',
  '--chrome-tab-separator': 'rgba(0, 0, 0, 0.1)',
  '--chrome-tab-hover-bg': 'rgba(0, 0, 0, 0.045)',
  '--chrome-close-hover': 'rgba(0, 0, 0, 0.07)',
  '--chrome-star-muted': 'rgba(13, 31, 38, 0.42)',
  '--chrome-shell-tint': '#e5f6fa',
  ...STEALTH,
};

const FOREST_DARK = {
  '--chrome-shell-bg': '#1e2e26',
  '--chrome-body-bg': '#1e2e26',
  '--chrome-bg-snapshot': '#1e2e26',
  '--chrome-header-bg': '#1e2e26',
  '--chrome-fg': 'rgba(255, 255, 255, 0.95)',
  '--chrome-slider': '#355240',
  '--chrome-nav-bg': '#2c4536',
  '--chrome-url-well': '#273d30',
  '--chrome-domain': '#f0fff4',
  '--chrome-url-ghost': 'rgba(210, 255, 220, 0.4)',
  '--chrome-bookmark-bar': '#253a2e',
  '--chrome-bkm-text': 'rgba(235, 255, 240, 0.88)',
  '--chrome-tab-separator': 'rgba(140, 200, 160, 0.35)',
  '--chrome-tab-hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--chrome-close-hover': 'rgba(255, 255, 255, 0.1)',
  '--chrome-star-muted': 'rgba(200, 255, 210, 0.5)',
  ...STEALTH,
};

const FOREST_LIGHT = {
  '--chrome-shell-bg': '#ffffff',
  '--chrome-body-bg': '#ffffff',
  '--chrome-bg-snapshot': '#ffffff',
  '--chrome-header-bg': '#ffffff',
  '--chrome-fg': '#142018',
  '--chrome-slider': '#eef7f0',
  '--chrome-nav-bg': '#ffffff',
  '--chrome-url-well': '#e2eee6',
  '--chrome-domain': '#142018',
  '--chrome-url-ghost': 'rgba(20, 32, 24, 0.45)',
  '--chrome-bookmark-bar': '#ffffff',
  '--chrome-bkm-text': 'rgba(20, 32, 24, 0.88)',
  '--chrome-tab-separator': 'rgba(0, 0, 0, 0.1)',
  '--chrome-tab-hover-bg': 'rgba(0, 0, 0, 0.045)',
  '--chrome-close-hover': 'rgba(0, 0, 0, 0.07)',
  '--chrome-star-muted': 'rgba(20, 32, 24, 0.42)',
  '--chrome-shell-tint': '#ecf7ef',
  ...STEALTH,
};

const SUNSET_DARK = {
  '--chrome-shell-bg': '#342428',
  '--chrome-body-bg': '#342428',
  '--chrome-bg-snapshot': '#342428',
  '--chrome-header-bg': '#342428',
  '--chrome-fg': 'rgba(255, 255, 255, 0.95)',
  '--chrome-slider': '#5c3e42',
  '--chrome-nav-bg': '#4a3439',
  '--chrome-url-well': '#402f34',
  '--chrome-domain': '#fff5f5',
  '--chrome-url-ghost': 'rgba(255, 220, 220, 0.45)',
  '--chrome-bookmark-bar': '#3a2b30',
  '--chrome-bkm-text': 'rgba(255, 235, 235, 0.88)',
  '--chrome-tab-separator': 'rgba(220, 160, 160, 0.35)',
  '--chrome-tab-hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--chrome-close-hover': 'rgba(255, 255, 255, 0.1)',
  '--chrome-star-muted': 'rgba(255, 200, 200, 0.5)',
  ...STEALTH,
};

const SUNSET_LIGHT = {
  '--chrome-shell-bg': '#ffffff',
  '--chrome-body-bg': '#ffffff',
  '--chrome-bg-snapshot': '#ffffff',
  '--chrome-header-bg': '#ffffff',
  '--chrome-fg': '#2a1818',
  '--chrome-slider': '#fff5f5',
  '--chrome-nav-bg': '#ffffff',
  '--chrome-url-well': '#f5e8ea',
  '--chrome-domain': '#2a1818',
  '--chrome-url-ghost': 'rgba(42, 24, 24, 0.45)',
  '--chrome-bookmark-bar': '#ffffff',
  '--chrome-bkm-text': 'rgba(42, 24, 24, 0.88)',
  '--chrome-tab-separator': 'rgba(0, 0, 0, 0.1)',
  '--chrome-tab-hover-bg': 'rgba(0, 0, 0, 0.045)',
  '--chrome-close-hover': 'rgba(0, 0, 0, 0.07)',
  '--chrome-star-muted': 'rgba(42, 24, 24, 0.42)',
  '--chrome-shell-tint': '#fff0f0',
  ...STEALTH,
};

const VIOLET_DARK = {
  '--chrome-shell-bg': '#2a2438',
  '--chrome-body-bg': '#2a2438',
  '--chrome-bg-snapshot': '#2a2438',
  '--chrome-header-bg': '#2a2438',
  '--chrome-fg': 'rgba(255, 255, 255, 0.95)',
  '--chrome-slider': '#453d5e',
  '--chrome-nav-bg': '#3a3352',
  '--chrome-url-well': '#342e48',
  '--chrome-domain': '#f5f0ff',
  '--chrome-url-ghost': 'rgba(230, 210, 255, 0.45)',
  '--chrome-bookmark-bar': '#312b44',
  '--chrome-bkm-text': 'rgba(245, 235, 255, 0.88)',
  '--chrome-tab-separator': 'rgba(180, 160, 220, 0.4)',
  '--chrome-tab-hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--chrome-close-hover': 'rgba(255, 255, 255, 0.1)',
  '--chrome-star-muted': 'rgba(220, 200, 255, 0.55)',
  ...STEALTH,
};

const VIOLET_LIGHT = {
  '--chrome-shell-bg': '#ffffff',
  '--chrome-body-bg': '#ffffff',
  '--chrome-bg-snapshot': '#ffffff',
  '--chrome-header-bg': '#ffffff',
  '--chrome-fg': '#1f1830',
  '--chrome-slider': '#f3efff',
  '--chrome-nav-bg': '#ffffff',
  '--chrome-url-well': '#ebe6f5',
  '--chrome-domain': '#1f1830',
  '--chrome-url-ghost': 'rgba(31, 24, 48, 0.45)',
  '--chrome-bookmark-bar': '#ffffff',
  '--chrome-bkm-text': 'rgba(31, 24, 48, 0.88)',
  '--chrome-tab-separator': 'rgba(0, 0, 0, 0.1)',
  '--chrome-tab-hover-bg': 'rgba(0, 0, 0, 0.045)',
  '--chrome-close-hover': 'rgba(0, 0, 0, 0.07)',
  '--chrome-star-muted': 'rgba(31, 24, 48, 0.42)',
  '--chrome-shell-tint': '#f4f0fc',
  ...STEALTH,
};

const ROSE_DARK = {
  '--chrome-shell-bg': '#2c2430',
  '--chrome-body-bg': '#2c2430',
  '--chrome-bg-snapshot': '#2c2430',
  '--chrome-header-bg': '#2c2430',
  '--chrome-fg': 'rgba(255, 255, 255, 0.95)',
  '--chrome-slider': '#4a3c52',
  '--chrome-nav-bg': '#403548',
  '--chrome-url-well': '#382f3e',
  '--chrome-domain': '#fff5fb',
  '--chrome-url-ghost': 'rgba(255, 210, 235, 0.45)',
  '--chrome-bookmark-bar': '#342b3c',
  '--chrome-bkm-text': 'rgba(255, 235, 248, 0.88)',
  '--chrome-tab-separator': 'rgba(220, 160, 200, 0.38)',
  '--chrome-tab-hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--chrome-close-hover': 'rgba(255, 255, 255, 0.1)',
  '--chrome-star-muted': 'rgba(255, 200, 230, 0.55)',
  ...STEALTH,
};

const ROSE_LIGHT = {
  '--chrome-shell-bg': '#ffffff',
  '--chrome-body-bg': '#ffffff',
  '--chrome-bg-snapshot': '#ffffff',
  '--chrome-header-bg': '#ffffff',
  '--chrome-fg': '#231820',
  '--chrome-slider': '#fdf5f9',
  '--chrome-nav-bg': '#ffffff',
  '--chrome-url-well': '#f5e8f0',
  '--chrome-domain': '#231820',
  '--chrome-url-ghost': 'rgba(35, 24, 32, 0.45)',
  '--chrome-bookmark-bar': '#ffffff',
  '--chrome-bkm-text': 'rgba(35, 24, 32, 0.88)',
  '--chrome-tab-separator': 'rgba(0, 0, 0, 0.1)',
  '--chrome-tab-hover-bg': 'rgba(0, 0, 0, 0.045)',
  '--chrome-close-hover': 'rgba(0, 0, 0, 0.07)',
  '--chrome-star-muted': 'rgba(35, 24, 32, 0.42)',
  '--chrome-shell-tint': '#fcf2f7',
  ...STEALTH,
};

const AMBER_DARK = {
  '--chrome-shell-bg': '#2c2818',
  '--chrome-body-bg': '#2c2818',
  '--chrome-bg-snapshot': '#2c2818',
  '--chrome-header-bg': '#2c2818',
  '--chrome-fg': 'rgba(255, 255, 255, 0.95)',
  '--chrome-slider': '#4a4328',
  '--chrome-nav-bg': '#3d3822',
  '--chrome-url-well': '#35301e',
  '--chrome-domain': '#fffaf0',
  '--chrome-url-ghost': 'rgba(255, 235, 200, 0.45)',
  '--chrome-bookmark-bar': '#322e1c',
  '--chrome-bkm-text': 'rgba(255, 248, 235, 0.88)',
  '--chrome-tab-separator': 'rgba(200, 180, 100, 0.4)',
  '--chrome-tab-hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--chrome-close-hover': 'rgba(255, 255, 255, 0.1)',
  '--chrome-star-muted': 'rgba(255, 230, 180, 0.55)',
  ...STEALTH,
};

const AMBER_LIGHT = {
  '--chrome-shell-bg': '#ffffff',
  '--chrome-body-bg': '#ffffff',
  '--chrome-bg-snapshot': '#ffffff',
  '--chrome-header-bg': '#ffffff',
  '--chrome-fg': '#221c10',
  '--chrome-slider': '#fff9f0',
  '--chrome-nav-bg': '#ffffff',
  '--chrome-url-well': '#f3ead8',
  '--chrome-domain': '#221c10',
  '--chrome-url-ghost': 'rgba(34, 28, 16, 0.45)',
  '--chrome-bookmark-bar': '#ffffff',
  '--chrome-bkm-text': 'rgba(34, 28, 16, 0.88)',
  '--chrome-tab-separator': 'rgba(0, 0, 0, 0.1)',
  '--chrome-tab-hover-bg': 'rgba(0, 0, 0, 0.045)',
  '--chrome-close-hover': 'rgba(0, 0, 0, 0.07)',
  '--chrome-star-muted': 'rgba(34, 28, 16, 0.42)',
  '--chrome-shell-tint': '#fff8ed',
  ...STEALTH,
};

const INDIGO_DARK = {
  '--chrome-shell-bg': '#1a1e32',
  '--chrome-body-bg': '#1a1e32',
  '--chrome-bg-snapshot': '#1a1e32',
  '--chrome-header-bg': '#1a1e32',
  '--chrome-fg': 'rgba(255, 255, 255, 0.95)',
  '--chrome-slider': '#2e3a5c',
  '--chrome-nav-bg': '#253148',
  '--chrome-url-well': '#1f2a40',
  '--chrome-domain': '#f0f4ff',
  '--chrome-url-ghost': 'rgba(200, 220, 255, 0.45)',
  '--chrome-bookmark-bar': '#1e2840',
  '--chrome-bkm-text': 'rgba(235, 240, 255, 0.88)',
  '--chrome-tab-separator': 'rgba(140, 160, 220, 0.4)',
  '--chrome-tab-hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--chrome-close-hover': 'rgba(255, 255, 255, 0.1)',
  '--chrome-star-muted': 'rgba(200, 210, 255, 0.55)',
  ...STEALTH,
};

const INDIGO_LIGHT = {
  '--chrome-shell-bg': '#ffffff',
  '--chrome-body-bg': '#ffffff',
  '--chrome-bg-snapshot': '#ffffff',
  '--chrome-header-bg': '#ffffff',
  '--chrome-fg': '#141a28',
  '--chrome-slider': '#f2f4fc',
  '--chrome-nav-bg': '#ffffff',
  '--chrome-url-well': '#e6e9f5',
  '--chrome-domain': '#141a28',
  '--chrome-url-ghost': 'rgba(20, 26, 40, 0.45)',
  '--chrome-bookmark-bar': '#ffffff',
  '--chrome-bkm-text': 'rgba(20, 26, 40, 0.88)',
  '--chrome-tab-separator': 'rgba(0, 0, 0, 0.1)',
  '--chrome-tab-hover-bg': 'rgba(0, 0, 0, 0.045)',
  '--chrome-close-hover': 'rgba(0, 0, 0, 0.07)',
  '--chrome-star-muted': 'rgba(20, 26, 40, 0.42)',
  '--chrome-shell-tint': '#f0f3fc',
  ...STEALTH,
};

const MINT_DARK = {
  '--chrome-shell-bg': '#182e2c',
  '--chrome-body-bg': '#182e2c',
  '--chrome-bg-snapshot': '#182e2c',
  '--chrome-header-bg': '#182e2c',
  '--chrome-fg': 'rgba(255, 255, 255, 0.95)',
  '--chrome-slider': '#2c504c',
  '--chrome-nav-bg': '#24423e',
  '--chrome-url-well': '#1f3a36',
  '--chrome-domain': '#f0fffc',
  '--chrome-url-ghost': 'rgba(180, 255, 240, 0.4)',
  '--chrome-bookmark-bar': '#1d3836',
  '--chrome-bkm-text': 'rgba(230, 255, 250, 0.88)',
  '--chrome-tab-separator': 'rgba(100, 200, 190, 0.38)',
  '--chrome-tab-hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--chrome-close-hover': 'rgba(255, 255, 255, 0.1)',
  '--chrome-star-muted': 'rgba(180, 240, 230, 0.55)',
  ...STEALTH,
};

const MINT_LIGHT = {
  '--chrome-shell-bg': '#ffffff',
  '--chrome-body-bg': '#ffffff',
  '--chrome-bg-snapshot': '#ffffff',
  '--chrome-header-bg': '#ffffff',
  '--chrome-fg': '#0d201e',
  '--chrome-slider': '#eef9f7',
  '--chrome-nav-bg': '#ffffff',
  '--chrome-url-well': '#d8f0ec',
  '--chrome-domain': '#0d201e',
  '--chrome-url-ghost': 'rgba(13, 32, 30, 0.45)',
  '--chrome-bookmark-bar': '#ffffff',
  '--chrome-bkm-text': 'rgba(13, 32, 30, 0.88)',
  '--chrome-tab-separator': 'rgba(0, 0, 0, 0.1)',
  '--chrome-tab-hover-bg': 'rgba(0, 0, 0, 0.045)',
  '--chrome-close-hover': 'rgba(0, 0, 0, 0.07)',
  '--chrome-star-muted': 'rgba(13, 32, 30, 0.42)',
  '--chrome-shell-tint': '#e8f7f4',
  ...STEALTH,
};

const ACCENT_PRESETS = [
  {
    id: 'default',
    label: 'InvSurf',
    light: DEFAULT_LIGHT,
    dark: DEFAULT_DARK,
  },
  {
    id: 'slate',
    label: 'Slate',
    light: SLATE_LIGHT,
    dark: SLATE_DARK,
  },
  {
    id: 'ocean',
    label: 'Ocean',
    light: OCEAN_LIGHT,
    dark: OCEAN_DARK,
  },
  {
    id: 'forest',
    label: 'Forest',
    light: FOREST_LIGHT,
    dark: FOREST_DARK,
  },
  {
    id: 'sunset',
    label: 'Sunset',
    light: SUNSET_LIGHT,
    dark: SUNSET_DARK,
  },
  {
    id: 'violet',
    label: 'Violet',
    light: VIOLET_LIGHT,
    dark: VIOLET_DARK,
  },
  {
    id: 'rose',
    label: 'Rose',
    light: ROSE_LIGHT,
    dark: ROSE_DARK,
  },
  {
    id: 'amber',
    label: 'Amber',
    light: AMBER_LIGHT,
    dark: AMBER_DARK,
  },
  {
    id: 'indigo',
    label: 'Indigo',
    light: INDIGO_LIGHT,
    dark: INDIGO_DARK,
  },
  {
    id: 'mint',
    label: 'Mint',
    light: MINT_LIGHT,
    dark: MINT_DARK,
  },
];

const ACCENT_IDS = new Set([
  'default',
  'slate',
  'ocean',
  'forest',
  'sunset',
  'violet',
  'rose',
  'amber',
  'indigo',
  'mint',
  'custom',
]);

function normalizeColorTheme(value) {
  if (value === 'automatic' || value === 'dark' || value === 'light') return value;
  return 'automatic';
}

function normalizeAccentTheme(value) {
  const v = typeof value === 'string' ? value : 'default';
  if (ACCENT_IDS.has(v)) return v;
  return 'default';
}

function normalizeAccentHex(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  const rgb = hexToRgb(s.startsWith('#') ? s : `#${s}`);
  return rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : null;
}

/** Merge loaded settings with defaults for accent fields. */
function normalizeAccentFields(settings) {
  const next = { ...settings };
  next.accentTheme = normalizeAccentTheme(next.accentTheme);
  if (next.accentTheme === 'custom') {
    next.accentCustomHex = normalizeAccentHex(next.accentCustomHex);
  } else {
    next.accentCustomHex = next.accentCustomHex != null ? normalizeAccentHex(next.accentCustomHex) : null;
  }
  return next;
}

function getPresetPair(accentId) {
  const id = accentId === 'custom' ? 'default' : normalizeAccentTheme(accentId);
  const found = ACCENT_PRESETS.find((p) => p.id === id);
  return found || ACCENT_PRESETS[0];
}

/**
 * Light: tinted “frame” behind tabs + omnibox row (Chrome uses one continuous band).
 * Dark: gutter darker than nav strip.
 */
function tabStripGutterFromNav(navHex, effectiveDark, accentHintHex) {
  if (!navHex || !/^#[0-9a-fA-F]{6}$/.test(navHex.trim())) return navHex;
  const h = navHex.trim();
  if (effectiveDark) {
    return mixHex(h, '#000000', 0.28);
  }
  const base = mixHex(h, '#1f1f1f', 0.14);
  const hint =
    typeof accentHintHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(accentHintHex.trim())
      ? accentHintHex.trim()
      : null;
  if (hint && relativeLuminance(h) > 0.88) {
    let g = mixHex(base, hint, 0.44);
    g = mixHex(g, '#000000', 0.078);
    return mixHex(g, hint, 0.1);
  }
  return mixHex(base, '#000000', 0.055);
}

/**
 * Light chrome layering:
 * - Tab bar (--chrome-header-bg): tinted frame behind inactive tabs (gutter).
 * - Active tab + omnibox row (--chrome-slider / --chrome-nav-bg): same tinted “sheet” as presets
 *   (not forced to #fff); uses preset slider/nav when set, else white mixed with accent hint.
 * - Omnibox field (--chrome-url-well): between sheet and tab-bar frame (same blend weight as before).
 */
function applyLightChromeSliderNavWellLayering(next, tabBarFrameHex) {
  const sheet = lightSheetHexFromPreset(next);

  next['--chrome-header-bg'] = tabBarFrameHex;
  next['--chrome-slider'] = sheet;
  next['--chrome-nav-bg'] = sheet;

  next['--chrome-url-well'] = mixHex(sheet, tabBarFrameHex, 0.46);

  next['--chrome-bookmark-bar'] = sheet;
}

/** Settings / internal pages: strict canvas + scrollbar thumb/track with guaranteed separation. */
function contentLayerTokens(effectiveDark) {
  if (effectiveDark) {
    return {
      '--chrome-content-bg': '#121212',
      '--chrome-content-surface': '#1e1e1e',
      '--chrome-scrollbar-track': '#1a1a1a',
      '--chrome-scrollbar-thumb': '#6b6b6b',
      '--chrome-scrollbar-thumb-hover': '#8a8a8a',
    };
  }
  return {
    '--chrome-content-bg': '#ffffff',
    '--chrome-content-surface': '#ffffff',
    '--chrome-scrollbar-track': '#e8eaed',
    '--chrome-scrollbar-thumb': '#9aa0a6',
    '--chrome-scrollbar-thumb-hover': '#80868b',
  };
}

/**
 * Toolbar icons follow **nav strip luminance** only: pale strips → graphite + no invert;
 * saturated strips → pale glyphs + invert. Matches Chrome-like layered chrome regardless of
 * edge cases in `effectiveDark`.
 */
function toolbarIconTokensFromAppearance(navHex, effectiveDark) {
  const raw = typeof navHex === 'string' ? navHex.trim() : '';
  const hex = /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : effectiveDark ? '#394d55' : '#ffffff';
  const navIsLightStrip = relativeLuminance(hex) > 0.55;

  if (!navIsLightStrip) {
    const icon = mixHex('#eef1f4', hex, 0.22);
    const mutedBase = mixHex('#a8adb5', hex, 0.32);
    const m = hexToRgb(mutedBase);
    return {
      '--chrome-toolbar-icon': icon,
      '--chrome-toolbar-icon-muted': m ? `rgba(${m.r}, ${m.g}, ${m.b}, 0.9)` : 'rgba(255, 255, 255, 0.58)',
      '--chrome-toolbar-img-filter': 'brightness(0) invert(1)',
    };
  }

  const icon = mixHex('#181b1f', hex, 0.26);
  const mutedBase = mixHex('#5f6368', hex, 0.24);
  const m = hexToRgb(mutedBase);
  return {
    '--chrome-toolbar-icon': icon,
    '--chrome-toolbar-icon-muted': m ? `rgba(${m.r}, ${m.g}, ${m.b}, 0.88)` : 'rgba(60, 64, 67, 0.72)',
    /* Toolbar PNG/SVG-as-img assets use fill=white; without a filter they stay white on pale strips. */
    '--chrome-toolbar-img-filter': 'brightness(0)',
  };
}

/** Focus ring darker than url-well on light UI; lighter shade on dark UI */
function omniboxFocusTokens(urlWellHex, effectiveDark) {
  const raw = typeof urlWellHex === 'string' ? urlWellHex.trim() : '';
  const well = /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : effectiveDark ? '#2f3c42' : '#ebecef';

  if (effectiveDark) {
    const border = mixHex(well, '#ffffff', 0.52);
    const selBg = mixHex(well, '#ffffff', 0.28);
    return {
      '--chrome-omnibox-focus-border': border,
      '--chrome-omnibox-selection-bg': selBg,
      '--chrome-omnibox-selection-fg': '#0d0d0d',
    };
  }

  const border = mixHex(well, '#0a0a0a', 0.42);
  const selBg = mixHex(well, '#1a73e8', 0.32);
  return {
    '--chrome-omnibox-focus-border': border,
    '--chrome-omnibox-selection-bg': selBg,
    '--chrome-omnibox-selection-fg': '#202124',
  };
}

/**
 * Toolbar icons follow strip luminance + appearance (see toolbarIconTokensFromAppearance).
 */
function enrichUnifiedToolbarTokens(tokens, effectiveDark) {
  const next = { ...tokens };
  Object.assign(next, contentLayerTokens(effectiveDark));

  const navBg = next['--chrome-nav-bg'];
  const accentHint =
    (typeof next['--chrome-shell-tint'] === 'string' &&
      /^#[0-9a-fA-F]{6}$/.test(String(next['--chrome-shell-tint']).trim()) &&
      String(next['--chrome-shell-tint']).trim()) ||
    (typeof next['--chrome-url-well'] === 'string' &&
      /^#[0-9a-fA-F]{6}$/.test(String(next['--chrome-url-well']).trim()) &&
      String(next['--chrome-url-well']).trim()) ||
    null;
  if (typeof navBg === 'string') {
    const gutter =
      typeof navBg === 'string' && /^#[0-9a-fA-F]{6}$/.test(navBg.trim())
        ? tabStripGutterFromNav(navBg, effectiveDark, accentHint)
        : navBg;
    next['--chrome-header-bg'] = gutter;

    if (effectiveDark) {
      next['--chrome-slider'] = navBg;
    } else {
      applyLightChromeSliderNavWellLayering(next, gutter);
    }
  }

  const navForToolbarIcons = next['--chrome-nav-bg'];
  Object.assign(next, toolbarIconTokensFromAppearance(navForToolbarIcons, effectiveDark));

  const well = next['--chrome-url-well'];
  Object.assign(next, omniboxFocusTokens(well, effectiveDark));

  return next;
}

function resolveAppliedTokens(settings, effectiveDark) {
  const accent = normalizeAccentTheme(settings.accentTheme);
  const branch = effectiveDark ? 'dark' : 'light';

  if (accent === 'custom') {
    const hex = normalizeAccentHex(settings.accentCustomHex);
    const derived = hex ? deriveAccentPalettes(hex) : null;
    const maps = derived || { light: DEFAULT_LIGHT, dark: DEFAULT_DARK };
    return enrichUnifiedToolbarTokens({ ...maps[branch] }, effectiveDark);
  }

  const preset = getPresetPair(accent);
  return enrichUnifiedToolbarTokens({ ...(branch === 'dark' ? preset.dark : preset.light) }, effectiveDark);
}

function resolveEffectiveDarkFromSettings(settings, prefersDark) {
  const ct = normalizeColorTheme(settings.colorTheme);
  if (ct === 'dark') return true;
  if (ct === 'light') return false;
  return !!prefersDark;
}

/** Solid hex for title bar overlay: pick readable symbol on header background. */
function pickTitleBarSymbolColor(bgHex) {
  const bg = typeof bgHex === 'string' && bgHex.startsWith('#') && bgHex.length === 7 ? bgHex : '#1a1a1a';
  const w = contrastRatio('#ffffff', bg);
  const d = contrastRatio('#202124', bg);
  return w >= d ? '#ffffff' : '#202124';
}

function getTitleBarOverlayFromSettings(settings, shouldUseDarkColors) {
  const effectiveDark = resolveEffectiveDarkFromSettings(settings, shouldUseDarkColors);
  const tokens = resolveAppliedTokens(settings, effectiveDark);
  const bg =
    tokens['--chrome-header-bg'] ||
    tokens['--chrome-shell-bg'] ||
    (effectiveDark ? '#1a1a1a' : '#ffffff');
  const symbolColor = pickTitleBarSymbolColor(bg);
  return { color: bg, symbolColor, height: 45 };
}

function applyChromeTokensToRoot(doc, tokens) {
  const root = doc.documentElement;
  Object.entries(tokens).forEach(([key, val]) => {
    if (val === undefined || val === null || val === '') return;
    root.style.setProperty(key, String(val));
  });
}

function setForcedAppearanceAttr(doc, settings) {
  const ct = normalizeColorTheme(settings.colorTheme);
  const root = doc.documentElement;
  if (ct === 'light') root.setAttribute('data-forced-appearance', 'light');
  else if (ct === 'dark') root.setAttribute('data-forced-appearance', 'dark');
  else root.removeAttribute('data-forced-appearance');
}

/** Settings-only swatch colours: use each preset’s dark branch so circles read as hue, not near-white. */
function getAccentPresetsForUi() {
  return ACCENT_PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    preview: {
      shell: p.dark['--chrome-shell-bg'],
      slider: p.dark['--chrome-slider'],
      urlWell: p.dark['--chrome-url-well'],
    },
  }));
}

module.exports = {
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
};
