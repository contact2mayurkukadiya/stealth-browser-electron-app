import React, { forwardRef } from 'react';

const REMOVE_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12 1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z" />
  </svg>
);

const ContextMenu = forwardRef(function ContextMenu(
  { x, y, entry, onRemove, onClose },
  ref
) {
  return (
    <div
      ref={ref}
      className="h-context-menu"
      style={{ top: y, left: x }}
      role="menu"
      aria-label="History item actions"
    >
      <button
        type="button"
        className="h-context-item danger"
        role="menuitem"
        onClick={() => onRemove(entry)}
      >
        {REMOVE_ICON}
        Remove from history
      </button>
    </div>
  );
});

export default ContextMenu;
