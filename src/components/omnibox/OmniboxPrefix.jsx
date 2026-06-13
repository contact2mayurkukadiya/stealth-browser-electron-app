import React from 'react';
import { menuFindSvg } from '../../constants/appAssetUrls.js';

function ActionIcon({ action }) {
  return action.iconSrc ? (
    <img src={action.iconSrc} className="omnibox-icon" width={16} height={16} alt="" />
  ) : null;
}


export default function OmniboxPrefix({ actions, popup, onActionClick }) {
  const prefixActions = actions.filter((a) => a.slot === 'prefix');
  if (prefixActions.length === 0) return null;

  return (
    <div className="omnibox-prefix" aria-hidden={false}>
      {prefixActions.map((action) => {
        
        if (action.nonClickable) {
          return (
            <div
              key={action.id}
              className={`omnibox-static-prefix omnibox-search-chip`}
            >
              <ActionIcon action={action} />
              {action.chipText && <span className="omnibox-chip-text">{action.chipText}</span>}
            </div>
          );
        }
        
        return (<button
          key={action.id}
          type="button"
          className={`omnibox-action-btn omnibox-action-btn--prefix${popup === action.opensPopup ? ' omnibox-action-btn--active' : ''}`}
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
        </button>)
      })}
    </div>
  );
}
