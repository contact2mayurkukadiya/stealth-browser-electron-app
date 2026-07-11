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
import { BOOKMARK, KEYBOARD, OMNIBOX_SUGGESTION, URL as URL_C } from '../constants/conditionStrings.js';
import AssetMaskIcon from '../components/AssetMaskIcon.jsx';
import { atSvg, globeSvg, lockSvg, menuBookmarksSvg, menuFindSvg, menuHistorySvg, micSvg } from '../constants/appAssetUrls.js';

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

const GlobeIcon = <AssetMaskIcon icon={globeSvg} size={16} className="omnibox-row__type-icon" />;

const HistoryIcon = <AssetMaskIcon icon={menuHistorySvg} size={16} className="omnibox-row__type-icon" />;

const SearchRowIcon = <AssetMaskIcon icon={menuFindSvg} size={16} className="omnibox-row__type-icon" />;

const BookmarkIcon = <AssetMaskIcon icon={menuBookmarksSvg} size={16} className="omnibox-row__type-icon" />;

const KeywordIcon = <AssetMaskIcon icon={atSvg} size={16} className="omnibox-row__type-icon" />;

function getTypeIcon(type) {
  switch (type) {
    case OMNIBOX_SUGGESTION.HISTORY:  return HistoryIcon;
    case OMNIBOX_SUGGESTION.SEARCH:   return SearchRowIcon;
    case OMNIBOX_SUGGESTION.BOOKMARK: return BookmarkIcon;
    case OMNIBOX_SUGGESTION.KEYWORD:  return KeywordIcon;
    default: return GlobeIcon;
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
            draggable={false}
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

function mapRecentHistoryItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((entry) => entry && entry.url)
    .slice(0, 6)
    .map((entry, index) => ({
      text: entry.title || entry.url,
      url: entry.url,
      type: OMNIBOX_SUGGESTION.HISTORY,
      score: Math.max(1, 120 - index),
      description: entry.title && entry.title !== entry.url ? entry.url : '',
      favicon: entry.favicon || null,
    }));
}

const SearchIcon = <AssetMaskIcon icon={menuFindSvg} size={20} className="ntp-search-box__icon-svg" />;

const LockIcon = <AssetMaskIcon icon={lockSvg} size={20} className="ntp-search-box__icon-svg" />;

const MicIcon = <AssetMaskIcon icon={micSvg} size={20} className="ntp-search-box__icon-svg" />;

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
  const isFocusedRef = useRef(false);
  const recentHistoryFallbackRef = useRef([]);
  const recentFallbackSeqRef = useRef(0);

  const controller = useMemo(() => new AutocompleteController(), []);
  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    window.electronAPI.settingsGet?.().then((s) => {
      if (s?.searchEngine) setSearchEngine(s.searchEngine);
    }).catch(() => {});

    if (window.electronAPI.settingsUpdated) {
      const unsubscribe = window.electronAPI.settingsUpdated((data) => {
        if (data?.settings?.searchEngine) {
          setSearchEngine(data.settings.searchEngine);
        }
      });
      return typeof unsubscribe === 'function' ? unsubscribe : undefined;
    }
  }, []);

  const loadRecentHistoryFallback = useCallback(async (applyToDropdown = false) => {
    const seq = ++recentFallbackSeqRef.current;
    try {
      const result = await window.electronAPI?.historySearch?.({ query: '', limit: 6 });
      if (seq !== recentFallbackSeqRef.current) return;
      const mapped = mapRecentHistoryItems(result?.items);
      recentHistoryFallbackRef.current = mapped;
      if (!applyToDropdown) return;
      if (!isFocusedRef.current) return;
      if (inputRef.current?.value?.trim()) return;
      setSuggestions(mapped);
      setGhostSuffix('');
      setShowDropdown(mapped.length > 0);
      if (!isNavigatingRef.current) setSelectedIndex(-1);
    } catch (err) {
      console.warn('[NtpSearchBox] Failed to load recent history fallback:', err);
    }
  }, []);

  useEffect(() => {
    void loadRecentHistoryFallback(false);
  }, [loadRecentHistoryFallback]);

  const runQuery = useCallback((text) => {
    if (!text.trim()) {
      setSuggestions(recentHistoryFallbackRef.current);
      setGhostSuffix('');
      setShowDropdown(recentHistoryFallbackRef.current.length > 0);
      if (!isNavigatingRef.current) setSelectedIndex(-1);
      void loadRecentHistoryFallback(true);
      return;
    }

    controller.query(text, (merged, ghost) => {
      setSuggestions(merged);
      setGhostSuffix(ghost || '');
      setShowDropdown(merged.length > 0);
      if (!isNavigatingRef.current) setSelectedIndex(-1);
    });
  }, [controller, loadRecentHistoryFallback]);

  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
    setSuggestions([]);
    setGhostSuffix('');
    setSelectedIndex(-1);
    setDropdownRect(null);
    isNavigatingRef.current = false;
    controller.unlockList();
  }, [controller]);

  const navigateTo = useCallback((url, source = 'typed') => {
    window.electronAPI.navigate('current', url, { source });
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
    isFocusedRef.current = true;
    setIsFocused(true);
    didSelectRef.current = false;
    setTimeout(() => {
      if (inputRef.current && !didSelectRef.current) {
        inputRef.current.select();
        didSelectRef.current = true;
      }
    }, 0);
    runQuery(inputValue);
  }, [inputValue, runQuery]);

  const handleBlur = useCallback(() => {
    isFocusedRef.current = false;
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

    if (key === KEYBOARD.ARROW_DOWN) {
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

    if (key === KEYBOARD.ARROW_UP) {
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

    if (key === KEYBOARD.ENTER) {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        navigateTo(suggestions[selectedIndex].url, suggestions[selectedIndex].type);
      } else if (ghostSuffix) {
        navigateTo(inputValue + ghostSuffix, 'typed');
      } else if (inputValue.trim()) {
        navigateTo(toNavigateUrl(inputValue, searchEngine), 'typed');
      }
      return;
    }

    if (key === KEYBOARD.ESCAPE) {
      e.preventDefault();
      closeDropdown();
      setInputValue('');
      inputRef.current?.blur();
      return;
    }

    if (key === KEYBOARD.TAB) {
      if (ghostSuffix) {
        e.preventDefault();
        const completed = inputValue + ghostSuffix;
        setInputValue(completed);
        setGhostSuffix('');
        runQuery(completed);
      }
      return;
    }

    if (key === KEYBOARD.BACKSPACE && ghostSuffix) {
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
    navigateTo(suggestion.url, suggestion.type);
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

  const fieldIcon = isFocused && effectiveInputValue.startsWith(URL_C.SCHEME_HTTPS) ? LockIcon : SearchIcon;

  return (
    <div className="ntp-search-box" ref={containerRef}>
      <div className="ntp-search-box__field">
        <div className="ntp-search-box__icon-left">
          {fieldIcon}
        </div>
        <div className="ntp-search-box__input-wrap">
          {isFocused && ghostSuffix ? (
            <div className="omnibox-ghost omnibox-ghost--ntp" aria-hidden="true">
              <span style={{ color: 'transparent' }}>{inputValue}</span>
              <span className="omnibox-ghost__suffix">{ghostSuffix}</span>
            </div>
          ) : null}
          <input
            ref={inputRef}
            className="ntp-search-box__input"
            type="text"
            placeholder="Search your intent…"
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
        </div>
        <button
          type="button"
          className="ntp-search-box__mic"
          disabled
          tabIndex={-1}
          title="Voice search (coming soon)"
          aria-label="Voice search (coming soon)"
        >
          {MicIcon}
        </button>
      </div>
      {dropdownPortal}
    </div>
  );
}
