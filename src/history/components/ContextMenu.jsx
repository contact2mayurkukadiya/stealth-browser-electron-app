import React, { forwardRef } from 'react';
import { trashSvg } from '../../constants/appAssetUrls';
import AssetMaskIcon from '../../components/AssetMaskIcon';

const ContextMenu = forwardRef(function ContextMenu(
  { x, y, entry, onRemove, onClose },
  ref
) {
  return (
    <div
      ref={ref}
      className="h-context-menu"
      style={{ top: y, left: x }}
      role="menu"
      aria-label="History item actions"
    >
      <button
        type="button"
        className="h-context-item danger"
        role="menuitem"
        onClick={() => onRemove(entry)}
      >
        <AssetMaskIcon icon={trashSvg} size={16} />
        Remove from history
      </button>
    </div>
  );
});

export default ContextMenu;
