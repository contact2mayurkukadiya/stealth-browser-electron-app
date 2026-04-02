import React, { useState, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { setBookmarks } from '../store/bookmarksSlice';
import ContextMenu from './ContextMenu';
import FolderDropdown from './FolderDropdown';

const FOLDER_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 640 640">
    <path fill="currentColor" opacity="0.7" d="M128 512L512 512C547.3 512 576 483.3 576 448L576 208C576 172.7 547.3 144 512 144L362.7 144C355.8 144 349 141.8 343.5 137.6L305.1 108.8C294 100.5 280.5 96 266.7 96L128 96C92.7 96 64 124.7 64 160L64 448C64 483.3 92.7 512 128 512z" />
  </svg>
);
const CHEVRON_RIGHT = (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const DELETE_ICON = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export default function BookmarkItem({
  item,
  dragSrcIdRef,
  bookmarksData,
  onNavigate,
}) {
  const dispatch = useDispatch();
  const [contextMenu, setContextMenu] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  // true when the folder modal is open, null/false when closed.
  const [folderOpen, setFolderOpen] = useState(false);

  const isFolder = item.type === 'folder';

  // ── Drag source ──────────────────────────────────────────────────────────
  const handleDragStart = (e) => {
    dragSrcIdRef.current = item.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    setTimeout(() => e.target.classList.add('dragging'), 0);
    setFolderOpen(false);
  };
  const handleDragEnd = (e) => {
    e.target.classList.remove('dragging');
    setIsDragOver(false);
  };

  // ── Drop target ──────────────────────────────────────────────────────────
  const handleDragOver = (e) => {
    if (dragSrcIdRef.current === item.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const srcId = dragSrcIdRef.current;
    if (!srcId || srcId === item.id) return;

    // Read the source item from a snapshot — never mutate Redux state directly.
    const srcItem = bookmarksData.bar.find(b => b.id === srcId);
    if (!srcItem) return;

    if (isFolder && srcItem.type !== 'folder') {
      // ── Move a bookmark INTO this folder ──────────────────────────────────
      // bookmarksAddToFolder atomically removes the item from its current
      // position (root or any folder) before inserting it, so no separate
      // bookmarksRemove call is needed.
      await window.electronAPI.bookmarksAddToFolder(item.id, srcItem);
    } else {
      // ── Reorder on the root bar ───────────────────────────────────────────
      // This handles all remaining cases:
      //   • bookmark  → bookmark  (standard reorder)
      //   • folder    → bookmark  (reorder folder past a bookmark)
      //   • folder    → folder    (reorder folder past another folder)
      const newBar = [...bookmarksData.bar];
      const from = newBar.findIndex(b => b.id === srcId);
      const to = newBar.findIndex(b => b.id === item.id);
      if (from === -1 || to === -1) return;
      const [moved] = newBar.splice(from, 1);
      newBar.splice(to, 0, moved);
      await window.electronAPI.bookmarksReorder(newBar);
    }

    dragSrcIdRef.current = null;
    const updated = await window.electronAPI.bookmarksGet();
    dispatch(setBookmarks(updated));
  };

  // ── Folder close — restores the active tab view ──────────────────────────
  const handleFolderClose = useCallback(() => {
    setFolderOpen(false);
    window.electronAPI.tabRestoreActive?.();
  }, []);

  // ── Click ────────────────────────────────────────────────────────────────
  const handleClick = useCallback(async (e) => {
    e.stopPropagation();
    if (isFolder) {
      // Hide the active WebContentsView so the React modal appears above it,
      // then open the folder modal.
      await window.electronAPI.tabHideActive?.();
      setFolderOpen(true);
    } else {
      onNavigate(item.url);
    }
  }, [isFolder, onNavigate, item.url]);

  // ── Delete ───────────────────────────────────────────────────────────────
  const handleDelete = async (e) => {
    e.stopPropagation();
    const data = await window.electronAPI.bookmarksRemove(item.id);
    dispatch(setBookmarks(data));
  };

  // ── Context menu ─────────────────────────────────────────────────────────
  const handleContextMenu = (e) => {
    e.preventDefault();
    const menuItems = [];
    if (!isFolder) {
      menuItems.push({ label: 'Open', action: () => onNavigate(item.url) });
    }
    menuItems.push({
      label: isFolder ? 'Delete folder' : 'Remove bookmark',
      danger: true,
      action: async () => {
        const data = await window.electronAPI.bookmarksRemove(item.id);
        dispatch(setBookmarks(data));
      },
    });
    setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
  };

  const btnClass = [isFolder ? 'bk-folder' : 'bk-item', isDragOver ? 'bk-drag-over' : ''].filter(Boolean).join(' ');

  return (
    <div className="bk-item-wrap" data-id={item.id}>
      <button
        id={`bk-${item.id}`}
        className={btnClass}
        draggable
        title={item.title}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isFolder ? (
          <>
            {FOLDER_ICON}
            <span className="bk-label">{item.title}</span>
            {CHEVRON_RIGHT}
          </>
        ) : (
          <>
            {item.favicon
              ? <img src={item.favicon} className="bk-favicon" alt="" onError={e => { e.target.style.display = 'none'; }} />
              : <span className="bk-favicon-placeholder">🔖</span>
            }
            <span className="bk-label">{item.title}</span>
          </>
        )}
      </button>

      <button className="bk-del-btn" title={isFolder ? 'Delete folder' : 'Remove bookmark'} onClick={handleDelete}>
        {DELETE_ICON}
      </button>

      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Folder modal — rendered as a React portal, visible above WebContentsView */}
      {folderOpen && isFolder && (
        <FolderDropdown
          folder={item}
          onClose={handleFolderClose}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}
