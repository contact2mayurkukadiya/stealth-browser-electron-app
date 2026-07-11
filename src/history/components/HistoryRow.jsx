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

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoryRow({
  entry,
  isSelected,
  onToggleSelect,
  onOpenEntry,
  onOpenContextMenu,
}) {
  const [faviconHidden, setFaviconHidden] = useState(false);

  const handleRowClick = useCallback((e) => {
    // Don't navigate when clicking checkbox or more button
    if (e.target.closest('.h-row-checkbox') || e.target.closest('.h-more-btn')) return;
    onOpenEntry(entry.url);
  }, [entry.url, onOpenEntry]);

  const handleMoreClick = useCallback((e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    onOpenContextMenu(rect, entry);
  }, [entry, onOpenContextMenu]);

  const domain = extractDomain(entry.url);
  const faviconSrc = buildFaviconUrl(entry.url);

  return (
    <div className="h-row" onClick={handleRowClick} role="row">
      <input
        type="checkbox"
        className="h-row-checkbox"
        checked={isSelected}
        onChange={() => onToggleSelect(entry.visitId)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select "${entry.title}"`}
      />

      <span className="h-row-time">{formatTime(entry.timestamp)}</span>

      {faviconSrc && !faviconHidden ? (
        <img
          className="h-row-favicon"
          src={faviconSrc}
          alt=""
          onError={() => setFaviconHidden(true)}
        />
      ) : (
        <span className="h-row-favicon" aria-hidden="true" />
      )}

      <span className="h-row-details" title={entry.url}>
        <span className="h-row-title">{entry.title}</span>
        <span className="h-row-domain">{domain}</span>
      </span>

      <button
        type="button"
        className="h-more-btn"
        aria-label="More actions"
        onClick={handleMoreClick}
      >
        <AssetMaskIcon icon={menuDotsVerticalSvg} size={18} />
      </button>
    </div>
  );
}
