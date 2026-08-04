import React, { useState, useEffect, useCallback, useRef } from 'react';
import './BookmarkApp.css';
import { useChromeTheme } from '../hooks/useChromeTheme';
import { useInvsurfDocumentFavicon } from '../hooks/useInvsurfLogoFavicon';
import Sidebar from './components/Sidebar';
import BookmarkListView from './components/BookmarkListView';
import ContextMenu from './components/ContextMenu';
import EditBookmarkModal from './components/EditBookmarkModal';
import { KEYBOARD } from '../constants/conditionStrings.js';
import { menuFindSvg } from '../constants/appAssetUrls.js';
import AssetMaskIcon from '../components/AssetMaskIcon.jsx';

const PAGE_SIZE = 50;

/** Mobile Bookmarks root folder ID – treated as "Coming Soon" */
const MOBILE_FOLDER_ID = '3';

function normalizeBookmarks(raw) {
    return (Array.isArray(raw) ? raw : [])
        .filter((entry) => entry)
        .map((entry) => ({
            id: entry.id,
            url: entry.url || null, // null = folder
            title: entry.title || entry.url || 'Untitled',
            parentId: entry.parentId,
        }));
}

export default function BookmarkApp() {
    useChromeTheme();
    useInvsurfDocumentFavicon();

    const [entries, setEntries] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selected, setSelected] = useState(new Set());
    const [contextMenu, setContextMenu] = useState(null); // { x, y, entry }

    // ── Clipboard & Editing state ─────────────────────────────────────────────
    const [rawTree, setRawTree] = useState(null);
    const [clipboardItem, setClipboardItem] = useState(null); // { item, isCut }
    const [editingEntry, setEditingEntry] = useState(null);

    // ── Folder navigation ────────────────────────────────────────────────────
    const [currentFolderId, setCurrentFolderId] = useState('1');
    const [folderPath, setFolderPath] = useState([{ id: '1', title: 'Bookmarks Bar' }]);

    // Sidebar tree expand state – Set of folder IDs that are expanded
    const [expandedIds, setExpandedIds] = useState(new Set(['1']));

    // ── Pagination ────────────────────────────────────────────────────────────
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [cursor, setCursor] = useState(null);

    const contextMenuRef = useRef(null);
    const sentinelRef = useRef(null);
    const requestIdRef = useRef(0);

    // Load full raw bookmark tree for folder counts and context menu
    const loadRawTree = useCallback(async () => {
        try {
            const raw = await window.electronAPI.bookmarksGet();
            setRawTree(raw);
        } catch (err) {
            console.error('[BookmarkApp] Failed to load raw tree:', err);
        }
    }, []);

    useEffect(() => {
        loadRawTree();
    }, [loadRawTree]);

    // ── Context menu dismiss ─────────────────────────────────────────────────
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
        const onKey = (e) => { if (e.key === KEYBOARD.ESCAPE) setContextMenu(null); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    // ── Data fetching ─────────────────────────────────────────────────────────
    const isMobileFolder = currentFolderId === MOBILE_FOLDER_ID;

    const fetchBookmarks = useCallback(async ({
        reset = false,
        nextCursor = null,
        query = searchTerm,
        folderId = currentFolderId,
    } = {}) => {
        // Mobile folder shows "Coming Soon" – skip fetch
        if (folderId === MOBILE_FOLDER_ID && !query) {
            setIsLoading(false);
            setEntries([]);
            return;
        }

        const requestId = ++requestIdRef.current;
        if (reset) setIsLoading(true);
        else setIsLoadingMore(true);

        try {
            let result;
            if (query) {
                result = await window.electronAPI.bookmarkSearch({
                    query,
                    limit: PAGE_SIZE,
                    cursor: reset ? null : nextCursor,
                });
            } else {
                result = await window.electronAPI.bookmarkGetFolder({
                    folderId,
                    limit: PAGE_SIZE,
                    cursor: reset ? null : nextCursor,
                });
            }

            if (requestId !== requestIdRef.current) return;

            const nextItems = normalizeBookmarks(result?.items);
            setEntries((prev) => (reset ? nextItems : [...prev, ...nextItems]));
            setCursor(result?.nextCursor || null);
            setHasMore(!!result?.hasMore);
            if (reset) setSelected(new Set());
        } catch (err) {
            console.error('[BookmarkApp] Failed to load bookmarks:', err);
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
    }, [searchTerm, currentFolderId]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            fetchBookmarks({ reset: true, query: searchTerm });
        }, 150);
        return () => window.clearTimeout(timer);
    }, [fetchBookmarks, searchTerm, currentFolderId]);

    useEffect(() => {
        if (!window.electronAPI?.onBookmarksUpdated) return undefined;
        const unsubscribe = window.electronAPI.onBookmarksUpdated(() => {
            fetchBookmarks({ reset: true, query: searchTerm });
            loadRawTree();
        });
        return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
    }, [fetchBookmarks, loadRawTree, searchTerm]);

    // Infinite scroll sentinel
    useEffect(() => {
        const node = sentinelRef.current;
        if (!node) return undefined;
        const observer = new IntersectionObserver((items) => {
            if (!items[0]?.isIntersecting) return;
            if (!hasMore || isLoading || isLoadingMore) return;
            fetchBookmarks({ reset: false, nextCursor: cursor });
        }, { rootMargin: '240px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [cursor, fetchBookmarks, hasMore, isLoading, isLoadingMore]);

    // ── Selection ─────────────────────────────────────────────────────────────
    const selectedCount = selected.size;

    const toggleSelect = useCallback((id) => {
        setSelected((prev) => {
            const next = new Set();
            if (!prev.has(id)) next.add(id);
            return next;
        });
    }, []);

    // ── Toggle sidebar expand ─────────────────────────────────────────────────
    const handleToggleExpand = useCallback((folderId) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(folderId)) next.delete(folderId);
            else next.add(folderId);
            return next;
        });
    }, []);

    // ── Folder navigation helpers ─────────────────────────────────────────────

    /** Called when a sidebar folder is clicked – set path directly from tree hierarchy */
    const handleSidebarFolderSelect = useCallback((folderId, folderTitle, path) => {
        setSearchTerm('');
        setCurrentFolderId(folderId);
        const nextPath = (path && Array.isArray(path) && path.length > 0)
            ? path
            : [{ id: folderId, title: folderTitle }];
        setFolderPath(nextPath);
        // Expand clicked folder and all ancestors so children are visible
        setExpandedIds((prev) => {
            const next = new Set(prev);
            nextPath.forEach((item) => next.add(item.id));
            return next;
        });
    }, []);

    /** Called when user double-clicks a folder row in the content area */
    const handleFolderDoubleClick = useCallback((folder) => {
        setSearchTerm('');
        setCurrentFolderId(folder.id);
        let nextPath;
        setFolderPath((prev) => {
            const idx = prev.findIndex((f) => f.id === folder.id);
            if (idx !== -1) {
                nextPath = prev.slice(0, idx + 1);
            } else {
                nextPath = [...prev, { id: folder.id, title: folder.title }];
            }
            return nextPath;
        });
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (nextPath) {
                nextPath.forEach((item) => next.add(item.id));
            } else {
                next.add(folder.id);
            }
            return next;
        });
    }, []);

    /** Breadcrumb click – navigate back up the path */
    const handleBreadcrumbClick = useCallback((folder) => {
        setSearchTerm('');
        setCurrentFolderId(folder.id);
        let nextPath;
        setFolderPath((prev) => {
            const idx = prev.findIndex((f) => f.id === folder.id);
            nextPath = idx !== -1 ? prev.slice(0, idx + 1) : [{ id: folder.id, title: folder.title }];
            return nextPath;
        });
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (nextPath) {
                nextPath.forEach((item) => next.add(item.id));
            } else {
                next.add(folder.id);
            }
            return next;
        });
    }, []);

    // ── URL open ──────────────────────────────────────────────────────────────
    const openEntry = useCallback((url) => {
        if (!url) return;
        const tabId = `b-${Date.now()}`;
        window.electronAPI.newTab(tabId, false, url, { source: 'bookmarks' });
        window.electronAPI.switchTab(tabId);
    }, []);

    // ── Context menu ──────────────────────────────────────────────────────────
    const openContextMenu = useCallback((anchorRect, entry) => {
        const menuWidth = 220;
        let x = Math.round(anchorRect.right - menuWidth);
        let y = Math.round(anchorRect.bottom + 6);
        if (x < 4) x = 4;
        if (y + 240 > window.innerHeight) y = Math.max(4, Math.round(anchorRect.top - 240));
        setContextMenu({ x, y, entry });
    }, []);

    const closeContextMenu = useCallback(() => setContextMenu(null), []);

    const removeEntry = useCallback(async (entry) => {
        if (!entry?.id) return;
        const ok = await window.electronAPI.bookmarkDelete([entry.id]);
        if (!ok) return;
        setEntries((prev) => prev.filter((e) => e.id !== entry.id));
        setSelected((prev) => { const n = new Set(prev); n.delete(entry.id); return n; });
        loadRawTree();
    }, [loadRawTree]);

    const deleteSelected = useCallback(async () => {
        if (selected.size === 0) return;
        const ids = Array.from(selected);
        const ok = await window.electronAPI.bookmarkDelete(ids);
        if (!ok) return;
        const removeSet = new Set(ids);
        setEntries((prev) => prev.filter((e) => !removeSet.has(e.id)));
        setSelected(new Set());
        loadRawTree();
    }, [loadRawTree, selected]);

    // ── Menu actions implementation ───────────────────────────────────────────
    const handleEdit = useCallback((entry) => {
        setEditingEntry(entry);
    }, []);

    const handleSaveEdit = useCallback(async (payload) => {
        if (!payload?.id) return;
        await window.electronAPI.bookmarkUpdate(payload);
        setEditingEntry(null);
        fetchBookmarks({ reset: true, query: searchTerm });
        loadRawTree();
    }, [fetchBookmarks, loadRawTree, searchTerm]);

    const handleCut = useCallback((entry) => {
        setClipboardItem({ item: entry, isCut: true });
    }, []);

    const handleCopy = useCallback((entry) => {
        setClipboardItem({ item: entry, isCut: false });
        if (entry.url) {
            try { navigator.clipboard.writeText(entry.url); } catch (_) { }
        }
    }, []);

    const handlePaste = useCallback(async () => {
        if (!clipboardItem?.item) return;
        const { item, isCut } = clipboardItem;
        await window.electronAPI.bookmarksAddToFolder(currentFolderId, item);
        if (isCut) {
            await window.electronAPI.bookmarkDelete([item.id]);
            setClipboardItem(null);
        }
        fetchBookmarks({ reset: true, query: searchTerm });
        loadRawTree();
    }, [clipboardItem, currentFolderId, fetchBookmarks, loadRawTree, searchTerm]);

    const handleOpenStealth = useCallback((entry, urls = []) => {
        // Build the full list of target URLs
        const targetUrls = entry?.url ? [entry.url] : urls.filter(Boolean);
        if (targetUrls.length === 0) return;
        if (targetUrls.length === 1) {
            // Single URL – simple path
            window.electronAPI.createStealthWindow({ url: targetUrls[0] });
        } else {
            // Multiple URLs: pass the entire array so the new stealth window
            // opens them all as separate tabs (handled by App.jsx bootstrap init).
            window.electronAPI.createStealthWindow({ urls: targetUrls });
        }
    }, []);

    const handleOpenNewWindow = useCallback((entry, urls = []) => {
        // Build the full list of target URLs
        const targetUrls = entry?.url ? [entry.url] : urls.filter(Boolean);
        if (targetUrls.length === 0) return;
        if (targetUrls.length === 1) {
            // Single URL – simple path
            window.electronAPI.createWindow({ url: targetUrls[0] });
        } else {
            // Multiple URLs: pass the entire array so the new window
            // opens them all as separate tabs (handled by App.jsx bootstrap init).
            window.electronAPI.createWindow({ urls: targetUrls });
        }
    }, []);

    const handleOpenNewTab = useCallback((entry, urls = []) => {
        const targetUrls = entry?.url ? [entry.url] : urls;
        if (targetUrls.length === 0) return;
        targetUrls.forEach((url, i) => {
            const tabId = `b-tab-${Date.now()}-${i}`;
            window.electronAPI.newTab(tabId, false, url, { source: 'bookmarks' });
            if (i === 0) window.electronAPI.switchTab(tabId);
        });
    }, []);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="b-page">
            <Sidebar
                activeFolderId={currentFolderId}
                expandedIds={expandedIds}
                onToggleExpand={handleToggleExpand}
                onSelectFolder={handleSidebarFolderSelect}
            />

            <main className="b-main">
                <div className="b-container">
                    {/* Search bar */}
                    <div className="b-search-wrap">
                        <label className="b-search" htmlFor="b-search-input">
                            <AssetMaskIcon icon={menuFindSvg} size={18} className="b-search-icon" />
                            <input
                                id="b-search-input"
                                type="text"
                                autoComplete="off"
                                placeholder="Search bookmarks"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </label>
                    </div>

                    {/* Breadcrumbs (hidden when searching) */}
                    {!searchTerm && (
                        <div className="b-breadcrumbs">
                            {folderPath.map((folder, idx) => (
                                <React.Fragment key={folder.id}>
                                    <span
                                        className={`b-breadcrumb-item${idx === folderPath.length - 1 ? ' active' : ''}`}
                                        onClick={() => handleBreadcrumbClick(folder)}
                                    >
                                        {folder.title}
                                    </span>
                                    {idx < folderPath.length - 1 && (
                                        <span className="b-breadcrumb-separator">{'>'}</span>
                                    )}
                                </React.Fragment>
                            ))}
                        </div>
                    )}

                    {/* Selection toolbar */}
                    <div className={`b-selection-bar${selectedCount === 0 ? ' hidden' : ''}`} aria-live="polite">
                        <span className="b-selection-count">
                            {selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected
                        </span>
                        <button className="b-selection-delete" onClick={deleteSelected}>
                            Delete
                        </button>
                    </div>

                    {/* Content area */}
                    <div className="b-content">
                        {/* Mobile Bookmarks: Coming Soon */}
                        {isMobileFolder && !searchTerm ? (
                            <div className="b-card b-coming-soon">
                                <div className="b-coming-soon-icon" aria-hidden="true">📱</div>
                                <h2 className="b-coming-soon-title">Mobile Bookmarks</h2>
                                <p className="b-coming-soon-desc">
                                    Mobile bookmark sync is coming soon. You'll be able to access bookmarks
                                    saved from your mobile devices right here.
                                </p>
                                <span className="b-coming-soon-badge">Coming Soon</span>
                            </div>
                        ) : isLoading ? (
                            <div className="b-card b-empty">Loading bookmarks…</div>
                        ) : entries.length === 0 ? (
                            <div className="b-card b-empty">
                                {searchTerm ? 'No bookmarks match your search.' : 'This folder is empty.'}
                            </div>
                        ) : (
                            <div className="b-card">
                                <BookmarkListView
                                    entries={entries}
                                    selected={selected}
                                    onToggleSelect={toggleSelect}
                                    onOpenEntry={openEntry}
                                    onOpenFolder={handleFolderDoubleClick}
                                    onOpenContextMenu={openContextMenu}
                                />
                            </div>
                        )}

                        <div ref={sentinelRef} style={{ height: 1 }} aria-hidden="true" />
                        {isLoadingMore ? <div className="b-empty">Loading more…</div> : null}
                    </div>
                </div>
            </main>

            {contextMenu && (
                <ContextMenu
                    ref={contextMenuRef}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    entry={contextMenu.entry}
                    tree={rawTree}
                    hasClipboard={!!clipboardItem}
                    onEdit={handleEdit}
                    onDelete={removeEntry}
                    onCut={handleCut}
                    onCopy={handleCopy}
                    onPaste={handlePaste}
                    onOpenStealth={handleOpenStealth}
                    onOpenNewWindow={handleOpenNewWindow}
                    onOpenNewTab={handleOpenNewTab}
                    onClose={closeContextMenu}
                />
            )}

            {editingEntry && (
                <EditBookmarkModal
                    entry={editingEntry}
                    onSave={handleSaveEdit}
                    onClose={() => setEditingEntry(null)}
                />
            )}
        </div>
    );
}