import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTabOverlay } from '../context/TabOverlayContext';

function matchesQuery(item, queryLower) {
  if (!queryLower) return true;
  const hay = `${item.category} ${item.label} ${item.keywords || ''}`.toLowerCase();
  const parts = queryLower.split(/\s+/).filter(Boolean);
  return parts.every((p) => hay.includes(p));
}

export default function CommandPaletteModal({ open, onClose, commands }) {
  const { beginOverlay, endOverlay } = useTabOverlay();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return commands.filter((c) => matchesQuery(c, q));
  }, [commands, query]);

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
      const max = filtered.length - 1;
      if (max < 0) return;
      setSelectedIndex(Math.max(0, Math.min(index, max)));
    },
    [filtered.length],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        safeSelect(selectedIndex + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        safeSelect(selectedIndex - 1);
        return;
      }
      if (e.key === 'Enter' && filtered[selectedIndex]) {
        e.preventDefault();
        filtered[selectedIndex].run();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, filtered, selectedIndex, safeSelect]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, filtered]);

  if (!open) return null;

  const platform = window.electronAPI?.platform;
  const shortcutHint = platform === 'darwin' ? '⇧⌘P' : 'Shift+Ctrl+P';

  return (
    <div className="search-tabs-overlay" role="dialog" aria-label="Search menu commands">
      <button type="button" className="search-tabs-backdrop" aria-label="Close" onClick={onClose} />
      <div className="search-tabs-panel command-palette-panel">
        <div className="search-tabs-field">
          <span className="search-tabs-search-icon" aria-hidden>⌕</span>
          <input
            ref={inputRef}
            type="search"
            className="search-tabs-input"
            placeholder="Search menu commands"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') e.stopPropagation();
            }}
          />
          <span className="search-tabs-shortcut-hint">{shortcutHint}</span>
        </div>
        <div className="search-tabs-divider" />
        <div className="search-tabs-section-label">Commands</div>
        <div className="search-tabs-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="search-tabs-empty">No matching commands</div>
          ) : (
            filtered.map((item, idx) => {
              const isSel = idx === selectedIndex;
              return (
                <div
                  key={`${item.category}-${item.label}-${idx}`}
                  data-idx={idx}
                  className={`search-tabs-row command-palette-row${isSel ? ' search-tabs-row--selected' : ''}`}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    item.run();
                    onClose();
                  }}
                >
                  <div className="search-tabs-row-text">
                    <div className="search-tabs-row-title">{item.label}</div>
                    <div className="search-tabs-row-meta">{item.category}</div>
                  </div>
                  {item.shortcut ? (
                    <span className="command-palette-shortcut">{item.shortcut}</span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
