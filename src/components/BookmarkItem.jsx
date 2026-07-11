import React, { useState, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { setBookmarks } from '../store/bookmarksSlice';
import { BOOKMARK } from '../constants/conditionStrings.js';
import { angleRightSvg, folderSvg, trashSvg } from '../constants/appAssetUrls.js';
import AssetMaskIcon from './AssetMaskIcon.jsx';

// ─── Icon ────────────────────────────────────────────────────────────────────
const FOLDER_ICON = <AssetMaskIcon icon={folderSvg} size={16} />;

const CHEVRON_RIGHT = <AssetMaskIcon icon={angleRightSvg} size={16} />;

export default function BookmarkItem({
  item,
  dragSrcIdRef,
  bookmarksData,
  onNavigate,
  onBookmarkContextMenu,
  onOpenFolderMenu,
  onDismissFolderMenuOnDrag,
}) {
  const dispatch = useDispatch();
  const [isDragOver, setIsDragOver] = useState(false);

  const isFolder = item.type === BOOKMARK.TYPE_FOLDER;

  const handleDragStart = (e) => {
    onDismissFolderMenuOnDrag?.();
    dragSrcIdRef.current = item.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
    setTimeout(() => e.target.classList.add('dragging'), 0);
  };
  const handleDragEnd = (e) => {
    e.target.classList.remove('dragging');
    setIsDragOver(false);
  };

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

    const srcItem = bookmarksData.bar.find(b => b.id === srcId);
    if (!srcItem) return;

    if (isFolder && srcItem.type !== BOOKMARK.TYPE_FOLDER) {
      await window.electronAPI.bookmarksAddToFolder(item.id, srcItem);
    } else {
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

  const handleClick = useCallback((e) => {
    e.stopPropagation();
    if (isFolder) {
      if (typeof onOpenFolderMenu === 'function') {
        void onOpenFolderMenu(e, item);
      }
    } else {
      onNavigate(item.url);
    }
  }, [isFolder, onNavigate, item, onOpenFolderMenu]);

  const handleDelete = async (e) => {
    e.stopPropagation();
    const data = await window.electronAPI.bookmarksRemove(item.id);
    dispatch(setBookmarks(data));
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    if (typeof onBookmarkContextMenu !== 'function') return;
    void onBookmarkContextMenu(e, item, isFolder);
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
    </div>
  );
}
