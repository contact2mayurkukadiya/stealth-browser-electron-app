import React, {
  useState, useRef, useCallback, useEffect, useMemo,
} from 'react';
import ReactDOM from 'react-dom';
import './omnibox.css';
import AutocompleteController from './AutocompleteController.js';
import { toNavigateUrl } from './AutocompleteInput.js';
import { useTabOverlay } from '../../context/TabOverlayContext.jsx';

// ── SVG icons ──────────────────────────────────────────────────────────────

const SearchIcon = () => (
  <svg className="omnibox-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" />
    <line x1="16.5" y1="16.5" x2="22" y2="22" />
  </svg>
);

const LockIcon = () => (
  <svg className="omnibox-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const GlobeIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="omnibox-row__type-icon">
    <circle cx="8" cy="8" r="6.5" />
    <path d="M8 1.5C8 1.5 5.5 4.5 5.5 8s2.5 6.5 2.5 6.5M8 1.5C8 1.5 10.5 4.5 10.5 8S8 14.5 8 14.5M1.5 8h13" />
  </svg>
);

const HistoryIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="omnibox-row__type-icon">
    <circle cx="8" cy="8" r="6.5" />
    <polyline points="8,4.5 8,8 10.5,10" />
  </svg>
);

const SearchRowIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="omnibox-row__type-icon">
    <circle cx="7" cy="7" r="4.5" />
    <line x1="10.5" y1="10.5" x2="14" y2="14" />
  </svg>
);

const BookmarkIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" className="omnibox-row__type-icon">
    <path d="M3 2h10v13l-5-3-5 3V2z" />
  </svg>
);

const KeywordIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="omnibox-row__type-icon">
    <path d="M2 8h5M9 8h5M8 2v5M8 9v5" />
  </svg>
);

// ── Helper utilities ───────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

/**
 * Wraps matched substrings in the suggestion text with <strong>.
 * Returns an array of React elements / strings.
 */
