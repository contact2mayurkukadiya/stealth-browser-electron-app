import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './SettingsApp.css';
import { getAccentPresetsForUi, normalizeAccentHex } from '../theme/index.js';
import { useChromeTheme } from '../hooks/useChromeTheme';
import { useInvsurfDocumentFavicon } from '../hooks/useInvsurfLogoFavicon';

const STARTUP_OPTIONS = [
  {
    value: 'fresh',
    label: 'Fresh start',
    description: 'Start with a single new tab. Tabs from the previous session are not restored.',
  },
  {
    value: 'continue',
    label: 'Continue where you left off',
    description: 'Restore all open tabs from your last session on next launch.',
  },
  {
    value: 'clearHistory',
    label: 'Clear everything on startup',
    description: 'Clear browsing history and start with a single new tab on next launch.',
  },
];

const SEARCH_ENGINE_OPTIONS = [
  {
    value: 'google',
    label: 'Google',
    description: 'Search with Google (google.com).',
  },
  {
    value: 'bing',
    label: 'Bing',
    description: 'Search with Microsoft Bing (bing.com).',
  },
  {
    value: 'brave',
    label: 'Brave Search',
    description: 'Search with Brave Search — independent index, no tracking (search.brave.com).',
  },
  {
    value: 'duckDuckGo',
    label: 'DuckDuckGo',
    description: 'Search with DuckDuckGo — privacy-first search (duckduckgo.com).',
  },
];

