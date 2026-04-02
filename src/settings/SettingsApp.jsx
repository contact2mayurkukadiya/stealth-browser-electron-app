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

function RadioRow({ option, checked, onChange }) {
  return (
    <label className={`radio-row${checked ? ' radio-row--checked' : ''}`}>
      <input
        type="radio"
        name="startupBehavior"
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

  const handleRelaunch = useCallback(() => {
    window.electronAPI.appRelaunch();
  }, []);

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
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
