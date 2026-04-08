import React from 'react';
import ReactDOM from 'react-dom';

export default function ContextMenu({ items, x, y, onClose }) {
  if (!items || items.length === 0) return null;

  return ReactDOM.createPortal(
    <>
      {/* Invisible backdrop to catch outside clicks */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 999 }}
        onMouseDown={onClose}
      />
      <div
        className="bk-context-menu"
        style={{ left: x, top: y, zIndex: 1000 }}
        onMouseDown={e => e.stopPropagation()}
      >
        {items.map((item, i) => (
          item.type === 'separator' ? (
            <div key={i} className="bk-context-separator" role="separator" />
          ) : (
            <button
              key={i}
              type="button"
              className={`bk-context-item${item.danger ? ' danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                if (!item.disabled && item.action) {
                  item.action();
                  onClose();
                }
              }}
            >
              {item.label}
            </button>
          )
        ))}
      </div>
    </>,
    document.body
  );
}
