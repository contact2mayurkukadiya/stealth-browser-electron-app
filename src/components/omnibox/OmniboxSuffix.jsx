import React from 'react';
import { menuFindSvg } from '../../constants/appAssetUrls.js';

function ActionIcon({ action }) {
  if (action.iconSrc) {
    return (
      <img
        src={action.iconSrc}
        className="omnibox-icon"
        width={16}
        height={16}
        alt=""
      />
    );
  }
  return (
    <img src={menuFindSvg} className="omnibox-icon" width={16} height={16} alt="" />
  );
}

export default function OmniboxSuffix({ actions, popup, onActionClick }) {
  const suffixActions = actions.filter((a) => a.slot === 'suffix');
  if (suffixActions.length === 0) return null;

  return (
    <div className="omnibox-suffix">
      {suffixActions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={`omnibox-action-btn omnibox-action-btn--suffix${popup === action.opensPopup ? ' omnibox-action-btn--active' : ''}`}
          title={action.title}
          aria-label={action.title}
          aria-expanded={popup === action.opensPopup}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => onActionClick(action, e)}
        >
          <ActionIcon action={action} />
        </button>
      ))}
    </div>
  );
}
