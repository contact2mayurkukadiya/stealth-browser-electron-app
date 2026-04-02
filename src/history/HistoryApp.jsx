import React, { useState, useEffect, useCallback, useRef } from 'react';
import './HistoryApp.css';
import Sidebar from './components/Sidebar';
import ByDateView from './components/ByDateView';
import ByGroupView from './components/ByGroupView';
import ContextMenu from './components/ContextMenu';
import ClearDataModal from './components/ClearDataModal';

export const VIEW_BY_DATE = 'byDate';
export const VIEW_BY_GROUP = 'byGroup';

function normalizeEntries(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((entry) => entry && typeof entry.url === 'string')
    .map((entry) => {
      const ts = Number(entry.timestamp);
      return {
        url: entry.url,
        title: entry.title || entry.url,
        timestamp: Number.isFinite(ts) ? ts : Date.now(),
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

export default function HistoryApp() {
  const [entries, setEntries] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState(VIEW_BY_DATE);
  const [selected, setSelected] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null); // { x, y, entry }
  const [showClearModal, setShowClearModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Close context menu on outside click
  const contextMenuRef = useRef(null);
  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [contextMenu]);

  // Escape closes modal and context menu
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setShowClearModal(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Load history on mount
  useEffect(() => {
    async function fetchHistory() {
      setIsLoading(true);
      try {
        const raw = await window.electronAPI.historyGet();
        setEntries(normalizeEntries(raw));
      } catch (err) {
        console.error('Failed to load history:', err);
        setEntries([]);
      } finally {
        setIsLoading(false);
      }
    }
    fetchHistory();
  }, []);

  const filteredEntries = searchTerm
    ? entries.filter((e) => {
        const q = searchTerm.toLowerCase();
        return (
          e.title.toLowerCase().includes(q) ||
          e.url.toLowerCase().includes(q)
        );
      })
    : entries;

  const selectedCount = selected.size;

  // ── Selection helpers ───────────────────────────────────────────────────────
  const toggleSelect = useCallback((timestamp) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(timestamp)) next.delete(timestamp);
      else next.add(timestamp);
      return next;
    });
  }, []);

  // ── Open entry in new tab and make it active ────────────────────────────────
  const openEntry = useCallback((url) => {
    const tabId = `h-${Date.now()}`;
    window.electronAPI.newTab(tabId, false, url);
    window.electronAPI.switchTab(tabId);
  }, []);

  // ── Context menu ────────────────────────────────────────────────────────────
  const openContextMenu = useCallback((anchorRect, entry) => {
    const menuWidth = 200;
    let x = Math.round(anchorRect.right - menuWidth);
    let y = Math.round(anchorRect.bottom + 6);
    // Keep inside viewport
    if (x < 4) x = 4;
    if (y + 120 > window.innerHeight) y = Math.round(anchorRect.top - 120);
    setContextMenu({ x, y, entry });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // ── Delete single entry ─────────────────────────────────────────────────────
  const removeEntry = useCallback(async (timestamp) => {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return;
    const ok = await window.electronAPI.historyRemoveItems([ts]);
    if (!ok) return;
    setEntries((prev) => prev.filter((e) => e.timestamp !== ts));
    setSelected((prev) => { const n = new Set(prev); n.delete(ts); return n; });
  }, []);

  // ── Delete selected entries ─────────────────────────────────────────────────
  const deleteSelected = useCallback(async () => {
    if (selected.size === 0) return;
    const timestamps = Array.from(selected).map(Number).filter(Number.isFinite);
    const ok = await window.electronAPI.historyRemoveItems(timestamps);
    if (!ok) return;
    const removeSet = new Set(timestamps);
    setEntries((prev) => prev.filter((e) => !removeSet.has(e.timestamp)));
    setSelected(new Set());
  }, [selected]);

  // ── Clear by time range (from modal) ───────────────────────────────────────
  const clearByTimeRange = useCallback(async (rangeMs) => {
    if (rangeMs === null) {
      // "All time"
      const ok = await window.electronAPI.historyClear();
      if (!ok) return;
      setEntries([]);
      setSelected(new Set());
    } else {
      const cutoff = Date.now() - rangeMs;
      const toRemove = entries
        .filter((e) => e.timestamp >= cutoff)
        .map((e) => Number(e.timestamp))
        .filter(Number.isFinite);
      if (toRemove.length === 0) {
        setShowClearModal(false);
        return;
      }
      const ok = await window.electronAPI.historyRemoveItems(toRemove);
      if (!ok) return;
      const removeSet = new Set(toRemove);
      setEntries((prev) => prev.filter((e) => !removeSet.has(e.timestamp)));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const ts of removeSet) next.delete(ts);
        return next;
      });
    }
    setShowClearModal(false);
  }, [entries]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="h-page">
      <Sidebar
        activeItem="chrome-history"
        onDeleteBrowsingData={() => setShowClearModal(true)}
      />

      <main className="h-main">
        {/* Search */}
        <div className="h-search-wrap">
          <label className="h-search" htmlFor="h-search-input">
            <svg className="h-search-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.71.71l.27.28v.79L19 20.49 20.49 19zM10 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" />
            </svg>
            <input
              id="h-search-input"
              type="text"
              autoComplete="off"
              placeholder="Search history"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </label>
        </div>

        {/* View tabs */}
        <div className="h-view-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={viewMode === VIEW_BY_DATE}
            className={`h-view-tab${viewMode === VIEW_BY_DATE ? ' active' : ''}`}
            onClick={() => setViewMode(VIEW_BY_DATE)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            By date
          </button>
          <button
            role="tab"
            aria-selected={viewMode === VIEW_BY_GROUP}
            className={`h-view-tab${viewMode === VIEW_BY_GROUP ? ' active' : ''}`}
            onClick={() => setViewMode(VIEW_BY_GROUP)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
            By group
          </button>
        </div>

        {/* Selection toolbar */}
        <div className={`h-selection-bar${selectedCount === 0 ? ' hidden' : ''}`} aria-live="polite">
          <span className="h-selection-count">
            {selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected
          </span>
          <button className="h-selection-delete" onClick={deleteSelected}>
            Delete
          </button>
        </div>

        {/* Content */}
        <div className="h-content">
          {isLoading ? (
            <div className="h-empty">Loading history…</div>
          ) : filteredEntries.length === 0 ? (
            <div className="h-empty">
              {searchTerm ? 'No history matches your search.' : 'No browsing history yet.'}
            </div>
          ) : viewMode === VIEW_BY_DATE ? (
            <ByDateView
              entries={filteredEntries}
              selected={selected}
              onToggleSelect={toggleSelect}
              onOpenEntry={openEntry}
              onOpenContextMenu={openContextMenu}
            />
          ) : (
            <ByGroupView
              entries={filteredEntries}
              onOpenEntry={openEntry}
              onOpenContextMenu={openContextMenu}
            />
          )}
        </div>
      </main>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          ref={contextMenuRef}
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          onRemove={async (entry) => {
            closeContextMenu();
            await removeEntry(entry.timestamp);
          }}
          onClose={closeContextMenu}
        />
      )}

      {/* Clear data modal */}
      {showClearModal && (
        <ClearDataModal
          onClear={clearByTimeRange}
          onClose={() => setShowClearModal(false)}
        />
      )}
    </div>
  );
}
