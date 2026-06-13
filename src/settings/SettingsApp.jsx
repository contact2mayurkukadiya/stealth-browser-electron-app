import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './SettingsApp.css';
import { getAccentPresetsForUi, normalizeAccentHex } from '../theme/index.js';
import { useChromeTheme } from '../hooks/useChromeTheme';
import { useInvsurfDocumentFavicon } from '../hooks/useInvsurfLogoFavicon';
import { SETTINGS } from '../constants/conditionStrings.js';
import { HighlightedText, textMatchesQuery } from '../utils/textHighlighter.jsx';

const SETTINGS_ICON_BASE = 'app://localhost/assets/images';
const SETTINGS_NAV_ICONS = {
  privacy: `${SETTINGS_ICON_BASE}/shield.svg`,
  appearance: `${SETTINGS_ICON_BASE}/palette.svg`,
  search_engine: `${SETTINGS_ICON_BASE}/globe.svg`,
  on_startup: `${SETTINGS_ICON_BASE}/power.svg`,
  reports: `${SETTINGS_ICON_BASE}/bug-report.svg`,
  angle_left: `${SETTINGS_ICON_BASE}/angle-left.svg`,
  angle_right: `${SETTINGS_ICON_BASE}/angle-right.svg`,
  cookie: `${SETTINGS_ICON_BASE}/cookie.svg`,
  earth: `${SETTINGS_ICON_BASE}/earth-americas.svg`,
  trash: `${SETTINGS_ICON_BASE}/trash.svg`,
  search: `${SETTINGS_ICON_BASE}/search.svg`,
  cross: `${SETTINGS_ICON_BASE}/cross-small.svg`,
};

const SETTINGS_NAV_ITEMS = [
  {
    id: 'privacy/main',
    section: 'privacy',
    label: 'Privacy and security',
    icon: SETTINGS_NAV_ICONS.privacy,
  },
  {
    id: 'appearance',
    section: 'appearance',
    label: 'Appearance',
    icon: SETTINGS_NAV_ICONS.appearance,
  },
  {
    id: 'search_engine',
    section: 'search_engine',
    label: 'Search engine',
    icon: SETTINGS_NAV_ICONS.search_engine,
  },
  {
    id: 'default_browser',
    section: 'default_browser',
    label: 'Default browser',
    icon: null,
  },
  {
    id: 'on_startup',
    section: 'on_startup',
    label: 'On startup',
    icon: SETTINGS_NAV_ICONS.on_startup,
  },
];

const REPORT_NAV_ITEMS = [
  { id: 'browser_identity', section: 'browser_identity', label: 'Browser identity verification' },
  { id: 'compatibility', section: 'compatibility', label: 'Compatibility diagnostics' },
  { id: 'crash_reports', section: 'crash_reports', label: 'Crash reports' },
];

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

const COOKIE_POLICY_OPTIONS = [
  {
    value: 'allow',
    label: 'Allow all cookies',
    description: 'Sites can use cookies to improve your browsing experience',
  },
  {
    value: 'block_third_party',
    label: 'Block third-party cookies',
    description: 'Sites cannot use cookies to see your activity across other sites',
  },
  {
    value: 'block_all',
    label: 'Block all cookies (Not recommended)',
    description: 'Prevents sites from using cookies. Many features like signing in might break.',
  },
];

const COOKIE_EXCEPTION_GROUPS = [
  {
    setting: 'allow',
    title: 'Sites that can always use cookies',
    empty: 'No sites added',
    status: 'Allowed',
    sample: '[*.]example.com',
  },
  {
    setting: 'session_only',
    title: 'Always clear cookies when windows are closed',
    empty: 'No sites added',
    status: 'Clear on exit',
    sample: '[*.]example.com',
  },
  {
    setting: 'block',
    title: 'Sites that can never use cookies',
    empty: 'No sites added',
    status: 'Blocked',
    sample: 'tracker-network.com',
  },
];

