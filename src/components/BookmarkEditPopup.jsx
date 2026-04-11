import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { setBookmarks } from '../store/bookmarksSlice';

/** Recursively collect all folder nodes for the <select> list. */
function collectFolders(list, prefix = '') {
  const result = [];
  for (const item of list) {
    if (item.type === 'folder') {
      result.push({ id: item.id, title: prefix + item.title });
      if (item.children?.length) {
        result.push(...collectFolders(item.children, prefix + '  '));
      }
    }
  }
  return result;
}

/**
 * Centered modal dialog for adding / editing / removing a bookmark.
 *
 * Rendered via React portal so it mounts at document.body.
 * The parent (NavBar) uses TabOverlayContext: beginOverlay before mount and
 * endOverlay in onClose so the tab snapshot + hide stay paired.
 *
 * Closing triggers:
 *   - Click on the semi-transparent backdrop.
 *   - Escape key.
 *   - "Done" or "Remove" button.
 *
 * Props:
 *   data    – { id?, title, url, favicon, folderId } of the bookmark.
 *   onClose – called when the dialog should dismiss (parent restores tab).
 */
export default function BookmarkEditPopup({ data, onClose }) {
  const dispatch = useDispatch();
  const bookmarksData = useSelector(s => s.bookmarks.data);

  const [name, setName] = useState(data.title || '');
  const [folderId, setFolderId] = useState(data.folderId || 'root');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const nameInputRef = useRef(null);
  const newFolderInputRef = useRef(null);

  const folders = collectFolders(bookmarksData.bar);

  // Auto-focus the name field when the dialog opens
  useEffect(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, []);

  // Auto-focus the new-folder input when its sub-dialog appears
  useEffect(() => {
    if (showNewFolder) newFolderInputRef.current?.focus();
  }, [showNewFolder]);

  // Escape key → close
  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // ── Folder <select> ────────────────────────────────────────────────────────
  const handleFolderChange = (e) => {
    const val = e.target.value;
    if (val === '__new_folder__') {
      setShowNewFolder(true);
    } else {
      setFolderId(val);
    }
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const item = {
      id: data.id || ('bk-' + Date.now()),
      type: 'bookmark',
      title: name.trim() || data.url,
      url: data.url,
      favicon: data.favicon ?? null,
    };
    try {
      const result = folderId === 'root'
        ? await window.electronAPI.bookmarksAdd(item)
        : await window.electronAPI.bookmarksAddToFolder(folderId, item);
      dispatch(setBookmarks(result));
    } catch (err) {
      console.error('BookmarkEditPopup: failed to save bookmark', err);
    }
    onClose();
  }, [data, name, folderId, dispatch, onClose]);

  // ── Remove ─────────────────────────────────────────────────────────────────
  const handleRemove = useCallback(async () => {
    if (!data.id) { onClose(); return; }
    try {
      const result = await window.electronAPI.bookmarksRemove(data.id);
      dispatch(setBookmarks(result));
    } catch (err) {
      console.error('BookmarkEditPopup: failed to remove bookmark', err);
    }
    onClose();
  }, [data.id, dispatch, onClose]);

  // ── Create new folder ──────────────────────────────────────────────────────
  const handleCreateFolder = useCallback(async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const result = await window.electronAPI.bookmarksAddFolder(trimmed);
    dispatch(setBookmarks(result));
    // Select the newly created folder
    const lastFolder = [...result.bar].reverse().find(i => i.type === 'folder');
    if (lastFolder) setFolderId(lastFolder.id);
    setShowNewFolder(false);
    setNewFolderName('');
  }, [newFolderName, dispatch]);

  const cancelNewFolder = useCallback(() => {
    setShowNewFolder(false);
    setNewFolderName('');
  }, []);

  return ReactDOM.createPortal(
    // Backdrop — mousedown closes the modal
    <div className="bk-modal-backdrop" onMouseDown={onClose}>
      {/* Card — stop propagation so clicks inside don't close via backdrop */}
      <div
        className="bk-modal-card bk-edit-popup"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="bk-edit-form">
          {/* Name field */}
          <div className="bk-edit-field">
            <label className="bk-edit-label">Name</label>
            <input
              ref={nameInputRef}
              className="bk-edit-input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
              placeholder="Bookmark name"
            />
          </div>

          {/* Folder select */}
          <div className="bk-edit-field">
            <label className="bk-edit-label">Folder</label>
            <select
              className="bk-edit-select"
              value={folderId}
              onChange={handleFolderChange}
            >
              <option value="root">Bookmark bar</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>{f.title}</option>
              ))}
              <option value="__new_folder__">+ Create new folder…</option>
            </select>
          </div>

          {/* Actions */}
          <div className="bk-edit-actions">
            <button className="bk-edit-btn bk-edit-btn--danger" onClick={handleRemove}>
              Remove
            </button>
            <button className="bk-edit-btn bk-edit-btn--primary" onClick={handleSave}>
              Done
            </button>
          </div>
        </div>

        {/* New-folder inline sub-dialog */}
        {showNewFolder && (
          <div className="bk-edit-new-folder-overlay">
            <div className="bk-edit-new-folder-dialog">
              <span className="bk-edit-label">New Folder Name</span>
              <input
                ref={newFolderInputRef}
                className="bk-edit-input"
                type="text"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') cancelNewFolder();
                }}
                placeholder="Enter folder name…"
              />
              <div className="bk-edit-actions">
                <button className="bk-edit-btn bk-edit-btn--secondary" onClick={cancelNewFolder}>
                  Cancel
                </button>
                <button className="bk-edit-btn bk-edit-btn--primary" onClick={handleCreateFolder}>
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
