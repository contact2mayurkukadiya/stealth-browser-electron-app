import React from 'react';
import { menuFindSvg } from '../../constants/appAssetUrls.js';
import { escapeHtml } from './useOmniboxController.js';

const SearchIcon = () => (
  <img src={menuFindSvg} className="omnibox-icon" width={16} height={16} alt="" />
);

export default function OmniboxInputZone({
  inputZoneRef,
  inputRef,
  isFocused,
  overlayDelivered,
  draftValue,
  ghostSuffix,
  barDisplayValue,
  displayParts,
  overlayRequested,
  onFocus,
  onBlur,
  onChange,
  onKeyDown,
  onPointerDown,
  onMouseUp,
}) {
  const showShellInput = isFocused && !overlayDelivered;
  const showUrlDisplay = !isFocused && !overlayDelivered && displayParts;
  const showPlaceholder = !isFocused && !overlayDelivered && !displayParts;

  return (
    <div
      ref={inputZoneRef}
      className={`omnibox-input-zone${overlayDelivered ? ' omnibox-overlay-active' : ''}`}
    >
      {showShellInput && (
        <div className="omnibox-icon-wrapper omnibox-icon-wrapper--inline">
          <SearchIcon />
        </div>
      )}

      {showShellInput && ghostSuffix && (
        <div className="omnibox-ghost" aria-hidden="true">
          <span style={{ color: 'transparent' }}>{draftValue}</span>
          <span className="omnibox-ghost__suffix">{ghostSuffix}</span>
        </div>
      )}

      <input
        ref={inputRef}
        id="url-input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={overlayRequested}
        aria-controls="omnibox-suggestions"
        value={draftValue}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onPointerDown={onPointerDown}
        onMouseUp={onMouseUp}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />

      {showUrlDisplay && (
        <div className="url-display" aria-hidden="true">
          {displayParts.prefix && <span>{escapeHtml(displayParts.prefix)}</span>}
          <span className="domain">{escapeHtml(displayParts.domain)}</span>
          {displayParts.suffix && <span>{escapeHtml(displayParts.suffix)}</span>}
        </div>
      )}

      {showPlaceholder && (
        <div className="omnibox-unfocused-placeholder" aria-hidden="true">
          Search or enter address
        </div>
      )}
    </div>
  );
}