function validateCookiePattern(pattern) {
  const value = String(pattern || '').trim();
  if (!value) return { ok: false, error: 'Enter a site pattern.' };
  if (value.length > 253) return { ok: false, error: 'Site pattern is too long.' };
  if (/[\u0000-\u001F\u007F\s]/.test(value)) {
    return { ok: false, error: 'Site pattern cannot contain spaces or control characters.' };
  }
  return { ok: true, value };
}

const CHECK_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
  </svg>
);

function getActiveSection(activeView) {
  if (activeView.startsWith('privacy/')) return 'privacy';
  return activeView;
}

function SidebarIcon({ icon, fallback }) {
  if (icon) {
    return (
      <span
        className="settings-sidebar-icon settings-sidebar-icon--asset"
        style={{ '--settings-sidebar-icon-url': `url("${icon}")` }}
        aria-hidden="true"
      />
    );
  }

  return (
    <span className="settings-sidebar-icon" aria-hidden="true">
      {fallback}
    </span>
  );
}

function AssetMaskIcon({ icon, className = '', label = null }) {
  return (
    <span
      className={`settings-asset-icon ${className}`.trim()}
      style={{ '--settings-asset-icon-url': `url("${icon}")` }}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label || undefined}
    />
  );
}

function BackIconButton({ onClick, label = 'Back' }) {
  return (
    <button type="button" className="settings-back-icon-btn" onClick={onClick} aria-label={label}>
      <AssetMaskIcon icon={SETTINGS_NAV_ICONS.angle_left} />
    </button>
  );
}

function DefaultBrowserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9A2.5 2.5 0 0 1 17.5 17h-11A2.5 2.5 0 0 1 4 14.5v-9Z" />
      <path d="M8 21h8M12 17v4M4 7h16" />
    </svg>
  );
}

function SettingsSearchField({
  value,
  onChange,
  placeholder,
  label,
  className = '',
}) {
  return (
    <label className={`settings-search-field ${className}`.trim()}>
      <AssetMaskIcon icon={SETTINGS_NAV_ICONS.search} className="settings-search-field__icon" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      {value ? (
        <button
          type="button"
          className="settings-search-field__clear"
          onClick={() => onChange('')}
          aria-label={`Clear ${label}`}
        >
          <AssetMaskIcon icon={SETTINGS_NAV_ICONS.cross} />
        </button>
      ) : null}
    </label>
  );
}

