import React, { useState, useRef, useCallback, useEffect } from 'react';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildDisplayParts(url) {
  if (!url || url.startsWith('app://') || url === 'New Tab') return null;
  try {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol + '//';
    let displayUrl = url.replace(protocol, '');
    if (displayUrl.endsWith('/') && displayUrl.split('/').length === 2) {
      displayUrl = displayUrl.slice(0, -1);
    }
    const domain = urlObj.hostname;
    const idx = displayUrl.indexOf(domain);
    if (idx === -1) return { prefix: '', domain: displayUrl, suffix: '' };
    return {
      prefix: displayUrl.substring(0, idx),
      domain,
      suffix: displayUrl.substring(idx + domain.length),
    };
  } catch {
    return { prefix: '', domain: url, suffix: '' };
  }
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
    if (e.key === 'Enter' && currentTabId) {
      window.electronAPI.navigate(currentTabId, inputValue);
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