const APPEARANCE_MODE_SEGMENTS = [
  { value: 'light', label: 'Light', title: 'Always use light appearance' },
  { value: 'dark', label: 'Dark', title: 'Always use dark appearance' },
  { value: 'automatic', label: 'Device', title: 'Match your system light or dark mode' },
];

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle-switch${checked ? ' toggle-switch--on' : ''}`}
      onClick={() => onChange(!checked)}
      aria-label="Toggle setting"
    />
  );
}

function RadioRow({ option, checked, onChange, groupName = 'radio-group' }) {
  return (
    <label className={`radio-row${checked ? ' radio-row--checked' : ''}`}>
      <input
        type="radio"
        name={groupName}
        value={option.value}
        checked={checked}
        onChange={() => onChange(option.value)}
        className="radio-input"
      />
      <div className="radio-row__text">
        <span className="radio-row__label">{option.label}</span>
        <span className="radio-row__desc">{option.description}</span>
      </div>
    </label>
  );
}

export default function SettingsApp() {
  useChromeTheme();
  const [settings, setSettings] = useState(null);
  /** Resolved together with settings so Appearance / On Startup can be omitted without flashing in stealth. */
  const [contextReady, setContextReady] = useState(false);
  const [isStealthWindow, setIsStealthWindow] = useState(false);
  // Track whether contentProtection was changed since load (to show relaunch hint)
  const [pendingRelaunch, setPendingRelaunch] = useState(false);

  useInvsurfDocumentFavicon(isStealthWindow);

  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI;
    Promise.all([
      api?.settingsGet?.() ?? Promise.resolve(null),
      typeof api?.isStealthWindow === 'function' ? api.isStealthWindow() : Promise.resolve(false),
    ]).then(([s, stealth]) => {
      if (cancelled) return;
      setSettings(s);
      setIsStealthWindow(!!stealth);
      setContextReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isStealthWindow) return undefined;
    const root = document.documentElement;
    root.style.setProperty('--chrome-content-bg', '#253035');
    root.style.setProperty('--chrome-content-surface', '#2f3c42');
    root.style.setProperty('--chrome-scrollbar-track', '#1e2a30');
    root.style.setProperty('--chrome-scrollbar-thumb', '#6b7780');
    root.style.setProperty('--chrome-scrollbar-thumb-hover', '#8a9399');
    document.body.classList.add('settings-stealth-ui');
    return () => {
      root.style.removeProperty('--chrome-content-bg');
      root.style.removeProperty('--chrome-content-surface');
      root.style.removeProperty('--chrome-scrollbar-track');
      root.style.removeProperty('--chrome-scrollbar-thumb');
      root.style.removeProperty('--chrome-scrollbar-thumb-hover');
      document.body.classList.remove('settings-stealth-ui');
    };
  }, [isStealthWindow]);

  const persist = useCallback(async (updated) => {
    setSettings(updated);
    await window.electronAPI.settingsSave(updated);
  }, []);

  const handleContentProtectionChange = useCallback(async (value) => {
    await persist({ ...settings, contentProtection: value });
    setPendingRelaunch(true);
  }, [settings, persist]);

  const handleStartupChange = useCallback(async (value) => {
    await persist({ ...settings, startupBehavior: value });
  }, [settings, persist]);

  const handleSearchEngineChange = useCallback(async (value) => {
    await persist({ ...settings, searchEngine: value });
  }, [settings, persist]);

  const handleColorThemeChange = useCallback(async (value) => {
    await persist({ ...settings, colorTheme: value });
  }, [settings, persist]);

  const accentPresets = useMemo(() => getAccentPresetsForUi(), []);

  const customColorValue = useMemo(() => {
    const raw = settings?.accentCustomHex;
    const n = raw ? normalizeAccentHex(raw) : null;
    return n || '#1a73e8';
  }, [settings?.accentCustomHex]);

  const handleAccentPreset = useCallback(
    async (accentTheme) => {
      await persist({ ...settings, accentTheme });
    },
    [settings, persist],
  );

  const handleCustomAccentHex = useCallback(async (hexInput) => {
    const normalized = normalizeAccentHex(hexInput);
    if (!normalized) return;
    await persist({ ...settings, accentTheme: 'custom', accentCustomHex: normalized });
  }, [settings, persist]);

  const handleRelaunch = useCallback(() => {
    window.electronAPI.appRelaunch();
  }, []);

  const [diagReportText, setDiagReportText] = useState('');
  const [diagLoading, setDiagLoading] = useState(false);

  const refreshDiagReport = useCallback(async () => {
    setDiagLoading(true);
    try {
      const report = await window.electronAPI.compatDiagGetReport({});
      setDiagReportText(JSON.stringify(report, null, 2));
    } catch (err) {
      setDiagReportText(JSON.stringify({ error: String(err?.message || err) }, null, 2));
    } finally {
      setDiagLoading(false);
    }
  }, []);

  const copyDiagReport = useCallback(() => {
    window.electronAPI.clipboardWriteText(diagReportText);
  }, [diagReportText]);

  const handleCompatibilityDiagnosticsChange = useCallback(async (value) => {
    await persist({ ...settings, compatibilityDiagnosticsEnabled: value });
    if (value) refreshDiagReport();
  }, [settings, persist, refreshDiagReport]);

  if (!contextReady || !settings) {
    return <div className="settings-loading">Loading…</div>;
  }

  return (
    <div className={`settings-page${isStealthWindow ? ' settings-page--stealth' : ''}`}>
      <header className="settings-header">
        <h1 className="settings-header__title">Settings</h1>
      </header>

      <div className="settings-content">
        {/* ── Appearance (hidden in stealth — chrome is fixed InvSurf dark) ─ */}
        {!isStealthWindow && (
          <section className="settings-section">
            <h2 className="settings-section__title">Appearance</h2>
            <div className="settings-card settings-card--appearance">
              <div className="appearance-block">
                <div className="appearance-block__intro">
                  <span className="setting-row__label">Brightness</span>
                  <span className="setting-row__desc">
                    Device follows your system. Light or Dark applies only to InviSurf.
                  </span>
                </div>
                <div
                  className="appearance-mode"
                  role="radiogroup"
                  aria-label="Brightness"
                >
                  {APPEARANCE_MODE_SEGMENTS.map((seg) => {
                    const active =
                      (seg.value === 'automatic' &&
                        settings.colorTheme !== 'dark' &&
                        settings.colorTheme !== 'light') ||
                      settings.colorTheme === seg.value;
                    return (
                      <button
                        key={seg.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        title={seg.title}
                        className={`appearance-mode__btn${active ? ' appearance-mode__btn--active' : ''}`}
                        onClick={() => handleColorThemeChange(seg.value)}
                      >
                        {seg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="appearance-block appearance-block--accent">
                <div className="appearance-block__intro">
                  <span className="setting-row__label">Accent</span>
                  <span className="setting-row__desc">
                    Colours the tab strip and toolbar. Custom builds a palette from one seed colour.
                  </span>
                </div>
                <div className="accent-grid" role="radiogroup" aria-label="Accent colour preset">
                  {accentPresets.map((p) => {
                    const selected = settings.accentTheme === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-pressed={selected}
                        className={`accent-swatch${selected ? ' accent-swatch--selected' : ''}`}
                        onClick={() => handleAccentPreset(p.id)}
                        title={p.label}
                      >
                        <span
                          className="accent-swatch__preview"
                          style={{
                            background: `linear-gradient(135deg, ${p.preview.shell} 0%, ${p.preview.slider} 45%, ${p.preview.urlWell} 100%)`,
                          }}
                          aria-hidden
                        />
                        <span className="accent-swatch__label">{p.label}</span>
                        {selected ? (
                          <span className="accent-swatch__check" aria-hidden>
                            ✓
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                  <div
                    role="radio"
                    aria-checked={settings.accentTheme === 'custom'}
                    className={`accent-swatch accent-swatch--custom${settings.accentTheme === 'custom' ? ' accent-swatch--selected' : ''}`}
                    title="Custom — pick a seed colour"
                  >
                    <input
                      id="settings-accent-custom"
                      type="color"
                      className="accent-swatch__color-input"
                      value={customColorValue}
                      onChange={(e) => handleCustomAccentHex(e.target.value)}
                      aria-label="Custom accent colour"
                    />
                    <label htmlFor="settings-accent-custom" className="accent-swatch__custom-hit">
                      <span
                        className="accent-swatch__preview accent-swatch__preview--custom"
                        style={{
                          background: `linear-gradient(135deg, ${customColorValue} 0%, ${customColorValue} 45%, ${customColorValue} 100%)`,
                        }}
                        aria-hidden
                      />
                      <span className="accent-swatch__label">Custom</span>
                      {settings.accentTheme === 'custom' ? (
                        <span className="accent-swatch__check" aria-hidden>
                          ✓
                        </span>
                      ) : null}
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Privacy ──────────────────────────────────────────────────── */}
        <section className="settings-section">
          <h2 className="settings-section__title">Privacy</h2>
          <div className="settings-card">
            <div className="setting-row">
              <div className="setting-row__text">
                <span className="setting-row__label">Enable DRM (Digital rights Management)</span>
                <span className="setting-row__desc">
                  Prevents screenshots and screen recording of this browser window.
                  A relaunch is required for changes to take effect.
                </span>
              </div>
              <Toggle
                checked={settings.contentProtection}
                onChange={handleContentProtectionChange}
              />
            </div>

            {pendingRelaunch && (
              <div className="relaunch-banner">
                <span className="relaunch-banner__text">
                  Restart required to apply this change.
                </span>
                <button className="relaunch-btn" onClick={handleRelaunch}>
                  Relaunch
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── On Startup (hidden in stealth — session restore does not apply) ─ */}
        {!isStealthWindow && (
          <section className="settings-section">
            <h2 className="settings-section__title">On Startup</h2>
            <div className="settings-card">
              {STARTUP_OPTIONS.map((opt) => (
                <RadioRow
                  key={opt.value}
                  option={opt}
                  checked={settings.startupBehavior === opt.value}
                  onChange={handleStartupChange}
                  groupName="startupBehavior"
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Search Engine ────────────────────────────────────────────── */}
        <section className="settings-section">
          <h2 className="settings-section__title">Search Engine</h2>
          <div className="settings-card">
            {SEARCH_ENGINE_OPTIONS.map((opt) => (
              <RadioRow
                key={opt.value}
                option={opt}
                checked={(settings.searchEngine || 'google') === opt.value}
                onChange={handleSearchEngineChange}
                groupName="searchEngine"
              />
            ))}
          </div>
        </section>

        {/* ── Compatibility diagnostics ───────────────────────────────── */}
        <section className="settings-section">
          <h2 className="settings-section__title">Compatibility diagnostics</h2>
          <div className="settings-card">
            <div className="setting-row">
              <div className="setting-row__text">
                <span className="setting-row__label">Collect navigation diagnostics</span>
                <span className="setting-row__desc">
                  When enabled, the app records main-frame navigations, load failures, redirect
                  guard actions, and selected response headers (for example CSP) in memory only.
                  Use this to troubleshoot sites that fail to load — not for evading protections.
                </span>
              </div>
              <Toggle
                checked={!!settings.compatibilityDiagnosticsEnabled}
                onChange={handleCompatibilityDiagnosticsChange}
              />
            </div>

            {settings.compatibilityDiagnosticsEnabled && (
              <div className="diag-panel">
                <div className="diag-panel__actions">
                  <button
                    type="button"
                    className="diag-btn"
                    onClick={refreshDiagReport}
                    disabled={diagLoading}
                  >
                    {diagLoading ? 'Refreshing…' : 'Refresh report'}
                  </button>
                  <button
                    type="button"
                    className="diag-btn diag-btn--secondary"
                    onClick={() => window.electronAPI.compatDiagClear({}).then(refreshDiagReport)}
                  >
                    Clear log
                  </button>
                </div>
                <div className="diag-report-wrap">
                  <button
                    type="button"
                    className="diag-copy-icon-btn"
                    onClick={copyDiagReport}
                    aria-label="Copy diagnostics JSON"
                    title="Copy JSON"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="9" y="9" width="10" height="10" rx="2" ry="2" />
                      <rect x="5" y="5" width="10" height="10" rx="2" ry="2" />
                    </svg>
                  </button>
                  <pre className="diag-panel__pre" role="region" aria-label="Diagnostics JSON report">
                    {diagReportText || 'Click “Refresh report” to load the in-memory log.'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