function ConfirmModal({ title, description, confirmLabel, onConfirm, onClose }) {
  return (
    <div
      className="settings-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-confirm-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="settings-confirm-modal">
        <h2 id="settings-confirm-title">{title}</h2>
        <p>{description}</p>
        <div className="settings-confirm-actions">
          <button type="button" className="diag-btn diag-btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="diag-btn settings-confirm-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function CookieExceptionModal({ setting, onAdd, onClose }) {
  const [pattern, setPattern] = useState('');
  const [error, setError] = useState('');
  const group = COOKIE_EXCEPTION_GROUPS.find((item) => item.setting === setting);

  const handleSubmit = (event) => {
    event.preventDefault();
    const validation = validateCookiePattern(pattern);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError('');
    onAdd(validation.value);
  };

  return (
    <div className="cookie-exception-overlay" role="dialog" aria-modal="true" aria-labelledby="cookie-exception-title">
      <form className="cookie-exception-modal" onSubmit={handleSubmit}>
        <h2 id="cookie-exception-title">Add a site</h2>
        <p>Enter a domain or wildcard pattern for {group?.title.toLowerCase()}.</p>
        <label className="cookie-exception-field">
          <span>Site</span>
          <input
            autoFocus
            type="text"
            value={pattern}
            onChange={(event) => {
              setPattern(event.target.value);
              setError('');
            }}
            placeholder={group?.sample || '[*.]example.com'}
          />
        </label>
        {error ? <div className="cookie-exception-error" role="alert">{error}</div> : null}
        <div className="cookie-exception-actions">
          <button type="button" className="diag-btn diag-btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="diag-btn" disabled={!pattern.trim()}>
            Add
          </button>
        </div>
      </form>
    </div>
  );
}

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
  const [activeView, setActiveView] = useState('privacy/main');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [cookieSearch, setCookieSearch] = useState('');
  const [cookiePageSearch, setCookiePageSearch] = useState('');
  const [cookieSites, setCookieSites] = useState([]);
  const [cookieLoading, setCookieLoading] = useState(false);
  const [cookieError, setCookieError] = useState('');
  const [cookieExceptionModal, setCookieExceptionModal] = useState(null);
  const [cookieDeleteConfirm, setCookieDeleteConfirm] = useState(null);

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
    console.log('handleSearchEngineChange', value);
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

  const cookieConfig = useMemo(() => ({
    globalPolicy: settings?.cookieConfig?.globalPolicy || 'allow',
    exceptions: Array.isArray(settings?.cookieConfig?.exceptions) ? settings.cookieConfig.exceptions : [],
  }), [settings?.cookieConfig]);

  const persistCookieConfig = useCallback(async (nextConfig) => {
    const normalizedConfig = {
      globalPolicy: nextConfig?.globalPolicy || 'allow',
      exceptions: Array.isArray(nextConfig?.exceptions) ? nextConfig.exceptions : [],
    };
    setSettings((current) => ({ ...current, cookieConfig: normalizedConfig }));
    if (window.cookieAPI?.updateSettings) {
      const saved = await window.cookieAPI.updateSettings(normalizedConfig);
      if (saved && typeof saved === 'object') {
        setSettings((current) => ({ ...current, cookieConfig: saved }));
      }
    } else {
      await persist({ ...settings, cookieConfig: normalizedConfig });
    }
  }, [persist, settings]);

  const handleCookiePolicyChange = useCallback(async (globalPolicy) => {
    await persistCookieConfig({ ...cookieConfig, globalPolicy });
  }, [cookieConfig, persistCookieConfig]);

  const addCookieException = useCallback(async (pattern) => {
    if (!cookieExceptionModal) return;
    const normalizedPattern = pattern.trim();
    if (!normalizedPattern) return;
    const nextExceptions = [
      ...cookieConfig.exceptions.filter((rule) => !(rule.pattern === normalizedPattern && rule.setting === cookieExceptionModal)),
      { pattern: normalizedPattern, setting: cookieExceptionModal },
    ];
    await persistCookieConfig({ ...cookieConfig, exceptions: nextExceptions });
    setCookieExceptionModal(null);
  }, [cookieConfig, cookieExceptionModal, persistCookieConfig]);

  const removeCookieException = useCallback(async (ruleToRemove) => {
    const nextExceptions = cookieConfig.exceptions.filter(
      (rule) => !(rule.pattern === ruleToRemove.pattern && rule.setting === ruleToRemove.setting),
    );
    await persistCookieConfig({ ...cookieConfig, exceptions: nextExceptions });
  }, [cookieConfig, persistCookieConfig]);

  const refreshCookieSites = useCallback(async () => {
    const api = window.cookieAPI;
    if (!api?.getCookieSummary) {
      setCookieSites([]);
      return;
    }

    setCookieLoading(true);
    setCookieError('');
    try {
      const summary = await api.getCookieSummary();
      setCookieSites(Array.isArray(summary) ? summary : []);
    } catch (err) {
      setCookieError(String(err?.message || err));
    } finally {
      setCookieLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeView === 'privacy/cookies/all') {
      refreshCookieSites();
    }
  }, [activeView, refreshCookieSites]);

  const deleteCookieSite = useCallback(async (domain) => {
    if (!domain) return;
    const result = await window.cookieAPI?.deleteCookiesForDomain?.(domain);
    if (result?.ok !== false) {
      setCookieSites((sites) => sites.filter((site) => site.domain !== domain));
    }
  }, []);

  const deleteAllCookieSites = useCallback(async () => {
    await window.cookieAPI?.clearAllSiteData?.();
    setCookieSites([]);
  }, []);

  const confirmCookieDelete = useCallback(async () => {
    const target = cookieDeleteConfirm;
    if (!target) return;
    if (target.type === 'all') {
      await deleteAllCookieSites();
    } else if (target.type === 'domain') {
      await deleteCookieSite(target.domain);
    }
    setCookieDeleteConfirm(null);
  }, [cookieDeleteConfirm, deleteAllCookieSites, deleteCookieSite]);

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

  const filteredCookieSites = useMemo(() => {
    const query = cookieSearch.trim().toLowerCase();
    if (!query) return cookieSites;
    return cookieSites.filter((site) => site.domain.toLowerCase().includes(query));
  }, [cookieSearch, cookieSites]);

  const visibleCookiePolicyOptions = useMemo(() => {
    const query = cookiePageSearch.trim();
    if (!query) return COOKIE_POLICY_OPTIONS;
    return COOKIE_POLICY_OPTIONS.filter((option) => (
      textMatchesQuery(option.label, query) || textMatchesQuery(option.description, query)
    ));
  }, [cookiePageSearch]);

  const visibleCookieExceptionGroups = useMemo(() => {
    const query = cookiePageSearch.trim();
    if (!query) {
      return COOKIE_EXCEPTION_GROUPS.map((group) => ({
        ...group,
        rules: cookieConfig.exceptions.filter((rule) => rule.setting === group.setting),
      }));
    }

    return COOKIE_EXCEPTION_GROUPS.map((group) => {
      const rules = cookieConfig.exceptions.filter((rule) => rule.setting === group.setting);
      const sectionMatches =
        textMatchesQuery(group.title, query) ||
        textMatchesQuery(group.status, query) ||
        textMatchesQuery(group.empty, query);
      const matchedRules = sectionMatches
        ? rules
        : rules.filter((rule) => (
          textMatchesQuery(rule.pattern, query) || textMatchesQuery(group.status, query)
        ));
      if (!sectionMatches && matchedRules.length === 0) return null;
      return { ...group, rules: matchedRules, sectionMatches };
    }).filter(Boolean);
  }, [cookieConfig.exceptions, cookiePageSearch]);

  const showCookieSiteDataLink = useMemo(() => {
    const query = cookiePageSearch.trim();
    if (!query) return true;
    return textMatchesQuery('See all site data and permissions', query);
  }, [cookiePageSearch]);

  const settingsSearchResults = useMemo(() => {
    const query = settingsSearch.trim();
    if (!query) return [];

    const pages = [
      {
        view: 'privacy/main',
        title: 'Privacy and security',
        subtitle: 'Default privacy settings',
        rows: [
          ['Enable DRM (Digital rights Management)', 'Prevents screenshots and screen recording of this browser window. A relaunch is required for changes to take effect.'],
          ['Cookies and other site data', 'View and manage cookies from sites visited in the active session.'],
        ],
      },
      {
        view: 'privacy/cookies',
        title: 'Cookies and other site data',
        subtitle: 'General settings and customized behaviors',
        rows: [
          ...COOKIE_POLICY_OPTIONS.map((option) => [option.label, option.description]),
          ['See all site data and permissions', 'Review cookies and storage saved by sites.'],
          ...COOKIE_EXCEPTION_GROUPS.map((group) => [group.title, `${group.status}. ${group.empty}`]),
          ...cookieConfig.exceptions.map((rule) => {
            const group = COOKIE_EXCEPTION_GROUPS.find((item) => item.setting === rule.setting);
            return [rule.pattern, group?.status || rule.setting];
          }),
        ],
      },
      {
        view: 'privacy/cookies/all',
        title: 'All cookies and site data',
        subtitle: 'View and manage local storage from specific websites',
        rows: cookieSites.map((site) => [site.domain, `${site.count} cookies ${formatBytes(site.storageBytes)}`]),
      },
      {
        view: 'appearance',
        title: 'Appearance',
        subtitle: 'Brightness and accent colors',
        rows: [
          ['Brightness', 'Device follows your system. Light or Dark applies only to InviSurf.'],
          ['Accent', 'Colours the tab strip and toolbar. Custom builds a palette from one seed colour.'],
          ...APPEARANCE_MODE_SEGMENTS.map((segment) => [segment.label, segment.title]),
          ...accentPresets.map((preset) => [preset.label, 'Accent colour preset']),
          ['Custom', 'Custom accent colour'],
        ],
      },
      {
        view: 'search_engine',
        title: 'Search Engine',
        subtitle: 'Default search provider',
        rows: SEARCH_ENGINE_OPTIONS.map((option) => [option.label, option.description]),
      },
      {
        view: 'default_browser',
        title: 'Default browser',
        subtitle: 'Default browser status',
        rows: [['Default browser status', 'Default browser controls are not available in this build yet.']],
      },
      {
        view: 'on_startup',
        title: 'On Startup',
        subtitle: 'Startup behavior',
        rows: STARTUP_OPTIONS.map((option) => [option.label, option.description]),
      },
      {
        view: 'browser_identity',
        title: 'Browser identity verification',
        subtitle: 'Local identity diagnostics',
        rows: [['Local identity diagnostics', 'Read-only report of InviSurf app paths, configured User-Agent, outbound Client Hint headers, GPU state, debug guard status, and navigator values.']],
      },
      {
        view: 'compatibility',
        title: 'Compatibility diagnostics',
        subtitle: 'Navigation diagnostics',
        rows: [['Collect navigation diagnostics', 'Records main-frame navigations, load failures, redirect guard actions, and selected response headers.']],
      },
      {
        view: 'crash_reports',
        title: 'Crash reports',
        subtitle: 'Encrypted app logs',
        rows: [['Encrypted app logs', 'View encrypted crash and activity logs stored on this machine.']],
      },
    ];

    return pages
      .map((page) => {
        const pageMatches = textMatchesQuery(page.title, query) || textMatchesQuery(page.subtitle, query);
        const rows = page.rows
          .map(([title, description]) => ({ title, description }))
          .filter((row) => (
            pageMatches || textMatchesQuery(row.title, query) || textMatchesQuery(row.description, query)
          ));
        if (!pageMatches && rows.length === 0) return null;
        return { ...page, rows };
      })
      .filter(Boolean);
  }, [accentPresets, cookieConfig.exceptions, cookieSites, settingsSearch]);

  const renderAppearancePanel = () => (
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
          <div className="appearance-mode" role="radiogroup" aria-label="Brightness">
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
  );

  const renderPrivacyMainPanel = () => (
    <section className="settings-section">
      <h2 className="settings-section__title">Privacy and security</h2>
      <div className="settings-card">
        <div className="setting-row">
          <div className="setting-row__text">
            <span className="setting-row__label">Enable DRM (Digital rights Management)</span>
            <span className="setting-row__desc">
              Prevents screenshots and screen recording of this browser window.
              A relaunch is required for changes to take effect.
            </span>
          </div>
          <Toggle checked={settings.contentProtection} onChange={handleContentProtectionChange} />
        </div>

        {pendingRelaunch && (
          <div className="relaunch-banner">
            <span className="relaunch-banner__text">Restart required to apply this change.</span>
            <button type="button" className="relaunch-btn" onClick={handleRelaunch}>
              Relaunch
            </button>
          </div>
        )}

        <button
          type="button"
          className="settings-link-row"
          onClick={() => setActiveView('privacy/cookies')}
        >
          <span>
            <span className="setting-row__label">Cookies and other site data</span>
            <span className="setting-row__desc">View and manage cookies from sites visited in the active session.</span>
          </span>
          <AssetMaskIcon icon={SETTINGS_NAV_ICONS.angle_right} className="settings-link-row__chevron" />
        </button>
      </div>
    </section>
  );

  const renderCookiesPanel = () => (
    <section className="settings-section">
      <div className="settings-subpage-header">
        <div className="settings-subpage-title">
          <BackIconButton onClick={() => setActiveView('privacy/main')} />
          <h2>Cookies and other site data</h2>
        </div>
        <SettingsSearchField
          value={cookiePageSearch}
          onChange={setCookiePageSearch}
          placeholder="Search this page"
          label="Search cookies settings"
          className="cookies-page-search"
        />
      </div>

      {visibleCookiePolicyOptions.length > 0 && (
        <div className="settings-card cookie-settings-card">
          <div className="cookie-card-header">
            <HighlightedText text="General settings" query={cookiePageSearch} />
          </div>
          <div className="cookie-policy-list" role="radiogroup" aria-label="Cookie policy">
            {visibleCookiePolicyOptions.map((option) => (
              <label
                key={option.value}
                className={`cookie-policy-row${cookieConfig.globalPolicy === option.value ? ' cookie-policy-row--checked' : ''}`}
              >
                <input
                  type="radio"
                  name="cookieGlobalPolicy"
                  value={option.value}
                  checked={cookieConfig.globalPolicy === option.value}
                  onChange={() => handleCookiePolicyChange(option.value)}
                />
                <span>
                  <span className="setting-row__label">
                    <HighlightedText text={option.label} query={cookiePageSearch} />
                  </span>
                  <span className="setting-row__desc">
                    <HighlightedText text={option.description} query={cookiePageSearch} />
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {showCookieSiteDataLink && (
        <div className="settings-card cookie-site-data-link">
        <button
          type="button"
          className="settings-link-row"
          onClick={() => setActiveView('privacy/cookies/all')}
        >
          <span>
            <AssetMaskIcon icon={SETTINGS_NAV_ICONS.cookie} className="cookie-link-icon" />
            <span className="setting-row__label">
              <HighlightedText text="See all site data and permissions" query={cookiePageSearch} />
            </span>
          </span>
          <AssetMaskIcon icon={SETTINGS_NAV_ICONS.angle_right} className="settings-link-row__chevron" />
        </button>
        </div>
      )}

      {visibleCookieExceptionGroups.length > 0 && (
        <div className="settings-card cookie-settings-card">
        <div className="cookie-card-header">
          <HighlightedText text="Customized behaviors" query={cookiePageSearch} />
        </div>
        {visibleCookieExceptionGroups.map((group) => {
          const rules = group.rules;
          return (
            <div className="cookie-exception-section" key={group.setting}>
              <div className="cookie-exception-section__header">
                <h3>
                  <HighlightedText text={group.title} query={cookiePageSearch} />
                </h3>
                <button type="button" className="cookies-add-btn" onClick={() => setCookieExceptionModal(group.setting)}>
                  Add
                </button>
              </div>
              {rules.length === 0 ? (
                <p className="cookie-exception-empty">
                  <HighlightedText text={group.empty} query={cookiePageSearch} />
                </p>
              ) : (
                <div className="cookie-exception-list">
                  {rules.map((rule) => (
                    <div className="cookie-exception-row" key={`${rule.setting}:${rule.pattern}`}>
                      <AssetMaskIcon icon={SETTINGS_NAV_ICONS.earth} className="cookie-exception-site-icon" />
                      <span className="cookie-exception-pattern">
                        <HighlightedText text={rule.pattern} query={cookiePageSearch} />
                      </span>
                      <span className="cookie-exception-status">
                        <HighlightedText text={group.status} query={cookiePageSearch} />
                      </span>
                      <button type="button" onClick={() => removeCookieException(rule)} aria-label={`Remove ${rule.pattern}`}>
                        <AssetMaskIcon icon={SETTINGS_NAV_ICONS.trash} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        </div>
      )}

      {cookiePageSearch.trim() && !showCookieSiteDataLink && visibleCookiePolicyOptions.length === 0 && visibleCookieExceptionGroups.length === 0 && (
        <div className="settings-card cookie-no-results">No cookie settings matched your search.</div>
      )}
    </section>
  );

  const renderAllCookiesPanel = () => (
    <section className="settings-section settings-section--cookies">
      <div className="settings-subpage-header settings-subpage-header--stacked">
        <BackIconButton onClick={() => setActiveView('privacy/cookies')} />
        <div className="settings-subpage-heading-text">
          <h2>All cookies and site data</h2>
          <p>View and manage local storage from specific websites</p>
        </div>
      </div>

      <div className="cookies-toolbar">
        <SettingsSearchField
          value={cookieSearch}
          onChange={setCookieSearch}
          placeholder="Search for a site"
          label="Search for a site"
          className="cookies-search"
        />
        <div className="cookies-toolbar-actions">
          <button
            type="button"
            className="cookies-toolbar-button"
            onClick={refreshCookieSites}
            disabled={cookieLoading}
          >
            Refresh
          </button>
          <button
            type="button"
            className="cookies-toolbar-button"
            onClick={() => setCookieDeleteConfirm({ type: 'all' })}
            disabled={cookieSites.length === 0}
          >
            Remove all
          </button>
        </div>
      </div>

      <div className="cookies-table-card">
        <div className="cookies-table cookies-table--header" role="row">
          <span>Site</span>
          <span>Cookies</span>
          <span>Storage</span>
          <span>Actions</span>
        </div>
        <div className="cookies-table-body">
          {cookieLoading ? (
            <div className="cookies-empty">Loading cookies…</div>
          ) : cookieError ? (
            <div className="cookies-empty cookies-empty--error">{cookieError}</div>
          ) : filteredCookieSites.length === 0 ? (
            <div className="cookies-empty">No sites listed for the active session.</div>
          ) : (
            filteredCookieSites.map((site) => (
              <div className="cookies-table cookies-table--row" role="row" key={site.domain}>
                <span className="cookies-site">
                  <span className="cookies-site__favicon" aria-hidden="true">
                    {site.domain.charAt(0).toUpperCase()}
                  </span>
                  <span>{site.domain}</span>
                </span>
                <span>{site.count} {site.count === 1 ? 'cookie' : 'cookies'}</span>
                <span>{formatBytes(site.storageBytes)}</span>
                <span className="cookies-actions">
                  <button
                    type="button"
                    onClick={() => setCookieDeleteConfirm({ type: 'domain', domain: site.domain })}
                    aria-label={`Remove cookies for ${site.domain}`}
                  >
                    <AssetMaskIcon icon={SETTINGS_NAV_ICONS.trash} />
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="cookies-footer-note">
        <span className="cookies-info" aria-hidden="true">i</span>
        <span>Deleting cookies will sign you out of most sites.</span>
        <strong>{filteredCookieSites.length} total sites listed</strong>
      </div>
    </section>
  );

  const renderSearchEnginePanel = () => (
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
  );

  const renderStartupPanel = () => (
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
  );

  const renderDefaultBrowserPanel = () => (
    <section className="settings-section">
      <h2 className="settings-section__title">Default browser</h2>
      <div className="settings-card">
        <div className="setting-row">
          <div className="setting-row__text">
            <span className="setting-row__label">Default browser status</span>
            <span className="setting-row__desc">
              Default browser controls are not available in this build yet.
            </span>
          </div>
        </div>
      </div>
    </section>
  );

  const renderIdentityPanel = () => (
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
            <button type="button" className="diag-btn" onClick={refreshIdentityReport} disabled={identityLoading}>
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
  );

  const renderCompatibilityPanel = () => (
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
              <button type="button" className="diag-btn" onClick={refreshDiagReport} disabled={diagLoading}>
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
  );

  const renderCrashReportsPanel = () => (
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
          <button type="button" className="diag-btn" onClick={openCrashLogsModal}>
            Crash reports
          </button>
        </div>
      </div>
    </section>
  );

  const openSettingsSearchResult = useCallback((view) => {
    setActiveView(view);
    if (view === 'privacy/cookies') {
      setCookiePageSearch(settingsSearch.trim());
    } else if (view === 'privacy/cookies/all') {
      setCookieSearch(settingsSearch.trim());
    }
    setSettingsSearch('');
  }, [settingsSearch]);

  const renderSettingsSearchPanel = () => (
    <section className="settings-section settings-search-results">
      <h2 className="settings-section__title">Search results</h2>
      {settingsSearchResults.length === 0 ? (
        <div className="settings-card settings-search-empty">No settings matched your search.</div>
      ) : (
        <div className="settings-search-result-list">
          {settingsSearchResults.map((page) => (
            <button
              type="button"
              className="settings-card settings-search-result"
              key={page.view}
              onClick={() => openSettingsSearchResult(page.view)}
            >
              <span className="settings-search-result__text">
                <span className="settings-search-result__title">
                  <HighlightedText text={page.title} query={settingsSearch} />
                </span>
                <span className="settings-search-result__subtitle">
                  <HighlightedText text={page.subtitle} query={settingsSearch} />
                </span>
                {page.rows.slice(0, 4).map((row) => (
                  <span className="settings-search-result__row" key={`${page.view}:${row.title}:${row.description}`}>
                    <strong><HighlightedText text={row.title} query={settingsSearch} /></strong>
                    <small><HighlightedText text={row.description} query={settingsSearch} /></small>
                  </span>
                ))}
              </span>
              <AssetMaskIcon icon={SETTINGS_NAV_ICONS.angle_right} className="settings-search-result__chevron" />
            </button>
          ))}
        </div>
      )}
    </section>
  );

  const renderActivePanel = () => {
    if (settingsSearch.trim()) return renderSettingsSearchPanel();

    switch (activeView) {
      case 'appearance':
        return renderAppearancePanel();
      case 'search_engine':
        return renderSearchEnginePanel();
      case 'default_browser':
        return renderDefaultBrowserPanel();
      case 'on_startup':
        return renderStartupPanel();
      case 'browser_identity':
        return renderIdentityPanel();
      case 'compatibility':
        return renderCompatibilityPanel();
      case 'crash_reports':
        return renderCrashReportsPanel();
      case 'privacy/cookies':
        return renderCookiesPanel();
      case 'privacy/cookies/all':
        return renderAllCookiesPanel();
      case 'privacy':
      case 'privacy/main':
      default:
        return renderPrivacyMainPanel();
    }
  };

  if (!contextReady || !settings) {
    return <div className="settings-loading">Loading…</div>;
  }

  const activeSection = getActiveSection(activeView);

  return (
    <div className={`settings-page${isStealthWindow ? ' settings-page--stealth' : ''}`}>
      <header className="settings-header">
        <h1 className="settings-header__title">InviSurf</h1>
        <SettingsSearchField
          value={settingsSearch}
          onChange={setSettingsSearch}
          placeholder="Search settings"
          label="Search settings"
          className="settings-header-search"
        />
      </header>

      <div className="settings-shell">
        <aside className="settings-sidebar" aria-label="Settings sections">
          <div className="settings-sidebar-heading">
            <span>Settings</span>
            <small>Manage your browser</small>
          </div>
          <nav className="settings-sidebar-nav">
            {SETTINGS_NAV_ITEMS.map((item) => {
              const active = activeSection === item.section;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`settings-sidebar-item${active ? ' settings-sidebar-item--active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setActiveView(item.id)}
                >
                  <SidebarIcon icon={item.icon} fallback={<DefaultBrowserIcon />} />
                  <span>{item.label}</span>
                </button>
              );
            })}

            <div className={`settings-sidebar-group${REPORT_NAV_ITEMS.some((item) => activeSection === item.section) ? ' settings-sidebar-group--active' : ''}`}>
              <div className="settings-sidebar-group__label">
                <SidebarIcon icon={SETTINGS_NAV_ICONS.reports} />
                <span>Reports</span>
              </div>
              {REPORT_NAV_ITEMS.map((item) => {
                const active = activeSection === item.section;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`settings-sidebar-subitem${active ? ' settings-sidebar-subitem--active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setActiveView(item.id)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </nav>
        </aside>

        <main className="settings-scroll-root" key={activeView}>
          <div className="settings-content">
            {renderActivePanel()}
          </div>
        </main>
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

      {cookieExceptionModal && (
        <CookieExceptionModal
          setting={cookieExceptionModal}
          onAdd={addCookieException}
          onClose={() => setCookieExceptionModal(null)}
        />
      )}

      {cookieDeleteConfirm && (
        <ConfirmModal
          title={cookieDeleteConfirm.type === 'all' ? 'Remove all site data?' : `Remove cookies for ${cookieDeleteConfirm.domain}?`}
          description={
            cookieDeleteConfirm.type === 'all'
              ? 'This will delete all cookies stored for the active profile. You may be signed out of most sites.'
              : 'This will delete cookies for this site. You may be signed out of this site.'
          }
          confirmLabel={cookieDeleteConfirm.type === 'all' ? 'Remove all' : 'Remove'}
          onConfirm={confirmCookieDelete}
          onClose={() => setCookieDeleteConfirm(null)}
        />
      )}
    </div>
  );
}
