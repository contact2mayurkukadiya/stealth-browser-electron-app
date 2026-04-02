import React, { useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';

const FOLDER_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 640 640">
    <path
      fill="currentColor"
      opacity="0.7"
      d="M128 512L512 512C547.3 512 576 483.3 576 448L576 208C576 172.7 547.3 144 512 144L362.7 144C355.8 144 349 141.8 343.5 137.6L305.1 108.8C294 100.5 280.5 96 266.7 96L128 96C92.7 96 64 124.7 64 160L64 448C64 483.3 92.7 512 128 512z"
    />
  </svg>
);

/**
 * Modal dialog that shows a bookmark folder's children.
 *
 * Rendered via React portal so it mounts at document.body.
 * The parent component is responsible for calling tabHideActive() before
 * mounting and tabRestoreActive() after unmounting (via onClose).
 *
 * Closing triggers:
 *   - Click on the semi-transparent backdrop.
 *   - Escape key.
 *
 * Props:
 *   folder     – bookmark folder item { id, title, children[] }
 *   onClose    – called when the dialog should dismiss (parent restores tab)
 *   onNavigate – called with a URL when the user clicks a bookmark item
 */
export default function FolderDropdown({ folder, onClose, onNavigate }) {
  // Escape key → close
  useEffect(() => {
    const handleKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleItemClick = useCallback((child) => {
    if (child.type === 'bookmark') {
      onNavigate(child.url);
      onClose();
    }
    // Sub-folder navigation: no-op for now
  }, [onNavigate, onClose]);

  return ReactDOM.createPortal(
    // Backdrop — mousedown closes the modal so the click doesn't propagate further
    <div className="bk-modal-backdrop" onMouseDown={onClose}>
      {/* Card — stop propagation so clicks inside don't close via backdrop */}
      <div
        className="bk-modal-card bk-folder-modal"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bk-folder-modal-header">
          {FOLDER_ICON}
          <span className="bk-folder-modal-title">{folder.title}</span>
        </div>

        {/* Bookmark list */}
        <div className="bk-folder-modal-list">
          {folder.children.length === 0 ? (
            <div className="bk-dropdown-empty">This folder is empty</div>
          ) : (
            folder.children.map(child => (
              <button
                key={child.id}
                className="bk-dropdown-item"
                onClick={() => handleItemClick(child)}
              >
                <span className="bk-dropdown-item-icon" aria-hidden="true">
                  {child.type === 'folder'
                    ? FOLDER_ICON
                    : child.favicon
                      ? (
                        <img
                          src={child.favicon}
                          width={14}
                          height={14}
                          alt=""
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                      )
                      : <span className="bk-favicon-placeholder">🔖</span>
                  }
                </span>
                <span className="bk-dropdown-item-label">{child.title}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
