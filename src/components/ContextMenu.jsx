import React from 'react';
import ReactDOM from 'react-dom';

export default function ContextMenu({ items, x, y, onClose, variant = 'default' }) {
  if (!items || items.length === 0) return null;
  const isTabVariant = variant === 'tab';
  const menuClassName = `bk-context-menu${isTabVariant ? ' bk-context-menu--tab' : ''}`;
  const separatorClassName = `bk-context-separator${isTabVariant ? ' bk-context-separator--tab' : ''}`;
  const itemClassBase = `bk-context-item${isTabVariant ? ' bk-context-item--tab' : ''}`;

  return ReactDOM.createPortal(
    <>
      {/* Invisible backdrop to catch outside clicks */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 999 }}
        onMouseDown={onClose}
      />
      <div
        className={menuClassName}
        style={{ left: x, top: y, zIndex: 1000 }}
        onMouseDown={e => e.stopPropagation()}
      >
        {items.map((item, i) => (
          item.type === 'separator' ? (
            <div key={i} className={separatorClassName} role="separator" />
          ) : (
            <button
              key={i}
              type="button"
              className={`${itemClassBase}${item.danger ? ' danger' : ''}`}
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