function highlightMatches(text, query) {
  if (!query || !text) return [text];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts = [];
  let lastIndex = 0;
  let searchFrom = 0;

  while (searchFrom < lowerText.length) {
    const matchIdx = lowerText.indexOf(lowerQuery, searchFrom);
    if (matchIdx === -1) break;

    if (matchIdx > lastIndex) {
      parts.push(text.slice(lastIndex, matchIdx));
    }
    parts.push(<strong key={matchIdx}>{text.slice(matchIdx, matchIdx + lowerQuery.length)}</strong>);
    lastIndex = matchIdx + lowerQuery.length;
    searchFrom = lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

function getTypeIcon(type) {
  switch (type) {
    case 'history':  return <HistoryIcon />;
    case 'search':   return <SearchRowIcon />;
    case 'bookmark': return <BookmarkIcon />;
    case 'keyword':  return <KeywordIcon />;
    default:         return <GlobeIcon />;
  }
}

// ── OmniboxInput component ─────────────────────────────────────────────────

export default function OmniboxInput({ currentTabId, tabsData, searchEngine = 'google' }) {
  const tab = tabsData[currentTabId];
  const displayUrl = tab && !tab.isNewTab ? (tab.url || '') : '';

  const { beginOverlay, endOverlay } = useTabOverlay();

  const [isFocused, setIsFocused]         = useState(false);
  const [inputValue, setInputValue]       = useState(displayUrl);
  const [suggestions, setSuggestions]     = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [ghostSuffix, setGhostSuffix]     = useState('');
  const [showDropdown, setShowDropdown]   = useState(false);
  // Snapshot of the container rect for portal positioning
  const [dropdownRect, setDropdownRect]   = useState(null);

  const inputRef        = useRef(null);
  const containerRef    = useRef(null);
  const dropdownRef     = useRef(null);
  const didSelectRef    = useRef(false);
  const isNavigatingRef = useRef(false);
  // Tracks whether this component currently holds an overlay from focus (paired with blur)
  const overlayActiveRef = useRef(false);

  // Single controller instance for the component lifetime
  const controller = useMemo(() => new AutocompleteController(), []);
  useEffect(() => () => controller.dispose(), [controller]);

  // ── Overlay helpers — paired with blur / dropdown close ───────────────
  const deactivateOverlay = useCallback(() => {
    if (!overlayActiveRef.current) return;
    overlayActiveRef.current = false;
    endOverlay();
  }, [endOverlay]);

  // Ensure overlay is released on unmount
  useEffect(() => () => deactivateOverlay(), [deactivateOverlay]);

  // ── Sync URL from Redux when the active tab navigates ─────────────────
  useEffect(() => {
    if (!isFocused) {
      setInputValue(displayUrl);
    }
  }, [displayUrl, isFocused]);

  // ── Capture container rect whenever the dropdown becomes visible ───────
  // This gives the portal the correct fixed coordinates.
  useEffect(() => {
    if (showDropdown && containerRef.current) {
      setDropdownRect(containerRef.current.getBoundingClientRect());
    } else {
      setDropdownRect(null);
    }
  }, [showDropdown]);

  // ── Dismiss on outside click (checks both container & portal dropdown) ─
  useEffect(() => {
    if (!showDropdown) return undefined;

    const onMouseDown = (e) => {
      const inContainer = containerRef.current?.contains(e.target);
      const inDropdown  = dropdownRef.current?.contains(e.target);
      if (!inContainer && !inDropdown) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showDropdown]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Run autocomplete query on every keystroke ──────────────────────────
  const runQuery = useCallback((text) => {
    if (!text.trim()) {
      setSuggestions([]);
      setGhostSuffix('');
      setShowDropdown(false);
      return;
    }

    controller.query(text, (merged, ghost) => {
      const applyResults = () => {
        setSuggestions(merged);
        setGhostSuffix(ghost || '');
        setShowDropdown(merged.length > 0);
        if (!isNavigatingRef.current) {
          setSelectedIndex(-1);
        }
      };

      const needsDropdownUi = merged.length > 0 || Boolean(ghost);
      if (needsDropdownUi && !overlayActiveRef.current) {
        overlayActiveRef.current = true;
        beginOverlay()
          .then(() => {
            applyResults();
          })
          .catch((err) => {
            overlayActiveRef.current = false;
            console.warn('[OmniboxInput] beginOverlay failed:', err);
            applyResults();
          });
        return;
      }
      applyResults();
    });
  }, [controller, beginOverlay]);

  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
    setSuggestions([]);
    setGhostSuffix('');
    setSelectedIndex(-1);
    setDropdownRect(null);
    isNavigatingRef.current = false;
    controller.unlockList();
    deactivateOverlay();
  }, [controller, deactivateOverlay]);

  // ── Navigate to a URL ──────────────────────────────────────────────────
  const navigateTo = useCallback((url) => {
    if (!currentTabId) return;
    window.electronAPI.navigate(currentTabId, url);
    closeDropdown();
    inputRef.current?.blur();
  }, [currentTabId, closeDropdown]);

  // ── Main-process autofocus (new/blank tabs) ────────────────────────────
  // Listens for the 'omnibox:request-focus' CustomEvent dispatched by
  // useElectronIPC when the main process sends 'omnibox:focus' over IPC.
  // Calling .focus() here triggers handleFocus, which already runs select().
  useEffect(() => {
    const onRequestFocus = (event) => {
      const requestedTabId = event.detail?.tabId;
      if (requestedTabId != null && requestedTabId !== currentTabId) return;
      // Defer past native WebContentsView focus + layout so the shell retains focus
      // (needed for new-tab omnibox autofocus and stealth windows).
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          inputRef.current?.focus({ preventScroll: true });
        });
      });
    };
    window.addEventListener('omnibox:request-focus', onRequestFocus);
    return () => window.removeEventListener('omnibox:request-focus', onRequestFocus);
  }, [currentTabId]);

  // ── Focus ──────────────────────────────────────────────────────────────
  const handleFocus = useCallback(async () => {
    setIsFocused(true);
    didSelectRef.current = false;

    const skipOverlayForBareNewTab = Boolean(tab?.isNewTab && !inputValue.trim());

    if (!overlayActiveRef.current && !skipOverlayForBareNewTab) {
      overlayActiveRef.current = true;
      try {
        await beginOverlay();
      } catch (err) {
        overlayActiveRef.current = false;
        console.warn('[OmniboxInput] beginOverlay failed:', err);
      }
    }

    setTimeout(() => {
      if (inputRef.current && !didSelectRef.current) {
        inputRef.current.select();
        didSelectRef.current = true;
      }
    }, 0);

    if (inputValue.trim()) {
      runQuery(inputValue);
    }
  }, [inputValue, runQuery, beginOverlay, tab?.isNewTab]);

  const handleMouseUp = useCallback(() => {
    if (isFocused && didSelectRef.current) {
      didSelectRef.current = false;
    }
  }, [isFocused]);

  // ── Blur ───────────────────────────────────────────────────────────────
  const handleBlur = useCallback(() => {
    setIsFocused(false);
    setInputValue(displayUrl);
    setGhostSuffix('');
    if (inputRef.current) inputRef.current.setSelectionRange(0, 0);
    // Delay so a click on a dropdown row fires first
    setTimeout(closeDropdown, 150);
  }, [displayUrl, closeDropdown]);

  // ── Change ─────────────────────────────────────────────────────────────
  const handleChange = useCallback((e) => {
    const val = e.target.value;
    setInputValue(val);
    setGhostSuffix('');
    isNavigatingRef.current = false;
    controller.unlockList();
    runQuery(val);
  }, [controller, runQuery]);

  // ── Keyboard ───────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    const { key } = e;

    if (key === 'ArrowDown') {
      e.preventDefault();
      if (!showDropdown || suggestions.length === 0) return;
      if (!isNavigatingRef.current) {
        isNavigatingRef.current = true;
        controller.lockList();
      }
      setSelectedIndex(prev => {
        const next = prev + 1;
        return next >= suggestions.length ? 0 : next;
      });
      return;
    }

    if (key === 'ArrowUp') {
      e.preventDefault();
      if (!showDropdown || suggestions.length === 0) return;
      if (!isNavigatingRef.current) {
        isNavigatingRef.current = true;
        controller.lockList();
      }
      setSelectedIndex(prev => {
        if (prev <= 0) return prev === 0 ? -1 : suggestions.length - 1;
        return prev - 1;
      });
      return;
    }

    if (key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        navigateTo(suggestions[selectedIndex].url);
      } else if (ghostSuffix) {
        navigateTo(inputValue + ghostSuffix);
      } else {
        navigateTo(toNavigateUrl(inputValue, searchEngine));
      }
      return;
    }

    if (key === 'Escape') {
      e.preventDefault();
      closeDropdown();
      setInputValue(displayUrl);
      inputRef.current?.blur();
      return;
    }

    if (key === 'Tab') {
      if (ghostSuffix) {
        e.preventDefault();
        const completed = inputValue + ghostSuffix;
        setInputValue(completed);
        setGhostSuffix('');
        runQuery(completed);
      }
      return;
    }

    if (key === 'Backspace' && ghostSuffix) {
      e.preventDefault();
      setGhostSuffix('');
    }
  }, [
    showDropdown, suggestions, selectedIndex, ghostSuffix,
    inputValue, displayUrl, controller, navigateTo, closeDropdown, runQuery,
    searchEngine,
  ]);

  // ── Suggestion click ───────────────────────────────────────────────────
  const handleSuggestionMouseDown = useCallback((e, suggestion) => {
    e.preventDefault(); // prevent blur firing before click
    navigateTo(suggestion.url);
  }, [navigateTo]);

  // ── Derived values ─────────────────────────────────────────────────────
  const isSecure = isFocused
    ? inputValue.startsWith('https://')
    : displayUrl.startsWith('https://');

  const displayParts = buildDisplayParts(displayUrl);

  // When keyboard-navigating, show the highlighted suggestion URL in the input
  const effectiveInputValue = useMemo(() => {
    if (isNavigatingRef.current && selectedIndex >= 0 && suggestions[selectedIndex]) {
      return suggestions[selectedIndex].url;
    }
    return inputValue;
  }, [selectedIndex, suggestions, inputValue]);

  // ── Dropdown portal ────────────────────────────────────────────────────
  // Rendered into document.body so it escapes the header stacking context
  // and sits above the WebContentsView (which is hidden via beginOverlay).
  const dropdownPortal = showDropdown && isFocused && suggestions.length > 0 && dropdownRect
    ? ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className="omnibox-dropdown"
          role="listbox"
          style={{
            position: 'fixed',
            top:   dropdownRect.bottom + 4,
            left:  dropdownRect.left,
            width: dropdownRect.width,
          }}
        >
          {suggestions.map((suggestion, index) => (
            <SuggestionRow
              key={suggestion.url + index}
              suggestion={suggestion}
              query={inputValue}
              isSelected={index === selectedIndex}
              onMouseDown={handleSuggestionMouseDown}
              onMouseEnter={() => setSelectedIndex(index)}
            />
          ))}
        </div>,
        document.body,
      )
    : null;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="url-container" ref={containerRef}>
      {isFocused && (isSecure ? <LockIcon /> : <SearchIcon />)}

      {isFocused && ghostSuffix && (
        <div className="omnibox-ghost" aria-hidden="true">
          <span style={{ color: 'transparent' }}>{inputValue}</span>
          <span className="omnibox-ghost__suffix">{ghostSuffix}</span>
        </div>
      )}

      <input
        ref={inputRef}
        id="url-input"
        type="text"
        placeholder="Search or enter address"
        value={effectiveInputValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onMouseUp={handleMouseUp}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        spellCheck={false}
      />

      {!isFocused && displayParts && (
        <div className="url-display">
          {displayParts.prefix && <span>{escapeHtml(displayParts.prefix)}</span>}
          <span className="domain">{escapeHtml(displayParts.domain)}</span>
          {displayParts.suffix && <span>{escapeHtml(displayParts.suffix)}</span>}
        </div>
      )}

      {dropdownPortal}
    </div>
  );
}

// ── SuggestionRow ──────────────────────────────────────────────────────────

function SuggestionRow({ suggestion, query, isSelected, onMouseDown, onMouseEnter }) {
  const { text, url, type, description, favicon } = suggestion;

  const [faviconError, setFaviconError] = useState(false);
  const showFavicon = favicon && !faviconError;

  const textParts = useMemo(() => highlightMatches(text, query), [text, query]);

  return (
    <div
      className={`omnibox-row${isSelected ? ' omnibox-row--selected' : ''}`}
      role="option"
      aria-selected={isSelected}
      onMouseDown={(e) => onMouseDown(e, suggestion)}
      onMouseEnter={onMouseEnter}
    >
      <div className="omnibox-row__icon">
        {showFavicon ? (
          <img
            src={favicon}
            className="omnibox-row__favicon"
            alt=""
            onError={() => setFaviconError(true)}
          />
        ) : (
          getTypeIcon(type)
        )}
      </div>

      <div className="omnibox-row__content">
        <span className="omnibox-row__text">{textParts}</span>
        {description && description !== url && (
          <span className="omnibox-row__description">{description}</span>
        )}
      </div>

      <span className={`omnibox-badge omnibox-badge--${type}`}>{type}</span>
    </div>
  );
}
