import React, {
  useState, useRef, useCallback, useEffect, useMemo,
} from 'react';
import './omnibox.css';
import AutocompleteController from './AutocompleteController.js';
import { toNavigateUrl } from './AutocompleteInput.js';
import { useChromeOverlay } from '../../context/ChromeOverlayContext.jsx';

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

function serializeSuggestionsForOverlay(list) {
  const cap = 24;
  const out = [];
  for (let i = 0; i < list.length && out.length < cap; i++) {
    const s = list[i];
    if (!s || typeof s !== 'object') continue;
    out.push({
      text: String(s.text || '').slice(0, 240),
      url: String(s.url || '').slice(0, 2000),
      type: String(s.type || 'url').slice(0, 32),
      description: s.description != null ? String(s.description).slice(0, 240) : '',
      favicon: s.favicon != null ? String(s.favicon).slice(0, 2000) : '',
    });
  }
  return out;
}

// ── OmniboxInput component ─────────────────────────────────────────────────

export default function OmniboxInput({ currentTabId, tabsData, searchEngine = 'google' }) {
  const tab = tabsData[currentTabId];
  const displayUrl = tab && !tab.isNewTab ? (tab.url || '') : '';

  const { reset, acquire, release, post } = useChromeOverlay();

  const [isFocused, setIsFocused] = useState(false);
  const [inputValue, setInputValue] = useState(displayUrl);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [ghostSuffix, setGhostSuffix] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const didSelectRef = useRef(false);
  const isNavigatingRef = useRef(false);
  const suggestionsRef = useRef([]);
  const overlayRunIdRef = useRef(0);
  const chromeOmniboxActiveRef = useRef(false);
  const pendingOwnOmniboxResetRef = useRef(false);

  const controller = useMemo(() => new AutocompleteController(), []);
  useEffect(() => () => controller.dispose(), [controller]);

  suggestionsRef.current = suggestions;

  const closeOmniboxChrome = useCallback(async () => {
    if (!chromeOmniboxActiveRef.current) return;
    chromeOmniboxActiveRef.current = false;
    try {
      await release();
    } catch (err) {
      console.error('[OmniboxInput] chrome overlay release', err);
    }
  }, [release]);

  useEffect(() => () => {
    void closeOmniboxChrome();
  }, [closeOmniboxChrome]);

  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
    setSuggestions([]);
    setGhostSuffix('');
    setSelectedIndex(-1);
    isNavigatingRef.current = false;
    controller.unlockList();
    void closeOmniboxChrome();
  }, [controller, closeOmniboxChrome]);

  useEffect(() => {
    if (!isFocused || !showDropdown || suggestions.length === 0 || !containerRef.current) {
      if (chromeOmniboxActiveRef.current) {
        void closeOmniboxChrome();
      }
      return undefined;
    }

    const runId = ++overlayRunIdRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    const items = serializeSuggestionsForOverlay(suggestions);
    const sel = isNavigatingRef.current ? selectedIndex : -1;

    pendingOwnOmniboxResetRef.current = true;
    (async () => {
      try {
        if (!chromeOmniboxActiveRef.current) {
          await reset();
          await acquire();
          chromeOmniboxActiveRef.current = true;
        }
        if (runId !== overlayRunIdRef.current) return;
        await post({
          kind: 'omniboxSuggestions',
          dropdownRect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
          selectedIndex: sel,
          query: inputValue,
          items,
        });
      } catch (err) {
        console.error('[OmniboxInput] omnibox overlay post', err);
        chromeOmniboxActiveRef.current = false;
        try {
          await release();
        } catch (releaseErr) {
          console.error('[OmniboxInput] omnibox overlay release after error', releaseErr);
        }
      } finally {
        pendingOwnOmniboxResetRef.current = false;
      }
    })();

    return () => {
      overlayRunIdRef.current += 1;
    };
  }, [
    isFocused,
    showDropdown,
    suggestions,
    selectedIndex,
    inputValue,
    reset,
    acquire,
    release,
    post,
    closeOmniboxChrome,
  ]);

  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlayV1HostEvent?.((data) => {
      if (!chromeOmniboxActiveRef.current) return;
      if (data?.type === 'dismiss') {
        closeDropdown();
        return;
      }
      if (data?.type === 'omniboxSuggestPick') {
        const index = Number(data.index);
        if (!Number.isFinite(index) || index < 0) return;
        const list = suggestionsRef.current;
        const suggestion = list[index];
        if (!suggestion?.url) return;
        if (!currentTabId) return;
        window.electronAPI.navigate(currentTabId, suggestion.url);
        closeDropdown();
        inputRef.current?.blur();
      }
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, [closeDropdown, currentTabId]);

  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlaySuperseded?.(() => {
      if (pendingOwnOmniboxResetRef.current) return;
      if (chromeOmniboxActiveRef.current) {
        chromeOmniboxActiveRef.current = false;
        setShowDropdown(false);
        setSuggestions([]);
        setGhostSuffix('');
        setSelectedIndex(-1);
        isNavigatingRef.current = false;
        controller.unlockList();
      }
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, [controller]);

  useEffect(() => {
    if (!isFocused) {
      setInputValue(displayUrl);
    }
  }, [displayUrl, isFocused]);

  useEffect(() => {
    if (!showDropdown) return undefined;

    const onMouseDown = (e) => {
      if (containerRef.current?.contains(e.target)) return;
      closeDropdown();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showDropdown, closeDropdown]);

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
      if (!isNavigatingRef.current) {
        setSelectedIndex(-1);
      }
    });
  }, [controller]);

  const navigateTo = useCallback((url) => {
    if (!currentTabId) return;
    window.electronAPI.navigate(currentTabId, url);
    closeDropdown();
    inputRef.current?.blur();
  }, [currentTabId, closeDropdown]);

  useEffect(() => {
    const onRequestFocus = (event) => {
      const requestedTabId = event.detail?.tabId;
      if (requestedTabId != null && requestedTabId !== currentTabId) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          inputRef.current?.focus({ preventScroll: true });
        });
      });
    };
    window.addEventListener('omnibox:request-focus', onRequestFocus);
    return () => window.removeEventListener('omnibox:request-focus', onRequestFocus);
  }, [currentTabId]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    didSelectRef.current = false;

    setTimeout(() => {
      if (inputRef.current && !didSelectRef.current) {
        inputRef.current.select();
        didSelectRef.current = true;
      }
    }, 0);

    if (inputValue.trim()) {
      runQuery(inputValue);
    }
  }, [inputValue, runQuery]);

  const handleMouseUp = useCallback(() => {
    if (isFocused && didSelectRef.current) {
      didSelectRef.current = false;
    }
  }, [isFocused]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    setInputValue(displayUrl);
    setGhostSuffix('');
    if (inputRef.current) inputRef.current.setSelectionRange(0, 0);
    setTimeout(closeDropdown, 150);
  }, [displayUrl, closeDropdown]);

  const handleChange = useCallback((e) => {
    const val = e.target.value;
    setInputValue(val);
    setGhostSuffix('');
    isNavigatingRef.current = false;
    controller.unlockList();
    runQuery(val);
  }, [controller, runQuery]);

  const handleKeyDown = useCallback((e) => {
    const { key } = e;

    if (key === 'ArrowDown') {
      e.preventDefault();
      if (!showDropdown || suggestions.length === 0) return;
      if (!isNavigatingRef.current) {
        isNavigatingRef.current = true;
        controller.lockList();
      }
      setSelectedIndex((prev) => {
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
      setSelectedIndex((prev) => {
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

  const isSecure = isFocused
    ? inputValue.startsWith('https://')
    : displayUrl.startsWith('https://');

  const displayParts = buildDisplayParts(displayUrl);

  const effectiveInputValue = useMemo(() => {
    if (isNavigatingRef.current && selectedIndex >= 0 && suggestions[selectedIndex]) {
      return suggestions[selectedIndex].url;
    }
    return inputValue;
  }, [selectedIndex, suggestions, inputValue]);

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
    </div>
  );
}
