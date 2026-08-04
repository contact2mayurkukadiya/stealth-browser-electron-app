import React, { useState, useCallback } from 'react';
import AssetMaskIcon from '../../components/AssetMaskIcon';
import { menuDotsVerticalSvg, folderSvg } from '../../constants/appAssetUrls'; // Ensure folderSvg is exported

function buildFaviconUrl(url) {
  if (!url) return '';
  try {
    const domain = new URL(url).hostname;
    if (!domain) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
  } catch {
    return '';
  }
}

export default function BookmarkRow({
  entry,
  isSelected,
  onToggleSelect,
  onOpenEntry,
  onOpenFolder,
  onOpenContextMenu,
}) {
  const [faviconHidden, setFaviconHidden] = useState(false);
  const isFolder = !entry.url; // Entries without a URL behave like folders

  const handleRowClick = useCallback((e) => {
    if (e.target.closest('.b-more-btn')) return;
    onToggleSelect(entry.id);
  }, [entry.id, onToggleSelect]);

  const handleRowDoubleClick = useCallback((e) => {
    if (e.target.closest('.b-more-btn')) return;

    if (isFolder) {
      onOpenFolder(entry);
    } else if (entry.url) {
      onOpenEntry(entry.url);
    }
  }, [entry, isFolder, onOpenEntry, onOpenFolder]);

  const handleMoreClick = useCallback((e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    onOpenContextMenu(rect, entry);
  }, [entry, onOpenContextMenu]);

  const faviconSrc = buildFaviconUrl(entry.url);

  return (
    <div
      className={`b-row${isSelected ? ' selected' : ''}`}
      onClick={handleRowClick}
      onDoubleClick={handleRowDoubleClick}
      role="row"
    >
      {isFolder ? (
        <AssetMaskIcon icon={folderSvg} size={16} className="b-row-folder-icon" />
      ) : faviconSrc && !faviconHidden ? (
        <img
          className="b-row-favicon"
          src={faviconSrc}
          alt=""
          onError={() => setFaviconHidden(true)}
        />
      ) : (
        <span className="b-row-favicon" aria-hidden="true" />
      )}

      <span className="b-row-details" title={entry.url || entry.title}>
        <span className="b-row-title">{entry.title}</span>
        {!isFolder && <span className="b-row-domain">{entry.url}</span>}
      </span>

      <button
        type="button"
        className="b-more-btn"
        aria-label="More actions"
        onClick={handleMoreClick}
      >
        <AssetMaskIcon icon={menuDotsVerticalSvg} size={18} />
      </button>
    </div>
  );
}