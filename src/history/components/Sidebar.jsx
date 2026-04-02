import React from 'react';

const CLOCK_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" />
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

const GOOGLE_HISTORY_LOGO = (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="24" fill="#4285F4" />
    <path d="M24 13a11 11 0 1 0 0 22 11 11 0 0 0 0-22zm.5 5v7l5.25 3.15-.75 1.23L23 25V18h1.5z" fill="#fff" />
  </svg>
);

export default function Sidebar({ activeItem, onDeleteBrowsingData }) {
  return (
    <aside className="h-sidebar" aria-label="History navigation">
      <div className="h-sidebar-brand">
        {GOOGLE_HISTORY_LOGO}
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
