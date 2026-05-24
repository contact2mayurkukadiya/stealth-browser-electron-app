import React, {
  useState, useRef, useCallback, useEffect, useMemo,
} from 'react';
import './omnibox.css';
import AutocompleteController from './AutocompleteController.js';
import { toNavigateUrl } from './AutocompleteInput.js';
import { useChromeOverlay } from '../../context/ChromeOverlayContext.jsx';
import { buildDisplayParts, isNtpOmniboxUrl, toOmniboxBarValue } from '../../utils/omniboxDisplayUrl.js';
import {
  URL as URL_C,
  KEYBOARD,
  OVERLAY,
  DOM_EVENT,
} from '../../constants/conditionStrings.js';

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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function readSelection(input) {
  if (!input) return { start: 0, end: 0 };
  const start = Number.isFinite(input.selectionStart) ? input.selectionStart : 0;
  const end = Number.isFinite(input.selectionEnd) ? input.selectionEnd : start;
  return { start, end };
}

function isInternalDisplayUrl(value) {
  const url = String(value || '').toLowerCase();
  return url.startsWith(URL_C.SCHEME_INVISURF)
    || url.startsWith(URL_C.SCHEME_STEALTH);
}

function mapRecentHistoryItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((entry) => entry && entry.url)
    .slice(0, 6)
    .map((entry, index) => ({
      text: entry.title || entry.url,
      url: entry.url,
      type: 'history',
      score: Math.max(1, 120 - index),
      description: entry.title && entry.title !== entry.url ? entry.url : '',
      favicon: entry.favicon || null,
    }));
}

function suggestionDisplayValue(suggestion) {
  if (!suggestion) return '';
  return suggestion.url || suggestion.text || '';
}

