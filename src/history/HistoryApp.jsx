import React, { useState, useEffect, useCallback, useRef } from 'react';
import './HistoryApp.css';
import { useChromeTheme } from '../hooks/useChromeTheme';
import { useInvsurfDocumentFavicon } from '../hooks/useInvsurfLogoFavicon';
import Sidebar from './components/Sidebar';
import ByDateView from './components/ByDateView';
import ByGroupView from './components/ByGroupView';
import ContextMenu from './components/ContextMenu';
import ClearDataModal from './components/ClearDataModal';
import { KEYBOARD } from '../constants/conditionStrings.js';

export const VIEW_BY_DATE = 'byDate';
export const VIEW_BY_GROUP = 'byGroup';

const PAGE_SIZE = 50;

function normalizeEntries(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((entry) => entry && typeof entry.url === 'string')
    .map((entry) => {
      const visitTime = Number(entry.visitTime ?? entry.timestamp);
      const visitId = Number(entry.visitId);
      return {
        visitId: Number.isFinite(visitId) ? visitId : visitTime,
        urlId: Number(entry.urlId) || null,
        url: entry.url,
        title: entry.title || entry.url,
        visitTime: Number.isFinite(visitTime) ? visitTime : Date.now(),
        timestamp: Number.isFinite(visitTime) ? visitTime : Date.now(),
        transition: entry.transition || 'LINK',
      };
    });
}

export default function HistoryApp() {
  useChromeTheme();
  useInvsurfDocumentFavicon();
  const [entries, setEntries] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState(VIEW_BY_DATE);
  const [selected, setSelected] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null); // { x, y, entry }
  const [showClearModal, setShowClearModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);

  const contextMenuRef = useRef(null);
  const sentinelRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const onPointerDown = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [contextMenu]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === KEYBOARD.ESCAPE) {
        setContextMenu(null);
        setShowClearModal(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const maybeOpenClearModal = () => {
      if (window.location.hash === '#clearBrowsingData') {
        setShowClearModal(true);
        window.history.replaceState(null, '', window.location.pathname);
      }
    };
    maybeOpenClearModal();
    window.addEventListener('hashchange', maybeOpenClearModal);
    return () => window.removeEventListener('hashchange', maybeOpenClearModal);
  }, []);

  const fetchHistory = useCallback(async ({ reset = false, nextCursor = null, query = searchTerm } = {}) => {
    const requestId = ++requestIdRef.current;
    if (reset) setIsLoading(true);
    else setIsLoadingMore(true);

    try {
      const result = await window.electronAPI.historySearch({
        query,
        limit: PAGE_SIZE,
        cursor: reset ? null : nextCursor,
      });
      if (requestId !== requestIdRef.current) return;

      const nextItems = normalizeEntries(result?.items);
      setEntries((prev) => (reset ? nextItems : [...prev, ...nextItems]));
      setCursor(result?.nextCursor || null);
      setHasMore(!!result?.hasMore);
      if (reset) setSelected(new Set());
    } catch (err) {
      console.error('Failed to load history:', err);
      if (reset) {
        setEntries([]);
        setCursor(null);
        setHasMore(false);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [searchTerm]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchHistory({ reset: true, query: searchTerm });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [fetchHistory, searchTerm]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver((items) => {
      const first = items[0];
      if (!first?.isIntersecting) return;
      if (!hasMore || isLoading || isLoadingMore) return;
      fetchHistory({ reset: false, nextCursor: cursor });
    }, { rootMargin: '240px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, fetchHistory, hasMore, isLoading, isLoadingMore]);

  const selectedCount = selected.size;

  const toggleSelect = useCallback((visitId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(visitId)) next.delete(visitId);
      else next.add(visitId);
      return next;
    });
  }, []);

  const openEntry = useCallback((url) => {
    const tabId = `h-${Date.now()}`;
    window.electronAPI.newTab(tabId, false, url, { source: 'history' });
    window.electronAPI.switchTab(tabId);
  }, []);

  const openContextMenu = useCallback((anchorRect, entry) => {
    const menuWidth = 200;
    let x = Math.round(anchorRect.right - menuWidth);
    let y = Math.round(anchorRect.bottom + 6);
    if (x < 4) x = 4;
    if (y + 120 > window.innerHeight) y = Math.round(anchorRect.top - 120);
    setContextMenu({ x, y, entry });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const removeEntry = useCallback(async (entry) => {
    const visitId = Number(entry?.visitId);
    if (!Number.isFinite(visitId)) return;
    const ok = await window.electronAPI.historyDeleteVisits([visitId]);
    if (!ok) return;
    setEntries((prev) => prev.filter((e) => e.visitId !== visitId));
    setSelected((prev) => { const n = new Set(prev); n.delete(visitId); return n; });
  }, []);

  const deleteSelected = useCallback(async () => {
    if (selected.size === 0) return;
    const visitIds = Array.from(selected).map(Number).filter(Number.isFinite);
    const ok = await window.electronAPI.historyDeleteVisits(visitIds);
    if (!ok) return;
    const removeSet = new Set(visitIds);
    setEntries((prev) => prev.filter((e) => !removeSet.has(e.visitId)));
    setSelected(new Set());
  }, [selected]);

  const clearByTimeRange = useCallback(async (rangeMs) => {
    const payload = rangeMs == null ? { since: null } : { since: Date.now() - rangeMs };
    const ok = await window.electronAPI.historyClear(payload);
    if (!ok) return;
    setShowClearModal(false);
    await fetchHistory({ reset: true, query: searchTerm });
  }, [fetchHistory, searchTerm]);

  const refreshHistory = useCallback(() => {
    fetchHistory({ reset: true, query: searchTerm });
  }, [fetchHistory, searchTerm]);

  return (
    <div className="h-page">
      <Sidebar
        activeItem="chrome-history"
        onDeleteBrowsingData={() => setShowClearModal(true)}
        onRefresh={refreshHistory}
      />

      <main className="h-main">
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

        <div className={`h-selection-bar${selectedCount === 0 ? ' hidden' : ''}`} aria-live="polite">
          <span className="h-selection-count">
            {selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected
          </span>
          <button className="h-selection-delete" onClick={deleteSelected}>
            Delete
          </button>
        </div>

        <div className="h-content">
          {isLoading ? (
            <div className="h-empty">Loading history...</div>
          ) : entries.length === 0 ? (
            <div className="h-empty">
              {searchTerm ? 'No history matches your search.' : 'No browsing history yet.'}
            </div>
          ) : viewMode === VIEW_BY_DATE ? (
            <ByDateView
              entries={entries}
              selected={selected}
              onToggleSelect={toggleSelect}
              onOpenEntry={openEntry}
              onOpenContextMenu={openContextMenu}
            />
          ) : (
            <ByGroupView
              entries={entries}
              onOpenEntry={openEntry}
              onOpenContextMenu={openContextMenu}
            />
          )}
          <div ref={sentinelRef} style={{ height: 1 }} aria-hidden="true" />
          {isLoadingMore ? <div className="h-empty">Loading more...</div> : null}
        </div>
      </main>

      {contextMenu && (
        <ContextMenu
          ref={contextMenuRef}
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          onRemove={async (entry) => {
            closeContextMenu();
            await removeEntry(entry);
          }}
          onClose={closeContextMenu}
        />
      )}

      {showClearModal && (
        <ClearDataModal
          onClear={clearByTimeRange}
          onClose={() => setShowClearModal(false)}
        />
      )}
    </div>
  );
}
