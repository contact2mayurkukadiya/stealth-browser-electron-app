import React, { useCallback } from 'react';
import { useTabDrag } from '../hooks/useTabDrag';

const DEFAULT_FAVICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMThjLTQuNDEgMC04LTMuNTktOC04czMuNTktOCA4LTggOCAzLjU5IDggOC0zLjU5IDgtOCA4eiIvPjwvc3ZnPg==';

const STEALTH_ICON = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="13" height="13" style={{ marginRight: 4, flexShrink: 0 }}>
    <path fill="white" d="M320 128C96 128 32 224 32 336C32 448 112 512 208 512L216.4 512C240.6 512 262.8 498.3 273.6 476.6L296.8 430.3C301.2 421.5 310.1 416 320 416C329.9 416 338.8 421.5 343.2 430.3L366.4 476.6C377.2 498.3 399.4 512 423.6 512L432 512C528 512 608 448 608 336C608 224 544 128 320 128zM128 320C128 284.7 156.7 256 192 256C227.3 256 256 284.7 256 320C256 355.3 227.3 384 192 384C156.7 384 128 355.3 128 320zM448 256C483.3 256 512 284.7 512 320C512 355.3 483.3 384 448 384C412.7 384 384 355.3 384 320C384 284.7 412.7 256 448 256z" />
  </svg>
);

const CLOSE_ICON = (
  <svg width={20} height={20} viewBox="0 0 640 640">
    <path fill="white" d="M183.1 137.4C170.6 124.9 150.3 124.9 137.8 137.4C125.3 149.9 125.3 170.2 137.8 182.7L275.2 320L137.9 457.4C125.4 469.9 125.4 490.2 137.9 502.7C150.4 515.2 170.7 515.2 183.2 502.7L320.5 365.3L457.9 502.6C470.4 515.1 490.7 515.1 503.2 502.6C515.7 490.1 515.7 469.8 503.2 457.3L365.8 320L503.1 182.6C515.6 170.1 515.6 149.8 503.1 137.3C490.6 124.8 470.3 124.8 457.8 137.3L320.5 274.7L183.1 137.4z" />
  </svg>
);

export default function Tab({
  id, tab, isActive,
  onClose, onSwitch, onDragEnd,
  onHoverEnter, onHoverLeave, onHideTooltip,
}) {
  const { url, title, favicon, isNewTab, isStealth, isLoading } = tab || {};

  const handleSwitchTab = useCallback((tabId) => onSwitch(tabId), [onSwitch]);
  const handleDragEnd = useCallback((ids) => onDragEnd(ids), [onDragEnd]);

  const tabRef = useTabDrag({
    id,
    onSwitchTab: handleSwitchTab,
    onDragEnd: handleDragEnd,
    onHideTooltip,
  });

  // Resolve favicon to display
  const resolvedFavicon = (() => {
    if (isLoading) return null;
    if (favicon) return favicon;
    if (url && url.includes('google.com')) return 'https://www.google.com/favicon.ico';
    return DEFAULT_FAVICON;
  })();

  const handleClose = (e) => {
    e.stopPropagation();
    onHideTooltip();
    onClose();
  };

  const handleHoverEnter = () => {
    if (tabRef.current) onHoverEnter(id, tabRef.current);
  };

  // Middle-click to close
  const handleMouseDown = (e) => {
    if (e.button === 1) { e.preventDefault(); onHideTooltip(); onClose(); }
  };

  const className = ['tab', isActive ? 'active' : '', isStealth ? 'stealth-tab' : ''].filter(Boolean).join(' ');

  return (
    <div
      id={id}
      ref={tabRef}
      className={className}
      onMouseEnter={handleHoverEnter}
      onMouseLeave={onHoverLeave}
      onMouseDown={handleMouseDown}
    >
      {/* Icon / Spinner */}
      <div className="icon-container">
        {isLoading
          ? <div className="spinner" />
          : <img src={resolvedFavicon} className="tab-icon" alt="" onError={e => { e.target.src = DEFAULT_FAVICON; }} />
        }
      </div>

      {/* Title */}
      <div className="tab-title">
        {isStealth && STEALTH_ICON}
        {title || 'New Tab'}
      </div>

      {/* Close button */}
      <div className="close-btn" onClick={handleClose}>
        {CLOSE_ICON}
      </div>
    </div>
  );
}
