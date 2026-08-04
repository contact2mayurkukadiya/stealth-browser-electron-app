import React, { useState, useEffect, useCallback } from 'react';
import { folderSvg, bookmarkStarSvg } from '../../constants/appAssetUrls';
import AssetMaskIcon from '../../components/AssetMaskIcon.jsx';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Extract only folder nodes (no URL) from a list */
function extractFolders(nodes) {
    if (!Array.isArray(nodes)) return [];
    return nodes
        .filter((n) => n && !n.url) // folders have no url
        .map((n) => ({
            id: String(n.id),
            title: n.title || 'Untitled folder',
            children: extractFolders(n.children),
        }));
}

// ─── Recursive FolderNode ─────────────────────────────────────────────────────

function FolderNode({ folder, depth, activeFolderId, expandedIds, onToggle, onSelect, parentPath = [] }) {
    const hasChildren = folder.children && folder.children.length > 0;
    const isActive = activeFolderId === folder.id;
    const isExpanded = expandedIds.has(folder.id);

    const indentPx = depth * 14;
    const currentPath = [...parentPath, { id: folder.id, title: folder.title }];

    return (
        <div className="b-tree-group">
            <button
                type="button"
                className={`b-nav-item${isActive ? ' active' : ''}`}
                style={{ paddingLeft: `${14 + indentPx}px` }}
                onClick={() => onSelect(folder.id, folder.title, currentPath)}
                aria-current={isActive ? 'page' : undefined}
            >
                {/* Toggle arrow – only shown when folder has children */}
                <span
                    className={`b-tree-arrow${hasChildren ? '' : ' b-tree-arrow--hidden'}${isExpanded ? ' expanded' : ''}`}
                    onClick={(e) => {
                        if (!hasChildren) return;
                        e.stopPropagation();
                        onToggle(folder.id);
                    }}
                    role="button"
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    tabIndex={hasChildren ? 0 : -1}
                    onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && hasChildren) {
                            e.stopPropagation();
                            onToggle(folder.id);
                        }
                    }}
                >
                    ▶
                </span>

                <AssetMaskIcon icon={folderSvg} size={15} className="b-nav-folder-icon" />
                <span className="b-nav-item-label">{folder.title}</span>
            </button>

            {isExpanded && hasChildren && (
                <div className="b-tree-children">
                    {folder.children.map((child) => (
                        <FolderNode
                            key={child.id}
                            folder={child}
                            depth={depth + 1}
                            activeFolderId={activeFolderId}
                            expandedIds={expandedIds}
                            onToggle={onToggle}
                            onSelect={onSelect}
                            parentPath={currentPath}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Root folder section ──────────────────────────────────────────────────────

const ROOT_MOBILE_ID = '3';

function RootSection({
    rootId,
    rootTitle,
    rootIcon,
    subFolders,
    activeFolderId,
    expandedIds,
    onToggle,
    onSelect,
}) {
    const isActive = activeFolderId === rootId;
    const isExpanded = expandedIds.has(rootId);
    const hasChildren = subFolders && subFolders.length > 0;
    const rootPath = [{ id: rootId, title: rootTitle }];

    return (
        <div className="b-tree-group">
            <button
                type="button"
                className={`b-nav-item${isActive ? ' active' : ''}`}
                onClick={() => onSelect(rootId, rootTitle, rootPath)}
                aria-current={isActive ? 'page' : undefined}
            >
                <span
                    className={`b-tree-arrow${hasChildren ? '' : ' b-tree-arrow--hidden'}${isExpanded ? ' expanded' : ''}`}
                    onClick={(e) => {
                        if (!hasChildren) return;
                        e.stopPropagation();
                        onToggle(rootId);
                    }}
                    role="button"
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    tabIndex={hasChildren ? 0 : -1}
                    onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && hasChildren) {
                            e.stopPropagation();
                            onToggle(rootId);
                        }
                    }}
                >
                    ▶
                </span>
                <AssetMaskIcon icon={rootIcon} size={15} className="b-nav-folder-icon" />
                <span className="b-nav-item-label">{rootTitle}</span>
            </button>

            {isExpanded && hasChildren && (
                <div className="b-tree-children">
                    {subFolders.map((child) => (
                        <FolderNode
                            key={child.id}
                            folder={child}
                            depth={1}
                            activeFolderId={activeFolderId}
                            expandedIds={expandedIds}
                            onToggle={onToggle}
                            onSelect={onSelect}
                            parentPath={rootPath}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export default function Sidebar({ activeFolderId, expandedIds, onToggleExpand, onSelectFolder }) {
    const [tree, setTree] = useState({ bar: [], other: [], mobile: [] });

    // Load full bookmark tree to build the folder hierarchy
    const loadTree = useCallback(async () => {
        try {
            const raw = await window.electronAPI.bookmarksGet();
            setTree({
                bar: extractFolders(raw?.bar || []),
                other: extractFolders(raw?.other || []),
                mobile: extractFolders(raw?.mobile || []),
            });
        } catch (err) {
            console.error('[Sidebar] Failed to load bookmark tree:', err);
        }
    }, []);

    useEffect(() => {
        loadTree();
    }, [loadTree]);

    // Refresh tree when bookmarks change (e.g. folder added/removed)
    useEffect(() => {
        if (!window.electronAPI?.onBookmarksUpdated) return undefined;
        const unsub = window.electronAPI.onBookmarksUpdated(loadTree);
        return () => { if (typeof unsub === 'function') unsub(); };
    }, [loadTree]);

    return (
        <aside className="b-sidebar" aria-label="Bookmark navigation">
            <div className="b-sidebar-brand">
                <AssetMaskIcon icon={bookmarkStarSvg} size={20} />
                Bookmarks
            </div>

            <nav className="b-sidebar-nav">
                <RootSection
                    rootId="1"
                    rootTitle="Bookmarks Bar"
                    rootIcon={folderSvg}
                    subFolders={tree.bar}
                    activeFolderId={activeFolderId}
                    expandedIds={expandedIds}
                    onToggle={onToggleExpand}
                    onSelect={onSelectFolder}
                />

                <RootSection
                    rootId="2"
                    rootTitle="Other Bookmarks"
                    rootIcon={folderSvg}
                    subFolders={tree.other}
                    activeFolderId={activeFolderId}
                    expandedIds={expandedIds}
                    onToggle={onToggleExpand}
                    onSelect={onSelectFolder}
                />

                <RootSection
                    rootId={ROOT_MOBILE_ID}
                    rootTitle="Mobile Bookmarks"
                    rootIcon={folderSvg}
                    subFolders={tree.mobile}
                    activeFolderId={activeFolderId}
                    expandedIds={expandedIds}
                    onToggle={onToggleExpand}
                    onSelect={onSelectFolder}
                />
            </nav>
        </aside>
    );
}