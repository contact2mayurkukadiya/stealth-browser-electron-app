import React, { useState, useRef, useCallback, useEffect } from 'react';
import { buildDisplayParts } from '../utils/omniboxDisplayUrl.js';
import { KEYBOARD, NAV_SOURCE } from '../constants/conditionStrings.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default function UrlBar({ currentTabId, tabsData }) {
  const tab = tabsData[currentTabId];
  const displayUrl = tab && !tab.isNewTab ? (tab.url || '') : '';

  const [isFocused, setIsFocused] = useState(false);
  const [inputValue, setInputValue] = useState(displayUrl);
  const inputRef = useRef(null);
  const didSelectRef = useRef(false);

  // Sync input value whenever the active tab's URL changes (blur state)
  useEffect(() => {
    if (!isFocused) setInputValue(displayUrl);
  }, [displayUrl, isFocused]);

  const handleFocus = () => {
    setIsFocused(true);
    didSelectRef.current = false;
    // Select all on focus (first interaction)
    setTimeout(() => {
      if (inputRef.current && !didSelectRef.current) {
        inputRef.current.select();
        didSelectRef.current = true;
      }
    }, 0);
  };

  const handleMouseUp = (e) => {
    // If user clicks into already-focused URL bar, allow cursor placement
    if (isFocused && didSelectRef.current) {
      didSelectRef.current = false; // don't re-select; let browser place caret
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    setInputValue(displayUrl);
    if (inputRef.current) inputRef.current.setSelectionRange(0, 0);
  };

  const handleKeyDown = (e) => {
    if (e.key === KEYBOARD.ENTER && currentTabId) {
      window.electronAPI.navigate(currentTabId, inputValue, { source: NAV_SOURCE.TYPED });
      inputRef.current?.blur();
    }
  };

  const parts = buildDisplayParts(displayUrl);

  return (
    <div className="url-container">
      <input
        ref={inputRef}
        id="url-input"
        type="text"
        placeholder="Search or enter address"
        value={inputValue}
        onChange={e => setInputValue(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onMouseUp={handleMouseUp}
        onKeyDown={handleKeyDown}
      />
      {!isFocused && parts && (
        <div className="url-display">
          {parts.prefix && <span>{escapeHtml(parts.prefix)}</span>}
          <span className="domain">{escapeHtml(parts.domain)}</span>
          {parts.suffix && <span>{escapeHtml(parts.suffix)}</span>}
        </div>
      )}
    </div>
  );
}
