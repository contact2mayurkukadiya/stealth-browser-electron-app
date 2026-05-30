import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './SettingsApp.css';
import { getAccentPresetsForUi, normalizeAccentHex } from '../theme/index.js';
import { useChromeTheme } from '../hooks/useChromeTheme';
import { useInvsurfDocumentFavicon } from '../hooks/useInvsurfLogoFavicon';
import { SETTINGS } from '../constants/conditionStrings.js';

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

const LOG_CLEAR_RANGES = [
  { label: 'Last 30 min', ms: 30 * 60 * 1000 },
  { label: 'Last hour', ms: 60 * 60 * 1000 },
  { label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: 'All time', ms: null },
];

const CHECK_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
  </svg>
);

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

function formatLogTimestamp(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ClearLogsModal({ onClear, onClose }) {
  const [selectedRangeMs, setSelectedRangeMs] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onClear(selectedRangeMs);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="clear-logs-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-logs-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="clear-logs-modal">
        <h2 id="clear-logs-title" className="clear-logs-title">Delete crash reports</h2>
        <div className="clear-logs-chips" role="group" aria-label="Time range">
          {LOG_CLEAR_RANGES.map((range) => {
            const selected = range.ms === selectedRangeMs;
            return (
              <button
                key={range.label}
                type="button"
                className={`clear-logs-chip${selected ? ' clear-logs-chip--selected' : ''}`}
                aria-pressed={selected}
                onClick={() => setSelectedRangeMs(range.ms)}
              >
                {selected && CHECK_ICON}
                {range.label}
              </button>
            );
          })}
        </div>
        <div className="clear-logs-items">
          <div className="clear-logs-item">
            <input type="checkbox" checked readOnly />
            <div>
              <div className="clear-logs-item__label">Encrypted crash and activity logs</div>
              <p className="clear-logs-item__desc">
                Deletes log files created within the selected time range.
              </p>
            </div>
          </div>
        </div>
        <div className="clear-logs-footer">
          <button type="button" className="diag-btn diag-btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="diag-btn clear-logs-delete" onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? 'Deleting…' : 'Delete logs'}
          </button>
        </div>
      </div>
    </div>
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

  const [identityReportText, setIdentityReportText] = useState('');
  const [identityLoading, setIdentityLoading] = useState(false);

  const refreshIdentityReport = useCallback(async () => {
    setIdentityLoading(true);
    try {
      const report = await window.electronAPI.identityDiagGetReport({});
      if (report == null) {
        setIdentityReportText(JSON.stringify({
          error: 'No browser window context was found for this settings page. Focus the main InviSurf window and try again.',
        }, null, 2));
      } else {
        setIdentityReportText(JSON.stringify(report, null, 2));
      }
    } catch (err) {
      setIdentityReportText(JSON.stringify({ error: String(err?.message || err) }, null, 2));
    } finally {
      setIdentityLoading(false);
    }
  }, []);

  const copyIdentityReport = useCallback(() => {
    window.electronAPI.clipboardWriteText(identityReportText);
  }, [identityReportText]);

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

  const [crashModalOpen, setCrashModalOpen] = useState(false);
  const [crashLogFiles, setCrashLogFiles] = useState([]);
  const [crashLogDirectory, setCrashLogDirectory] = useState('');
  const [crashLogLoading, setCrashLogLoading] = useState(false);
  const [selectedCrashLogPath, setSelectedCrashLogPath] = useState('');
  const [selectedCrashLogText, setSelectedCrashLogText] = useState('');
  const [selectedCrashLogLoading, setSelectedCrashLogLoading] = useState(false);
  const [crashLogError, setCrashLogError] = useState('');
  const [clearLogsOpen, setClearLogsOpen] = useState(false);
  const [fileMenuPath, setFileMenuPath] = useState('');

  const selectedCrashLog = useMemo(
    () => crashLogFiles.find((file) => file.path === selectedCrashLogPath) || null,
    [crashLogFiles, selectedCrashLogPath],
  );

  const refreshCrashLogs = useCallback(async () => {
    setCrashLogLoading(true);
    setCrashLogError('');
    try {
      const result = await window.electronAPI.appLogFiles();
      const files = Array.isArray(result?.files) ? result.files : [];
      setCrashLogFiles(files);
      setCrashLogDirectory(result?.directory || '');
      if (selectedCrashLogPath && !files.some((file) => file.path === selectedCrashLogPath)) {
        setSelectedCrashLogPath('');
        setSelectedCrashLogText('');
      }
    } catch (err) {
      setCrashLogError(String(err?.message || err));
    } finally {
      setCrashLogLoading(false);
    }
  }, [selectedCrashLogPath]);

  const openCrashLogsModal = useCallback(() => {
    setCrashModalOpen(true);
    refreshCrashLogs();
  }, [refreshCrashLogs]);

  const selectCrashLogFile = useCallback(async (file) => {
    if (!file?.path) return;
    setSelectedCrashLogPath(file.path);
    setSelectedCrashLogText('');
    setSelectedCrashLogLoading(true);
    setCrashLogError('');
    try {
      const result = await window.electronAPI.appLogRead(file.path);
      if (!result?.ok) throw new Error(result?.error || 'Failed to read log file');
      setSelectedCrashLogText(result.text || '');
    } catch (err) {
      setCrashLogError(String(err?.message || err));
    } finally {
      setSelectedCrashLogLoading(false);
    }
  }, []);

  const revealSelectedCrashLog = useCallback(async () => {
    if (!selectedCrashLogPath) return;
    await window.electronAPI.appLogReveal(selectedCrashLogPath);
  }, [selectedCrashLogPath]);

  const copySelectedCrashLog = useCallback(() => {
    if (!selectedCrashLogText) return;
    window.electronAPI.clipboardWriteText(selectedCrashLogText);
  }, [selectedCrashLogText]);

  const deleteCrashLogFile = useCallback(async (filePath) => {
    if (!filePath) return;
    setCrashLogError('');
    const result = await window.electronAPI.appLogDelete(filePath);
    if (!result?.ok) {
      setCrashLogError(result?.error || 'Failed to delete log file');
      return;
    }
    setFileMenuPath('');
    if (filePath === selectedCrashLogPath) {
      setSelectedCrashLogPath('');
      setSelectedCrashLogText('');
    }
    await refreshCrashLogs();
  }, [refreshCrashLogs, selectedCrashLogPath]);

  const clearCrashLogsByRange = useCallback(async (rangeMs) => {
    const since = rangeMs == null ? null : Date.now() - rangeMs;
    setCrashLogError('');
    const result = await window.electronAPI.appLogClear({ since });
    if (!result?.ok) {
      setCrashLogError(result?.error || 'Failed to clear log files');
      return;
    }
    setClearLogsOpen(false);
    setSelectedCrashLogPath('');
    setSelectedCrashLogText('');
    setFileMenuPath('');
    await refreshCrashLogs();
  }, [refreshCrashLogs]);

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
                      (seg.value === SETTINGS.COLOR_AUTOMATIC &&
                        settings.colorTheme !== SETTINGS.COLOR_DARK &&
                        settings.colorTheme !== SETTINGS.COLOR_LIGHT) ||
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
                    aria-checked={settings.accentTheme === SETTINGS.ACCENT_CUSTOM}
                    className={`accent-swatch accent-swatch--custom${settings.accentTheme === SETTINGS.ACCENT_CUSTOM ? ' accent-swatch--selected' : ''}`}
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
                      {settings.accentTheme === SETTINGS.ACCENT_CUSTOM ? (
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

        {/* ── Browser identity verification ───────────────────────────── */}
        <section className="settings-section">
          <h2 className="settings-section__title">Browser identity verification</h2>
          <div className="settings-card">
            <div className="setting-row">
              <div className="setting-row__text">
                <span className="setting-row__label">Local identity diagnostics</span>
                <span className="setting-row__desc">
                  Read-only report of InviSurf app paths, configured User-Agent, outbound Client
                  Hint headers, GPU state, debug guard status, and the active tab&apos;s observed
                  navigator values. Does not modify page runtime APIs or automate third-party
                  fingerprint sites.
                </span>
              </div>
            </div>
            <div className="diag-panel">
              <div className="diag-panel__actions">
                <button
                  type="button"
                  className="diag-btn"
                  onClick={refreshIdentityReport}
                  disabled={identityLoading}
                >
                  {identityLoading ? 'Refreshing…' : 'Refresh identity report'}
                </button>
              </div>
              <div className="diag-report-wrap">
                <button
                  type="button"
                  className="diag-copy-icon-btn"
                  onClick={copyIdentityReport}
                  aria-label="Copy identity diagnostics JSON"
                  title="Copy JSON"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="9" y="9" width="10" height="10" rx="2" ry="2" />
                    <rect x="5" y="5" width="10" height="10" rx="2" ry="2" />
                  </svg>
                </button>
                <pre className="diag-panel__pre" role="region" aria-label="Identity diagnostics JSON report">
                  {identityReportText || 'Click “Refresh identity report” to inspect the active tab and session.'}
                </pre>
              </div>
            </div>
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

        {/* ── Crash reports ─────────────────────────────────────────────── */}
        <section className="settings-section">
          <h2 className="settings-section__title">Crash reports</h2>
          <div className="settings-card">
            <div className="setting-row">
              <div className="setting-row__text">
                <span className="setting-row__label">Encrypted app logs</span>
                <span className="setting-row__desc">
                  View encrypted crash and activity logs stored on this machine. Previews are decrypted locally for debugging.
                </span>
              </div>
              <button
                type="button"
                className="diag-btn"
                onClick={openCrashLogsModal}
              >
                Crash reports
              </button>
            </div>
          </div>
        </section>
      </div>

      {crashModalOpen && (
        <div
          className="crash-log-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="crash-log-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCrashModalOpen(false);
          }}
        >
          <div className="crash-log-modal">
            <div className="crash-log-header">
              <div>
                <h2 id="crash-log-title" className="crash-log-title">Crash reports</h2>
                <p className="crash-log-subtitle">
                  {crashLogDirectory || 'Encrypted local logs'}
                </p>
              </div>
              <div className="crash-log-header-actions">
                <button
                  type="button"
                  className="diag-btn diag-btn--secondary"
                  onClick={refreshCrashLogs}
                  disabled={crashLogLoading}
                >
                  {crashLogLoading ? 'Refreshing…' : 'Refresh'}
                </button>
                <button
                  type="button"
                  className="diag-btn diag-btn--secondary"
                  onClick={() => setClearLogsOpen(true)}
                >
                  Clear logs
                </button>
                <button
                  type="button"
                  className="crash-log-close"
                  onClick={() => setCrashModalOpen(false)}
                  aria-label="Close crash reports"
                  title="Close"
                >
                  ×
                </button>
              </div>
            </div>

            {crashLogError && (
              <div className="crash-log-error" role="alert">{crashLogError}</div>
            )}

            <div className="crash-log-body">
              <aside className="crash-log-sidebar" aria-label="Log files">
                {crashLogLoading && crashLogFiles.length === 0 ? (
                  <div className="crash-log-empty-list">Loading logs…</div>
                ) : crashLogFiles.length === 0 ? (
                  <div className="crash-log-empty-list">No log files yet.</div>
                ) : (
                  crashLogFiles.map((file) => (
                    <div
                      key={file.path}
                      className={`crash-log-file-row${file.path === selectedCrashLogPath ? ' crash-log-file-row--active' : ''}`}
                    >
                      <button
                        type="button"
                        className="crash-log-file"
                        onClick={() => {
                          setFileMenuPath('');
                          selectCrashLogFile(file);
                        }}
                      >
                        <span className="crash-log-file__date">{formatLogTimestamp(file.modifiedAt)}</span>
                        <span className="crash-log-file__name">{file.name}</span>
                        <span className="crash-log-file__meta">{formatBytes(file.size)}</span>
                      </button>
                      <button
                        type="button"
                        className="crash-log-menu-btn"
                        aria-label={`Open actions for ${file.name}`}
                        title="More"
                        onClick={(event) => {
                          event.stopPropagation();
                          setFileMenuPath((current) => (current === file.path ? '' : file.path));
                        }}
                      >
                        ⋮
                      </button>
                      {fileMenuPath === file.path && (
                        <div className="crash-log-popover">
                          <button
                            type="button"
                            className="crash-log-popover__item crash-log-popover__item--danger"
                            onClick={() => deleteCrashLogFile(file.path)}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </aside>

              <section className="crash-log-preview">
                {!selectedCrashLogPath ? (
                  <div className="crash-log-placeholder">Choose file to view</div>
                ) : (
                  <>
                    <div className="crash-log-preview-header">
                      <div className="crash-log-preview-title">
                        <span>{selectedCrashLog?.name || 'Selected log'}</span>
                        <small>{selectedCrashLog ? formatLogTimestamp(selectedCrashLog.modifiedAt) : ''}</small>
                      </div>
                      <div className="crash-log-preview-actions">
                        <button
                          type="button"
                          className="diag-btn diag-btn--secondary"
                          onClick={revealSelectedCrashLog}
                        >
                          Show in folder
                        </button>
                        <button
                          type="button"
                          className="diag-copy-icon-btn crash-log-copy"
                          onClick={copySelectedCrashLog}
                          disabled={!selectedCrashLogText}
                          aria-label="Copy log preview"
                          title="Copy content"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="9" y="9" width="10" height="10" rx="2" ry="2" />
                            <rect x="5" y="5" width="10" height="10" rx="2" ry="2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <pre className="crash-log-pre" aria-label="Crash log preview">
                      {selectedCrashLogLoading ? 'Loading log preview…' : selectedCrashLogText}
                    </pre>
                  </>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {clearLogsOpen && (
        <ClearLogsModal
          onClear={clearCrashLogsByRange}
          onClose={() => setClearLogsOpen(false)}
        />
      )}
    </div>
  );
}