export default function OmniboxInput({ currentTabId, tabsData, searchEngine = 'google' }) {
  const tab = tabsData[currentTabId];
  const displayUrl = tab && !tab.isNewTab ? (tab.url || '') : '';

  const { reset, acquire, release, post } = useChromeOverlay();

  const [isFocused, setIsFocused] = useState(false);
  const [draftValue, setDraftValue] = useState(displayUrl);
  const [hasUncommittedDraft, setHasUncommittedDraft] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayAnchorVersion, setOverlayAnchorVersion] = useState(0);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [ghostSuffix, setGhostSuffix] = useState('');

  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const didSelectRef = useRef(false);
  const isNavigatingRef = useRef(false);
  const suggestionsRef = useRef([]);
  const selectionRef = useRef({ start: 0, end: 0 });
  const overlayRunIdRef = useRef(0);
  const chromeOmniboxActiveRef = useRef(false);
  /** True after acquire() until release() — must not clear chromeOmniboxActiveRef before release. */
  const chromeOverlayHeldRef = useRef(false);
  const pendingOwnOmniboxResetRef = useRef(false);
  const overlayOpenRef = useRef(false);
  const suppressOverlayOnNextAFocusRef = useRef(false);
  /** Programmatic focus (tab wake / blank tab) — keep A only until user clicks or types. */
  const aOnlyFocusUntilUserEditRef = useRef(false);
  const overlaySessionBaseRef = useRef('');
  const overlayEditedRef = useRef(false);
  const draftValueRef = useRef(draftValue);
  const ghostSuffixRef = useRef('');
  const committedDraftPendingRef = useRef(false);
  /** Committed navigate URL shown until Redux receives url-changed. */
  const pendingCommittedUrlRef = useRef('');
  const recentHistoryFallbackRef = useRef([]);
  const recentFallbackSeqRef = useRef(0);
  const recentFallbackKeyRef = useRef(null);
  const activeSuggestionQueryRef = useRef(null);
  const suggestionCacheRef = useRef({ query: null, suggestions: [], ghostSuffix: '' });
  /** Skip refocusing overlay B on every suggestion/draft post after the first open. */
  const omniboxOverlayFocusSentRef = useRef(false);
  const displayUrlRef = useRef(displayUrl);
  const navigationBaseRef = useRef('');
  const prevTabLoadingRef = useRef(false);

  const controller = useMemo(() => new AutocompleteController(), []);
  useEffect(() => () => controller.dispose(), [controller]);

  suggestionsRef.current = suggestions;
  overlayOpenRef.current = overlayOpen;
  draftValueRef.current = draftValue;
  ghostSuffixRef.current = ghostSuffix;
  displayUrlRef.current = displayUrl;

  const barDisplayValue = (() => {
    if (hasUncommittedDraft && !committedDraftPendingRef.current) {
      return toOmniboxBarValue(draftValue);
    }
    if (committedDraftPendingRef.current && pendingCommittedUrlRef.current) {
      return toOmniboxBarValue(pendingCommittedUrlRef.current);
    }
    return displayUrl;
  })();

  const closeOmniboxChrome = useCallback(async () => {
    if (!chromeOverlayHeldRef.current) {
      chromeOmniboxActiveRef.current = false;
      return;
    }
    chromeOmniboxActiveRef.current = false;
    chromeOverlayHeldRef.current = false;
    try {
      await release();
    } catch (err) {
      console.error('[OmniboxInput] chrome overlay release', err);
    }
  }, [release]);

  useEffect(() => () => {
    void closeOmniboxChrome();
  }, [closeOmniboxChrome]);

  const revertDraftToDisplayUrl = useCallback(() => {
    const canonical = displayUrlRef.current;
    setHasUncommittedDraft(false);
    suppressOverlayOnNextAFocusRef.current = false;
    draftValueRef.current = canonical;
    setDraftValue(canonical);
  }, []);

  const loadRecentHistoryFallback = useCallback(async (queryText = '', applyToOverlay = false) => {
    const key = String(queryText || '').trim();
    recentFallbackKeyRef.current = key;
    const seq = ++recentFallbackSeqRef.current;
    try {
      const result = await window.electronAPI?.historySearch?.({ query: '', limit: 6 });
      if (seq !== recentFallbackSeqRef.current) return;
      const mapped = mapRecentHistoryItems(result?.items);
      recentHistoryFallbackRef.current = mapped;
      if (!applyToOverlay) return;
      if (!overlayOpenRef.current) return;
      if (String(draftValueRef.current || '').trim() !== key) return;
      if (suggestionsRef.current.length > 0) return;
      suggestionCacheRef.current = { query: queryText, suggestions: mapped, ghostSuffix: '' };
      setSuggestions(mapped);
      setGhostSuffix('');
      if (!isNavigatingRef.current) setSelectedIndex(-1);
    } catch (err) {
      console.warn('[OmniboxInput] Failed to load recent history fallback:', err);
    }
  }, []);

  useEffect(() => {
    void loadRecentHistoryFallback('', false);
  }, [loadRecentHistoryFallback]);

  const closeOverlay = useCallback((options = {}) => {
    const preserveDraft = options?.preserveDraft === true;
    overlayOpenRef.current = false;
    omniboxOverlayFocusSentRef.current = false;
    activeSuggestionQueryRef.current = null;
    setHasUncommittedDraft(preserveDraft);
    suppressOverlayOnNextAFocusRef.current = false;
    setOverlayOpen(false);
    setSuggestions([]);
    setGhostSuffix('');
    setSelectedIndex(-1);
    isNavigatingRef.current = false;
    overlayEditedRef.current = false;
    controller.unlockList();
    void closeOmniboxChrome();
  }, [controller, closeOmniboxChrome]);

  const commitNavigation = useCallback((url, source = 'typed') => {
    if (!currentTabId) return;
    if (!url || isNtpOmniboxUrl(url)) {
      closeOverlay();
      setIsFocused(false);
      inputRef.current?.blur();
      return;
    }
    pendingCommittedUrlRef.current = url;
    committedDraftPendingRef.current = true;
    setHasUncommittedDraft(false);
    suppressOverlayOnNextAFocusRef.current = false;
    overlayEditedRef.current = false;
    window.electronAPI.navigate(currentTabId, url, { source });
    closeOverlay();
    setIsFocused(false);
    inputRef.current?.blur();
  }, [currentTabId, closeOverlay]);

  const applyCachedSuggestions = useCallback((query) => {
    const cached = suggestionCacheRef.current;
    if (cached.query !== query) return false;
    activeSuggestionQueryRef.current = query;
    setSuggestions(cached.suggestions);
    setGhostSuffix(cached.ghostSuffix);
    if (!isNavigatingRef.current) setSelectedIndex(-1);
    return true;
  }, []);

  const runQuery = useCallback((text, options = {}) => {
    const query = String(text || '');
    if (options.preferCache && applyCachedSuggestions(query)) return;
    activeSuggestionQueryRef.current = query;
    const trimmed = query.trim();
    if (!trimmed) {
      setSuggestions(recentHistoryFallbackRef.current);
      setGhostSuffix('');
      suggestionCacheRef.current = {
        query,
        suggestions: recentHistoryFallbackRef.current,
        ghostSuffix: '',
      };
      if (!overlayOpenRef.current) return;
      void loadRecentHistoryFallback('', true);
      return;
    }

    controller.query(text, (merged, ghost) => {
      if (activeSuggestionQueryRef.current !== query) return;
      if (merged.length > 0) {
        recentFallbackKeyRef.current = null;
        recentFallbackSeqRef.current += 1;
      } else {
        setSuggestions(recentHistoryFallbackRef.current);
        setGhostSuffix('');
        suggestionCacheRef.current = {
          query,
          suggestions: recentHistoryFallbackRef.current,
          ghostSuffix: '',
        };
        if (!isNavigatingRef.current) {
          setSelectedIndex(-1);
        }
        void loadRecentHistoryFallback(trimmed, true);
        return;
      }
      setSuggestions(merged);
      const nextGhost = ghost || '';
      setGhostSuffix(nextGhost);
      suggestionCacheRef.current = { query, suggestions: merged, ghostSuffix: nextGhost };
      if (!isNavigatingRef.current) {
        setSelectedIndex(-1);
      }
    });
  }, [applyCachedSuggestions, controller, loadRecentHistoryFallback]);

  const openOverlay = useCallback((initialValue, selection, options = {}) => {
    if (isInternalDisplayUrl(displayUrl)) return;
    const value = initialValue ?? draftValueRef.current ?? displayUrl;
    overlaySessionBaseRef.current = value;
    overlayEditedRef.current = false;
    setDraftValue(value);
    if (selection) {
      selectionRef.current = selection;
    } else if (inputRef.current) {
      selectionRef.current = readSelection(inputRef.current);
    } else {
      selectionRef.current = { start: value.length, end: value.length };
    }
    overlayOpenRef.current = true;
    omniboxOverlayFocusSentRef.current = false;
    setOverlayOpen(true);
    const shouldShowRecentHistory = !value.trim();
    if (options.queryOnOpen || shouldShowRecentHistory) {
      runQuery(value, { preferCache: options.preferCache });
      return;
    }
    activeSuggestionQueryRef.current = null;
    setSuggestions([]);
    setGhostSuffix('');
    setSelectedIndex(-1);
  }, [displayUrl, runQuery]);

  const navigateFromDraft = useCallback((value, selIdx) => {
    const list = suggestionsRef.current;
    if (selIdx >= 0 && list[selIdx]?.url) {
      commitNavigation(list[selIdx].url, list[selIdx].type);
      return;
    }
    const ghost = ghostSuffixRef.current;
    if (ghost) {
      const completed = value + ghost;
      commitNavigation(completed, 'typed');
      return;
    }
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      closeOverlay();
      setIsFocused(false);
      inputRef.current?.blur();
      return;
    }
    const target = toNavigateUrl(value, searchEngine);
    if (!target) {
      closeOverlay();
      setIsFocused(false);
      inputRef.current?.blur();
      return;
    }
    commitNavigation(target, 'typed');
  }, [commitNavigation, closeOverlay, searchEngine]);

  useEffect(() => {
    if (!overlayOpen || !containerRef.current) {
      if (chromeOverlayHeldRef.current) {
        void closeOmniboxChrome();
      }
      return undefined;
    }

    const runId = ++overlayRunIdRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    const items = serializeSuggestionsForOverlay(suggestions);
    const sel = isNavigatingRef.current ? selectedIndex : -1;
    const { start, end } = selectionRef.current;

    pendingOwnOmniboxResetRef.current = true;
    (async () => {
      try {
        if (!chromeOverlayHeldRef.current) {
          if (runId !== overlayRunIdRef.current) return;
          await reset();
          if (runId !== overlayRunIdRef.current) return;
          await acquire();
          if (runId !== overlayRunIdRef.current) {
            try {
              await release();
            } catch (releaseErr) {
              console.error('[OmniboxInput] omnibox overlay release after stale acquire', releaseErr);
            }
            return;
          }
          chromeOverlayHeldRef.current = true;
          chromeOmniboxActiveRef.current = true;
        }
        if (runId !== overlayRunIdRef.current) return;
        const focusInput = !omniboxOverlayFocusSentRef.current;
        await post({
          kind: 'omniboxSuggestions',
          dropdownRect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
          selectedIndex: sel,
          query: draftValueRef.current,
          items,
          selectionStart: start,
          selectionEnd: end,
          focusInput,
          ghostSuffix: ghostSuffixRef.current || '',
          isSecure: draftValueRef.current.startsWith(URL_C.SCHEME_HTTPS),
        });
        if (focusInput) omniboxOverlayFocusSentRef.current = true;
      } catch (err) {
        console.error('[OmniboxInput] omnibox overlay post', err);
        chromeOmniboxActiveRef.current = false;
        if (chromeOverlayHeldRef.current) {
          chromeOverlayHeldRef.current = false;
          try {
            await release();
          } catch (releaseErr) {
            console.error('[OmniboxInput] omnibox overlay release after error', releaseErr);
          }
        }
      } finally {
        pendingOwnOmniboxResetRef.current = false;
      }
    })();

    return () => {
      overlayRunIdRef.current += 1;
    };
  }, [
    overlayOpen,
    overlayAnchorVersion,
    suggestions,
    selectedIndex,
    draftValue,
    ghostSuffix,
    reset,
    acquire,
    release,
    post,
    closeOmniboxChrome,
  ]);

  useEffect(() => {
    if (!overlayOpen) return undefined;
    let frame = 0;
    const refreshAnchor = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setOverlayAnchorVersion((version) => version + 1);
      });
    };
    window.addEventListener('resize', refreshAnchor);
    const observer = typeof ResizeObserver !== 'undefined' && containerRef.current
      ? new ResizeObserver(refreshAnchor)
      : null;
    if (observer && containerRef.current) observer.observe(containerRef.current);
    refreshAnchor();
    return () => {
      window.removeEventListener('resize', refreshAnchor);
      if (observer) observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [overlayOpen]);

  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlayV1HostEvent?.((data) => {
      if (data?.type === OVERLAY.DISMISS) {
        const base = overlaySessionBaseRef.current;
        const current = draftValueRef.current;
        const edited = overlayEditedRef.current || current !== base;
        const preserveDraft = (data.reason === 'outside' || data.reason === 'blur') && edited;
        if (preserveDraft) {
          draftValueRef.current = current;
          setDraftValue(current);
        }
        closeOverlay({ preserveDraft });
        if (edited && !preserveDraft) revertDraftToDisplayUrl();
        setIsFocused(false);
        return;
      }

      if (data?.type === OVERLAY.OMNIBOX_INPUT_COMMIT) {
        const value = String(data.value ?? draftValueRef.current);
        draftValueRef.current = value;
        setDraftValue(value);
        const sel = Number.isFinite(Number(data.selectedIndex))
          ? Number(data.selectedIndex)
          : -1;
        navigateFromDraft(value, sel);
        return;
      }

      if (data?.type === OVERLAY.OMNIBOX_SUGGEST_PICK) {
        const index = Number(data.index);
        if (!Number.isFinite(index) || index < 0) return;
        const suggestion = suggestionsRef.current[index];
        if (!suggestion?.url) return;
        commitNavigation(suggestion.url, suggestion.type);
        return;
      }

      if (!chromeOmniboxActiveRef.current) return;

      if (data?.type === OVERLAY.OMNIBOX_INPUT_CHANGE) {
        const value = String(data.value ?? '');
        overlayEditedRef.current = true;
        setDraftValue(value);
        const start = Number(data.selectionStart);
        const end = Number(data.selectionEnd);
        if (Number.isFinite(start) && Number.isFinite(end)) {
          selectionRef.current = { start, end };
        }
        setGhostSuffix('');
        isNavigatingRef.current = false;
        controller.unlockList();
        runQuery(value);
        return;
      }

      if (data?.type === OVERLAY.OMNIBOX_KEY_DOWN) {
        const key = data.key;
        const value = String(data.value ?? draftValueRef.current);
        const list = suggestionsRef.current;

        if (key === KEYBOARD.ARROW_DOWN) {
          if (list.length === 0) return;
          if (!isNavigatingRef.current) {
            isNavigatingRef.current = true;
            navigationBaseRef.current = draftValueRef.current;
            controller.lockList();
          }
          setSelectedIndex((prev) => {
            const next = prev + 1 >= list.length ? 0 : prev + 1;
            const val = suggestionDisplayValue(list[next]);
            if (val) {
              draftValueRef.current = val;
              setDraftValue(val);
              setGhostSuffix('');
              selectionRef.current = { start: val.length, end: val.length };
              overlayEditedRef.current = true;
            }
            return next;
          });
          return;
        }

        if (key === KEYBOARD.ARROW_UP) {
          if (list.length === 0) return;
          if (!isNavigatingRef.current) {
            isNavigatingRef.current = true;
            navigationBaseRef.current = draftValueRef.current;
            controller.lockList();
          }
          setSelectedIndex((prev) => {
            let next;
            if (prev <= 0) {
              next = prev === 0 ? -1 : list.length - 1;
            } else {
              next = prev - 1;
            }
            if (next >= 0 && list[next]) {
              const val = suggestionDisplayValue(list[next]);
              draftValueRef.current = val;
              setDraftValue(val);
              setGhostSuffix('');
              selectionRef.current = { start: val.length, end: val.length };
              overlayEditedRef.current = true;
            } else if (next === -1) {
              const base = navigationBaseRef.current || overlaySessionBaseRef.current;
              draftValueRef.current = base;
              setDraftValue(base);
              setGhostSuffix('');
              selectionRef.current = { start: base.length, end: base.length };
            }
            return next;
          });
          return;
        }

        if (key === KEYBOARD.ENTER) {
          const sel = Number.isFinite(Number(data.selectedIndex))
            ? Number(data.selectedIndex)
            : (isNavigatingRef.current ? selectedIndex : -1);
          draftValueRef.current = value;
          setDraftValue(value);
          navigateFromDraft(value, sel);
          return;
        }

        if (key === KEYBOARD.TAB && ghostSuffixRef.current) {
          const completed = value + ghostSuffixRef.current;
          overlayEditedRef.current = true;
          setDraftValue(completed);
          setGhostSuffix('');
          selectionRef.current = { start: completed.length, end: completed.length };
          runQuery(completed);
        }
        return;
      }
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, [closeOverlay, commitNavigation, controller, navigateFromDraft, revertDraftToDisplayUrl, runQuery, selectedIndex]);

  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlaySuperseded?.(() => {
      if (pendingOwnOmniboxResetRef.current) return;
      if (!chromeOverlayHeldRef.current && !chromeOmniboxActiveRef.current) return;
      overlayOpenRef.current = false;
      omniboxOverlayFocusSentRef.current = false;
    activeSuggestionQueryRef.current = null;
      setOverlayOpen(false);
      setSuggestions([]);
      setGhostSuffix('');
      setSelectedIndex(-1);
      isNavigatingRef.current = false;
      controller.unlockList();
      void closeOmniboxChrome();
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, [controller, closeOmniboxChrome]);

  useEffect(() => {
    if (committedDraftPendingRef.current) {
      const pending = pendingCommittedUrlRef.current;
      if (displayUrl || isNtpOmniboxUrl(pending)) {
        committedDraftPendingRef.current = false;
        pendingCommittedUrlRef.current = '';
        draftValueRef.current = displayUrl;
        setDraftValue(displayUrl);
        return;
      }
      if (pending) {
        draftValueRef.current = toOmniboxBarValue(pending);
        setDraftValue(toOmniboxBarValue(pending));
      }
      return;
    }
    if (!hasUncommittedDraft && !overlayOpen && !isFocused) {
      setDraftValue(displayUrl);
    }
  }, [displayUrl, hasUncommittedDraft, overlayOpen, isFocused]);

  const tabIsLoading = !!(tab && tab.isLoading);

  useEffect(() => {
    const wasLoading = prevTabLoadingRef.current;
    prevTabLoadingRef.current = tabIsLoading;
    if (!currentTabId || !wasLoading || tabIsLoading) return;
    if (committedDraftPendingRef.current || overlayOpenRef.current) return;
    if (draftValueRef.current === displayUrlRef.current) return;
    revertDraftToDisplayUrl();
  }, [tabIsLoading, currentTabId, revertDraftToDisplayUrl]);

  useEffect(() => {
    if (!currentTabId) return;
    overlayRunIdRef.current += 1;
    committedDraftPendingRef.current = false;
    pendingCommittedUrlRef.current = '';
    activeSuggestionQueryRef.current = null;
    suggestionCacheRef.current = { query: null, suggestions: [], ghostSuffix: '' };
    setHasUncommittedDraft(false);
    suppressOverlayOnNextAFocusRef.current = true;
    aOnlyFocusUntilUserEditRef.current = false;
    overlayOpenRef.current = false;
    omniboxOverlayFocusSentRef.current = false;
    if (chromeOverlayHeldRef.current) {
      setOverlayOpen(false);
      setSuggestions([]);
      setGhostSuffix('');
      setSelectedIndex(-1);
      isNavigatingRef.current = false;
      overlayEditedRef.current = false;
      controller.unlockList();
      void closeOmniboxChrome();
    } else {
      setOverlayOpen(false);
    }
    setDraftValue(displayUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on tab switch, not each navigation URL update
  }, [currentTabId, controller, closeOmniboxChrome]);

  useEffect(() => {
    const onRequestFocus = (event) => {
      const requestedTabId = event.detail?.tabId;
      if (requestedTabId != null && requestedTabId !== currentTabId) return;
      const openOverlay = event.detail?.openOverlay === true;
      const selectAll = !!event.detail?.selectAll;
      if (!openOverlay) {
        aOnlyFocusUntilUserEditRef.current = true;
        suppressOverlayOnNextAFocusRef.current = true;
      } else {
        suppressOverlayOnNextAFocusRef.current = false;
        aOnlyFocusUntilUserEditRef.current = false;
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const input = inputRef.current;
          if (!input) return;
          input.focus({ preventScroll: true });
          if (selectAll) {
            try {
              input.select();
            } catch (_) { /* ignore */ }
          }
        });
      });
    };
    window.addEventListener(DOM_EVENT.OMNIBOX_REQUEST_FOCUS, onRequestFocus);
    return () => window.removeEventListener(DOM_EVENT.OMNIBOX_REQUEST_FOCUS, onRequestFocus);
  }, [currentTabId]);

  const handlePointerDown = useCallback(() => {
    if (aOnlyFocusUntilUserEditRef.current) {
      aOnlyFocusUntilUserEditRef.current = false;
      suppressOverlayOnNextAFocusRef.current = false;
    }
  }, []);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    didSelectRef.current = false;

    if (aOnlyFocusUntilUserEditRef.current) {
      return;
    }

    if (suppressOverlayOnNextAFocusRef.current || hasUncommittedDraft) {
      suppressOverlayOnNextAFocusRef.current = false;
      return;
    }

    const initial = (hasUncommittedDraft || committedDraftPendingRef.current)
      ? draftValue
      : displayUrl;
    setDraftValue(initial);
    if (isInternalDisplayUrl(initial)) {
      return;
    }
    const caret = initial.length;
    openOverlay(initial, { start: caret, end: caret }, {
      queryOnOpen: !initial.trim(),
      preferCache: true,
    });
  }, [displayUrl, draftValue, hasUncommittedDraft, openOverlay]);

  const handleMouseUp = useCallback(() => {
    if (isFocused && didSelectRef.current) {
      didSelectRef.current = false;
    }
  }, [isFocused]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    if (overlayOpenRef.current) return;
    if (
      !hasUncommittedDraft
      && !committedDraftPendingRef.current
      && draftValueRef.current !== displayUrlRef.current
    ) {
      revertDraftToDisplayUrl();
    } else if (!hasUncommittedDraft && !committedDraftPendingRef.current) {
      setDraftValue(displayUrl);
    }
    setGhostSuffix('');
    if (inputRef.current) inputRef.current.setSelectionRange(0, 0);
  }, [displayUrl, hasUncommittedDraft, revertDraftToDisplayUrl]);

  const handleChange = useCallback((e) => {
    const val = e.target.value;
    const sel = readSelection(e.target);
    selectionRef.current = sel;
    setDraftValue(val);
    setGhostSuffix('');
    isNavigatingRef.current = false;
    controller.unlockList();

    if (!overlayOpenRef.current) {
      overlayEditedRef.current = true;
      openOverlay(val, sel, { queryOnOpen: true, preferCache: true });
      return;
    }
    runQuery(val);
  }, [controller, openOverlay, runQuery]);

  const handleKeyDown = useCallback((e) => {
    const { key } = e;

    if (overlayOpenRef.current) {
      if (key === KEYBOARD.ESCAPE) {
        e.preventDefault();
        const base = overlaySessionBaseRef.current;
        const current = draftValueRef.current;
        const edited = overlayEditedRef.current || current !== base;
        closeOverlay();
        if (edited) revertDraftToDisplayUrl();
        setIsFocused(false);
      }
      return;
    }

    if (key === KEYBOARD.ENTER) {
      e.preventDefault();
      navigateFromDraft(draftValue, -1);
      return;
    }

    if (key === KEYBOARD.ESCAPE) {
      e.preventDefault();
      revertDraftToDisplayUrl();
      inputRef.current?.blur();
      return;
    }

    if (hasUncommittedDraft || suppressOverlayOnNextAFocusRef.current || aOnlyFocusUntilUserEditRef.current) {
      const opensOverlay = key.length === 1
        || key === KEYBOARD.BACKSPACE
        || key === 'Delete';
      if (opensOverlay) {
        suppressOverlayOnNextAFocusRef.current = false;
        aOnlyFocusUntilUserEditRef.current = false;
        const sel = readSelection(inputRef.current);
        selectionRef.current = sel;
        openOverlay(inputRef.current?.value ?? draftValue, sel, {
          queryOnOpen: true,
          preferCache: true,
        });
      }
    }
  }, [
    draftValue,
    displayUrl,
    hasUncommittedDraft,
    navigateFromDraft,
    openOverlay,
    revertDraftToDisplayUrl,
  ]);

  const isSecure = (overlayOpen ? draftValue : barDisplayValue).startsWith(URL_C.SCHEME_HTTPS);
  const displayParts = buildDisplayParts(barDisplayValue);

  const showShellInput = isFocused && !overlayOpen;

  return (
    <div
      className={`url-container${overlayOpen ? ' omnibox-overlay-active' : ''}`}
      ref={containerRef}
    >
      {showShellInput && (isSecure ? <LockIcon /> : <SearchIcon />)}

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
        value={draftValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPointerDown={handlePointerDown}
        onMouseUp={handleMouseUp}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        spellCheck={false}
        aria-expanded={overlayOpen}
      />

      {!isFocused && !overlayOpen && displayParts && (
        <div className="url-display">
          {displayParts.prefix && <span>{escapeHtml(displayParts.prefix)}</span>}
          <span className="domain">{escapeHtml(displayParts.domain)}</span>
          {displayParts.suffix && <span>{escapeHtml(displayParts.suffix)}</span>}
        </div>
      )}

      {!isFocused && !overlayOpen && !displayParts && (
        <div className="omnibox-unfocused-placeholder" aria-hidden="true">
          Search or enter address
        </div>
      )}
    </div>
  );
}
