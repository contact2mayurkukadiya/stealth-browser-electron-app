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
          <button
            key={i}
            className={`bk-context-item${item.danger ? ' danger' : ''}`}
            onClick={() => { item.action(); onClose(); }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body
  );
}
