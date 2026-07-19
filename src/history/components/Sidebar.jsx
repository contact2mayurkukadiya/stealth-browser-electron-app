import React from 'react';
import { externalLinkSvg, historyGoogleLogoSvg, menuHistorySvg, navReloadSvg, trashSvg } from '../../constants/appAssetUrls';
import { KEYBOARD, HISTORY_VIEW } from '../../constants/conditionStrings.js';
import AssetMaskIcon from '../../components/AssetMaskIcon.jsx';

export default function Sidebar({ activeItem, onDeleteBrowsingData, onRefresh }) {
  return (
    <aside className="h-sidebar" aria-label="History navigation">
      <div className="h-sidebar-brand">
        <img src={historyGoogleLogoSvg} width={20} height={20} alt="" aria-hidden />
        History
      </div>

      <nav>
        <button
          type="button"
          className={`h-nav-item${activeItem === HISTORY_VIEW.CHROME_HISTORY ? ' active' : ''}`}
          aria-current={activeItem === HISTORY_VIEW.CHROME_HISTORY ? 'page' : undefined}
        >
          <AssetMaskIcon icon={menuHistorySvg} size={15} />
          <span className="h-nav-item-label">Search History</span>
          <span
            role="button"
            tabIndex={0}
            className="h-nav-refresh-btn"
            title="Refresh history"
            onClick={(e) => { e.stopPropagation(); onRefresh?.(); }}
            onKeyDown={(e) => { if (e.key === KEYBOARD.ENTER || e.key === KEYBOARD.SPACE) { e.stopPropagation(); onRefresh?.(); } }}
            aria-label="Refresh history"
          >
          <AssetMaskIcon icon={navReloadSvg} size={12} />
          </span>
        </button>

        <button
          type="button"
          className="h-nav-item"
          onClick={onDeleteBrowsingData}
        >
          <AssetMaskIcon icon={trashSvg} size={15} />
          <span className="h-nav-item-label">Delete browsing data</span>
          <span
            role="button"
            tabIndex={0}
            className="h-nav-refresh-btn"
            title="Delete browsing data"
            aria-label="Delete browsing data"
          >
            <AssetMaskIcon icon={externalLinkSvg} size={12} />
          </span>
        </button>
      </nav>
    </aside>
  );
}
