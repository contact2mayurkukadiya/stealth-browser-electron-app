import React, { useState, useCallback } from 'react';
import AssetMaskIcon from '../../components/AssetMaskIcon';
import { menuDotsVerticalSvg } from '../../constants/appAssetUrls';

function buildFaviconUrl(url) {
  try {
    const domain = new URL(url).hostname;
    if (!domain) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
  } catch {
    return '';
  }
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes !== 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

function GroupEntry({ entry, onOpenEntry }) {
  const [faviconHidden, setFaviconHidden] = useState(false);
  const faviconSrc = buildFaviconUrl(entry.url);

  let displayUrl = entry.url;
  try {
    const u = new URL(entry.url);
    displayUrl = u.hostname + u.pathname;
  } catch { /* keep original */ }

  return (
    <div
      className="h-group-row"
      onClick={() => onOpenEntry(entry.url)}
      role="listitem"
    >
      <div className="h-group-favicon-wrap">
        {faviconSrc && !faviconHidden ? (
          <img
            className="h-group-favicon"
            src={faviconSrc}
            alt=""
            onError={() => setFaviconHidden(true)}
          />
        ) : (
          <span style={{ width: 18, height: 18 }} />
        )}
      </div>
      <div className="h-group-entry-info">
        <div className="h-group-entry-title">{entry.title}</div>
        <div className="h-group-entry-url">{displayUrl}</div>
      </div>
    </div>
  );
}

export default function GroupCard({ groupTitle, entries, onOpenEntry, onOpenContextMenu }) {
  const firstEntry = entries[0];

  const handleMoreClick = useCallback((e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    // Pass the first (most-recent) entry as context anchor
    onOpenContextMenu(rect, firstEntry);
  }, [firstEntry, onOpenContextMenu]);

  return (
    <article className="h-group-card">
      <header className="h-group-header">
        <h3 className="h-group-title">"{groupTitle}"</h3>
        <span className="h-group-time">{getTimeAgo(firstEntry.timestamp)}</span>
        <button
          type="button"
          className="h-more-btn"
          aria-label="More actions"
          onClick={handleMoreClick}
        >
          <AssetMaskIcon icon={menuDotsVerticalSvg} size={18} />
        </button>
      </header>

      <div role="list">
        {entries.map((entry) => (
          <GroupEntry
            key={entry.visitId || `${entry.timestamp}-${entry.url}`}
            entry={entry}
            onOpenEntry={onOpenEntry}
          />
        ))}
      </div>
    </article>
  );
}
