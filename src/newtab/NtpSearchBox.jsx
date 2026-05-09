import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import ReactDOM from 'react-dom';
import '../components/omnibox/omnibox.css';
import AutocompleteController from '../components/omnibox/AutocompleteController.js';
import { toNavigateUrl } from '../components/omnibox/AutocompleteInput.js';

// ── Mirrors OmniboxInput suggestion row markup (kept local for the NTP bundle) ─

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
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="omnibox-row__type-icon">
    <path d="M2 8h5M9 8h5M8 2v5M8 9v5" />
  </svg>
);

function getTypeIcon(type) {
  switch (type) {
    case 'history':  return <HistoryIcon />;
    case 'search':   return <SearchRowIcon />;
    case 'bookmark': return <BookmarkIcon />;
    case 'keyword':  return <KeywordIcon />;
    default:         return <GlobeIcon />;
  }
}

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

const SearchIcon = () => (
  <svg className="ntp-fakebox__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="16.5" y1="16.5" x2="22" y2="22" />
  </svg>
);

const LockIcon = () => (
  <svg className="ntp-fakebox__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

/**
 * In-page omnibox on the NTP: same AutocompleteController as the shell (history, bookmarks, keywords, search suggest).
 */
export default function NtpSearchBox() {
  const [searchEngine, setSearchEngine] = useState('google');
  const [isFocused, setIsFocused] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [ghostSuffix, setGhostSuffix] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownRect, setDropdownRect] = useState(null);

  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const didSelectRef = useRef(false);
  const isNavigatingRef = useRef(false);

  const controller = useMemo(() => new AutocompleteController(), []);
  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    window.electronAPI.settingsGet?.().then((s) => {
      if (s?.searchEngine) setSearchEngine(s.searchEngine);
    }).catch(() => {});
  }, []);

  const runQuery = useCallback((text) => {
    if (!text.trim()) {
      setSuggestions([]);
      setGhostSuffix('');
      setShowDropdown(false);
      return;
    }

    controller.query(text, (merged, ghost) => {
      setSuggestions(merged);
      setGhostSuffix(ghost || '');
      setShowDropdown(merged.length > 0);
      if (!isNavigatingRef.current) setSelectedIndex(-1);
    });
  }, [controller]);

  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
    setSuggestions([]);
    setGhostSuffix('');
    setSelectedIndex(-1);
    setDropdownRect(null);
    isNavigatingRef.current = false;
    controller.unlockList();
  }, [controller]);

  const navigateTo = useCallback((url) => {
    window.electronAPI.navigate('current', url);
    closeDropdown();
    setInputValue('');
    inputRef.current?.blur();
  }, [closeDropdown]);

  useEffect(() => {
    if (showDropdown && containerRef.current) {
      setDropdownRect(containerRef.current.getBoundingClientRect());
    } else {
      setDropdownRect(null);
    }
  }, [showDropdown]);

  useEffect(() => {
    if (!showDropdown) return undefined;

    const onMouseDown = (e) => {
      const inContainer = containerRef.current?.contains(e.target);
      const inDropdown = dropdownRef.current?.contains(e.target);
      if (!inContainer && !inDropdown) closeDropdown();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showDropdown, closeDropdown]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    didSelectRef.current = false;
    setTimeout(() => {
      if (inputRef.current && !didSelectRef.current) {
        inputRef.current.select();
        didSelectRef.current = true;
      }
    }, 0);
    if (inputValue.trim()) runQuery(inputValue);
  }, [inputValue, runQuery]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    setInputValue('');
    setGhostSuffix('');
    if (inputRef.current) inputRef.current.setSelectionRange(0, 0);
    setTimeout(closeDropdown, 150);
  }, [closeDropdown]);

  const handleChange = useCallback((e) => {
    const val = e.target.value;
    setInputValue(val);
    setGhostSuffix('');
    isNavigatingRef.current = false;
    controller.unlockList();
    runQuery(val);
  }, [controller, runQuery]);

  const handleMouseUp = useCallback(() => {
    if (isFocused && didSelectRef.current) didSelectRef.current = false;
  }, [isFocused]);

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
      } else if (inputValue.trim()) {
        navigateTo(toNavigateUrl(inputValue, searchEngine));
      }
      return;
    }

    if (key === 'Escape') {
      e.preventDefault();
      closeDropdown();
      setInputValue('');
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
    showDropdown,
    suggestions,
    selectedIndex,
    ghostSuffix,
    inputValue,
    controller,
    navigateTo,
    closeDropdown,
    runQuery,
    searchEngine,
  ]);

  const handleSuggestionMouseDown = useCallback((ev, suggestion) => {
    ev.preventDefault();
    navigateTo(suggestion.url);
  }, [navigateTo]);

  const effectiveInputValue = useMemo(() => {
    if (isNavigatingRef.current && selectedIndex >= 0 && suggestions[selectedIndex]) {
      return suggestions[selectedIndex].url;
    }
    return inputValue;
  }, [selectedIndex, suggestions, inputValue]);

  const dropdownPortal = showDropdown && isFocused && suggestions.length > 0 && dropdownRect
    ? ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className="omnibox-dropdown ntp-search-dropdown"
          role="listbox"
          style={{
            position: 'fixed',
            top: dropdownRect.bottom + 4,
            left: dropdownRect.left,
            width: dropdownRect.width,
            zIndex: 2147483646,
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

  return (
    <div className="ntp-fakebox ntp-search-box" ref={containerRef}>
      {isFocused && (effectiveInputValue.startsWith('https://') ? <LockIcon /> : <SearchIcon />)}
      {!isFocused && <SearchIcon />}

      {isFocused && ghostSuffix && (
        <div className="omnibox-ghost" aria-hidden="true">
          <span style={{ color: 'transparent' }}>{inputValue}</span>
          <span className="omnibox-ghost__suffix">{ghostSuffix}</span>
        </div>
      )}

      <input
        ref={inputRef}
        className="ntp-search-input"
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
        aria-label="Search or enter address"
      />

      {dropdownPortal}
    </div>
  );
}
