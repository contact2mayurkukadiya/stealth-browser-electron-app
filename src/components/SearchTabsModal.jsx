import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTabOverlay } from '../context/TabOverlayContext';
import { logoIcognitoDarkSvg } from '../constants/appAssetUrls';
import { useInvsurfLogoFaviconUrl } from '../hooks/useInvsurfLogoFavicon';
import { isInvsurfBrandedInternalTab } from '../utils/invisurfInternalPages';
import { KEYBOARD, PLATFORM } from '../constants/conditionStrings.js';

function getHostname(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    return new URL(url).hostname || '';
  } catch {
    return '';
  }
}

export function formatTabRelativeTime(ts) {
  if (ts == null || Number.isNaN(ts)) return '';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 0) return 'just now';
  if (sec < 60) return `${sec} sec${sec === 1 ? '' : 's'} ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const d = Math.floor(hr / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

const CLOSE_SVG = (
  <svg width="14" height="14" viewBox="0 0 640 640" aria-hidden>
    <path fill="currentColor" d="M183.1 137.4C170.6 124.9 150.3 124.9 137.8 137.4C125.3 149.9 125.3 170.2 137.8 182.7L275.2 320L137.9 457.4C125.4 469.9 125.4 490.2 137.9 502.7C150.4 515.2 170.7 515.2 183.2 502.7L320.5 365.3L457.9 502.6C470.4 515.1 490.7 515.1 503.2 502.6C515.7 490.1 515.7 469.8 503.2 457.3L365.8 320L503.1 182.6C515.6 170.1 515.6 149.8 503.1 137.3C490.6 124.8 470.3 124.8 457.8 137.3L320.5 274.7L183.1 137.4z" />
  </svg>
);

export default function SearchTabsModal({
  open,
  onClose,
  tabOrder,
  tabs,
  currentTabId,
  onSelectTab,
  onCloseTab,
}) {
  const { beginOverlay, endOverlay } = useTabOverlay();
  const invsurfLogoFavicon = useInvsurfLogoFaviconUrl();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filteredOrder = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tabOrder;
    return tabOrder.filter((id) => {
      const t = tabs[id];
      if (!t) return false;
      const title = (t.title || '').toLowerCase();
      const url = (t.url || '').toLowerCase();
      const host = getHostname(t.url).toLowerCase();
      return title.includes(q) || url.includes(q) || host.includes(q);
    });
  }, [tabOrder, tabs, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) {
      endOverlay();
      return undefined;
    }
    setQuery('');
    setSelectedIndex(0);
    let cancelled = false;
    (async () => {
      await beginOverlay();
      if (!cancelled) inputRef.current?.focus();
    })();
    return () => {
      cancelled = true;
      endOverlay();
    };
  }, [open, beginOverlay, endOverlay]);

  const safeSelect = useCallback(
    (index) => {
      const max = filteredOrder.length - 1;
      if (max < 0) return;
      setSelectedIndex(Math.max(0, Math.min(index, max)));
    },
    [filteredOrder.length],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === KEYBOARD.ESCAPE) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === KEYBOARD.ARROW_DOWN) {
        e.preventDefault();
        safeSelect(selectedIndex + 1);
        return;
      }
      if (e.key === KEYBOARD.ARROW_UP) {
        e.preventDefault();
        safeSelect(selectedIndex - 1);
        return;
      }
      if (e.key === KEYBOARD.ENTER && filteredOrder[selectedIndex]) {
        e.preventDefault();
        onSelectTab(filteredOrder[selectedIndex]);
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onSelectTab, filteredOrder, selectedIndex, safeSelect]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, filteredOrder]);

  if (!open) return null;

  const platform = window.electronAPI?.platform;
  const shortcutHint = platform === PLATFORM.DARWIN ? '⇧⌘A' : 'Shift+Ctrl+A';

  return (
    <div className="search-tabs-overlay" role="dialog" aria-label="Search tabs">
      <button type="button" className="search-tabs-backdrop" aria-label="Close" onClick={onClose} />
      <div className="search-tabs-panel">
        <div className="search-tabs-field">
          <span className="search-tabs-search-icon" aria-hidden>⌕</span>
          <input
            ref={inputRef}
            type="search"
            className="search-tabs-input"
            placeholder="Search Tabs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === KEYBOARD.ARROW_DOWN || e.key === KEYBOARD.ARROW_UP) e.stopPropagation();
            }}
          />
          <span className="search-tabs-shortcut-hint">{shortcutHint}</span>
        </div>
        <div className="search-tabs-divider" />
        <div className="search-tabs-section-label">Open Tabs</div>
        <div className="search-tabs-list" ref={listRef}>
          {filteredOrder.length === 0 ? (
            <div className="search-tabs-empty">No matching tabs</div>
          ) : (
            filteredOrder.map((id, idx) => {
              const t = tabs[id];
              if (!t) return null;
              const rowIconSrc = t.isStealth
                ? logoIcognitoDarkSvg
                : isInvsurfBrandedInternalTab(t)
                  ? invsurfLogoFavicon
                  : t.favicon;
              const host = getHostname(t.url);
              const meta = [host, formatTabRelativeTime(t.lastActiveAt)].filter(Boolean).join(' • ');
              const isSel = idx === selectedIndex;
              const isCurrent = id === currentTabId;
              return (
                <div
                  key={id}
                  data-idx={idx}
                  className={`search-tabs-row${isSel ? ' search-tabs-row--selected' : ''}${isCurrent ? ' search-tabs-row--active' : ''}`}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    onSelectTab(id);
                    onClose();
                  }}
                >
                  <div className="search-tabs-row-icon">
                    {rowIconSrc ? (
                      <img src={rowIconSrc} alt="" onError={(e) => { e.target.style.visibility = 'hidden'; }} />
                    ) : (
                      <span className="search-tabs-favicon-fallback" />
                    )}
                  </div>
                  <div className="search-tabs-row-text">
                    <div className="search-tabs-row-title">{t.title || 'New Tab'}</div>
                    {meta ? <div className="search-tabs-row-meta">{meta}</div> : null}
                  </div>
                  <button
                    type="button"
                    className="search-tabs-row-close"
                    title="Close tab"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(id);
                    }}
                  >
                    {CLOSE_SVG}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
