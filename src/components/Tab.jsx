import React, { useCallback } from 'react';
import { useTabDrag } from '../hooks/useTabDrag';
import { tabCloseSvg, tabStealthSvg } from '../constants/appAssetUrls';

const DEFAULT_FAVICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2NjYyI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTAgMThjLTQuNDEgMC04LTMuNTktOC04czMuNTktOCA4LTggOCAzLjU5IDggOC0zLjU5IDgtOCA4eiIvPjwvc3ZnPg==';

export default function Tab({
  id, tab, isActive,
  onClose, onSwitch, onDragEnd,
  onHoverEnter, onHoverLeave, onHideTooltip,
  onContextMenu,
  displayMode = 'full',
  pinnedTabCount = 0,
}) {
  const { url, title, favicon, isNewTab, isStealth, isLoading, isPinned } = tab || {};

  const handleSwitchTab = useCallback((tabId) => onSwitch(tabId), [onSwitch]);
  const handleDragEnd = useCallback((ids) => onDragEnd(ids), [onDragEnd]);

  const tabRef = useTabDrag({
    id,
    onSwitchTab: handleSwitchTab,
    onDragEnd: handleDragEnd,
    onHideTooltip,
    isPinned: !!isPinned,
    pinnedTabCount,
    isActive,
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

  const handleContextMenu = (e) => {
    e.preventDefault();
    onHideTooltip();
    if (onContextMenu) onContextMenu(e, id);
  };

  const className = [
    'tab',
    isActive ? 'active' : '',
    isStealth ? 'stealth-tab' : '',
    isPinned ? 'tab--pinned' : '',
    `tab--mode-${displayMode}`,
  ].filter(Boolean).join(' ');

  return (
    <div
      id={id}
      ref={tabRef}
      className={className}
      data-tab-id={id}
      onMouseEnter={handleHoverEnter}
      onMouseLeave={onHoverLeave}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
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
        {isStealth && (
          <img src={tabStealthSvg} className="tab-stealth-icon" width={13} height={13} alt="" />
        )}
        {title || 'New Tab'}
      </div>

      {/* Close button */}
      <div className="close-btn" onClick={handleClose}>
        <img src={tabCloseSvg} className="tab-close-icon chrome-toolbar-icon-img" width={12} height={12} alt="" />
      </div>
    </div>
  );
}
