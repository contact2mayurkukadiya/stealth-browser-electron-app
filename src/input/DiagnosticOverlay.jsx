import React, { useEffect, useState } from 'react';

/**
 * Development diagnostic overlay for ghost window + shadow input state.
 * Never displays typed text — key identifiers only.
 */
export default function DiagnosticOverlay() {
  const [state, setState] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onVirtualKeyboardState) return undefined;

    const checkVisibility = async () => {
      try {
        const settings = await api.settingsGet?.();
        const dev = !window.location.hostname || settings?.compatibilityDiagnosticsEnabled;
        setVisible(!!dev && settings?.nonActivatingInteraction);
      } catch (_) {
        setVisible(false);
      }
    };

    void checkVisibility();
    const unsubSettings = api.settingsUpdated?.(() => { void checkVisibility(); });
    const unsubState = api.onVirtualKeyboardState((payload) => setState(payload));

    return () => {
      if (typeof unsubSettings === 'function') unsubSettings();
      if (typeof unsubState === 'function') unsubState();
    };
  }, []);

  if (!visible || !state) return null;

  const routing = state.lastRouting || {};

  return (
    <div
      className="invisurf-ghost-diagnostics"
      aria-hidden="true"
      style={{
        position: 'fixed',
        bottom: 8,
        right: 8,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.82)',
        color: '#9ef',
        font: '11px/1.4 ui-monospace, monospace',
        padding: '8px 10px',
        borderRadius: 6,
        pointerEvents: 'none',
        maxWidth: 280,
      }}
    >
      <div>Ghost Window: {state.ghostEnabled ? 'ON' : 'OFF'}</div>
      <div>Monitor: {state.monitorRunning ? 'running' : 'stopped'}</div>
      <div>Permission: {state.permission?.granted ? 'granted' : 'denied'}</div>
      <div>Secure input paused: {state.secureInputPaused ? 'yes' : 'no'}</div>
      <div>Mode: {state.modeState || '—'}</div>
      <div>Virtual target: {state.virtualTarget?.targetId || 'none'}</div>
      <div>Last key: {routing.keyId || '—'}</div>
      <div>Routing: {routing.target || '—'}</div>
      <div>Consumed: {routing.consumed ? 'true' : 'false'}</div>
    </div>
  );
}
