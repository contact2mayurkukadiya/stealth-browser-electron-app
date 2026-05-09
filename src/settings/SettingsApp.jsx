import React, { useState, useEffect, useCallback } from 'react';
import './SettingsApp.css';

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
  const [settings, setSettings] = useState(null);
  // Track whether contentProtection was changed since load (to show relaunch hint)
  const [pendingRelaunch, setPendingRelaunch] = useState(false);

  useEffect(() => {
    window.electronAPI.settingsGet().then((s) => setSettings(s));
  }, []);

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

  if (!settings) {
    return <div className="settings-loading">Loading…</div>;
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1 className="settings-header__title">Settings</h1>
      </header>

      <div className="settings-content">
        {/* ── Privacy ──────────────────────────────────────────────────── */}
        <section className="settings-section">
          <h2 className="settings-section__title">Privacy</h2>
          <div className="settings-card">
            <div className="setting-row">
              <div className="setting-row__text">
                <span className="setting-row__label">Screen Capture Protection</span>
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

        {/* ── On Startup ───────────────────────────────────────────────── */}
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
