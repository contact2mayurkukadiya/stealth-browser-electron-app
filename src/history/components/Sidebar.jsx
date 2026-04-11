import React from 'react';
import { historyGoogleLogoSvg } from '../../constants/appAssetUrls';

const CLOCK_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" />
  </svg>
);

const REFRESH_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.418 0-7.993 3.582-7.993 8s3.575 8 7.993 8c3.73 0 6.847-2.56 7.73-6h-2.08A5.988 5.988 0 0 1 12 18c-3.314 0-6-2.686-6-6s2.686-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
  </svg>
);

const TRASH_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
  </svg>
);

const EXT_LINK_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-nav-item-ext">
    <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
  </svg>
);

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
          className={`h-nav-item${activeItem === 'chrome-history' ? ' active' : ''}`}
          aria-current={activeItem === 'chrome-history' ? 'page' : undefined}
        >
          {CLOCK_ICON}
          <span className="h-nav-item-label">Chrome history</span>
          <span
            role="button"
            tabIndex={0}
            className="h-nav-refresh-btn"
            title="Refresh history"
            onClick={(e) => { e.stopPropagation(); onRefresh?.(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onRefresh?.(); } }}
            aria-label="Refresh history"
          >
            {REFRESH_ICON}
          </span>
        </button>

        <button
          type="button"
          className="h-nav-item"
          onClick={onDeleteBrowsingData}
        >
          {TRASH_ICON}
          <span className="h-nav-item-label">Delete browsing data</span>
          {EXT_LINK_ICON}
        </button>
      </nav>
    </aside>
  );
}
