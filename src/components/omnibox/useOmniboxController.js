import {
  useState, useRef, useCallback, useEffect, useMemo,
} from 'react';
import AutocompleteController from './AutocompleteController.js';
import { toNavigateUrl } from './AutocompleteInput.js';
import { useChromeOverlay, useChromeShellMenuOverlay } from '../../context/ChromeOverlayContext.jsx';
import { buildDisplayParts, isNtpOmniboxUrl, toOmniboxBarValue } from '../../utils/omniboxDisplayUrl.js';
import { OMNIBOX_POPUP } from './omniboxConstants.js';
import { getOmniboxActions } from './omniboxActions.js';
import {
  URL as URL_C,
  KEYBOARD,
  OVERLAY,
  DOM_EVENT,
} from '../../constants/conditionStrings.js';

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function serializeSuggestionsForOverlay(list) {
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

export function readSelection(input) {
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

export function mapRecentHistoryItems(items) {
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

function rectToPlain(rect) {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

export function useOmniboxController({ currentTabId, tabsData, searchEngine = 'google' }) {
  const tab = tabsData[currentTabId];
  const displayUrl = tab && !tab.isNewTab ? (tab.url || '') : '';

  const { reset, acquire, release } = useChromeOverlay();
  const {
    reset: shellReset,
    acquire: shellAcquire,
    release: shellRelease,
    post: shellPost,
  } = useChromeShellMenuOverlay();

  const [isFocused, setIsFocused] = useState(false);
  const [draftValue, setDraftValue] = useState(displayUrl);
  const [hasUncommittedDraft, setHasUncommittedDraft] = useState(false);
  const [overlayRequested, setOverlayRequested] = useState(false);
  const [overlayDelivered, setOverlayDelivered] = useState(false);
  const [overlayAnchorVersion, setOverlayAnchorVersion] = useState(0);
  const [popup, setPopup] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [ghostSuffix, setGhostSuffix] = useState('');

  const barRef = useRef(null);
  const inputZoneRef = useRef(null);
  const inputRef = useRef(null);
  const didSelectRef = useRef(false);
  const isNavigatingRef = useRef(false);
  const suggestionsRef = useRef([]);
  const selectionRef = useRef({ start: 0, end: 0 });
  const overlayRunIdRef = useRef(0);
  const chromeOmniboxActiveRef = useRef(false);
  const chromeOverlayHeldRef = useRef(false);
  const pendingOwnOmniboxResetRef = useRef(false);
  const overlayRequestedRef = useRef(false);
  const overlayDeliveredRef = useRef(false);
  const suppressOverlayOnNextAFocusRef = useRef(false);
  const aOnlyFocusUntilUserEditRef = useRef(false);
  const overlaySessionBaseRef = useRef('');
  const overlayEditedRef = useRef(false);
  const draftValueRef = useRef(draftValue);
  const ghostSuffixRef = useRef('');
  const committedDraftPendingRef = useRef(false);
  const pendingCommittedUrlRef = useRef('');
  const recentHistoryFallbackRef = useRef([]);
  const recentFallbackSeqRef = useRef(0);
  const recentFallbackKeyRef = useRef(null);
  const activeSuggestionQueryRef = useRef(null);
  const suggestionCacheRef = useRef({ query: null, suggestions: [], ghostSuffix: '' });
  const omniboxOverlayFocusSentRef = useRef(false);
  const displayUrlRef = useRef(displayUrl);
  const navigationBaseRef = useRef('');
  const prevTabLoadingRef = useRef(false);
  const popupOpenRef = useRef(false);
  const popupKindRef = useRef(null);
  const pendingOwnPopupResetRef = useRef(false);

  const controller = useMemo(() => new AutocompleteController(), []);
  useEffect(() => () => controller.dispose(), [controller]);

  suggestionsRef.current = suggestions;
  overlayRequestedRef.current = overlayRequested;
  overlayDeliveredRef.current = overlayDelivered;
  draftValueRef.current = draftValue;
  ghostSuffixRef.current = ghostSuffix;
  displayUrlRef.current = displayUrl;
  popupOpenRef.current = popup != null;
  popupKindRef.current = popup;

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
      console.error('[useOmniboxController] chrome overlay release', err);
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
      if (!overlayRequestedRef.current) return;
      if (String(draftValueRef.current || '').trim() !== key) return;
      if (suggestionsRef.current.length > 0) return;
      suggestionCacheRef.current = { query: queryText, suggestions: mapped, ghostSuffix: '' };
      setSuggestions(mapped);
      setGhostSuffix('');
      if (!isNavigatingRef.current) setSelectedIndex(-1);
    } catch (err) {
      console.warn('[useOmniboxController] Failed to load recent history fallback:', err);
    }
  }, []);

  useEffect(() => {
    void loadRecentHistoryFallback('', false);
  }, [loadRecentHistoryFallback]);

  const closeOverlay = useCallback((options = {}) => {
    const preserveDraft = options?.preserveDraft === true;
    overlayRequestedRef.current = false;
    overlayDeliveredRef.current = false;
    omniboxOverlayFocusSentRef.current = false;
    activeSuggestionQueryRef.current = null;
    setHasUncommittedDraft(preserveDraft);
    suppressOverlayOnNextAFocusRef.current = false;
    setOverlayRequested(false);
    setOverlayDelivered(false);
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
      if (!overlayRequestedRef.current) return;
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
    overlayRequestedRef.current = true;
    overlayDeliveredRef.current = false;
    omniboxOverlayFocusSentRef.current = false;
    setOverlayRequested(true);
    setOverlayDelivered(false);
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
    if (!overlayRequested || !barRef.current) {
      if (chromeOverlayHeldRef.current) {
        void closeOmniboxChrome();
      }
      return undefined;
    }

    const runId = ++overlayRunIdRef.current;
    const dropdownRect = barRef.current.getBoundingClientRect();
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
              console.error('[useOmniboxController] omnibox overlay release after stale acquire', releaseErr);
            }
            return;
          }
          chromeOverlayHeldRef.current = true;
          chromeOmniboxActiveRef.current = true;
        }
        if (runId !== overlayRunIdRef.current) return;
        const focusInput = !omniboxOverlayFocusSentRef.current;
        const postPayload = {
          kind: 'omniboxSuggestions',
          dropdownRect: {
            left: dropdownRect.left,
            top: dropdownRect.top,
            width: dropdownRect.width,
            height: dropdownRect.height,
          },
          selectedIndex: sel,
          query: draftValueRef.current,
          items,
          selectionStart: start,
          selectionEnd: end,
          focusInput,
          ghostSuffix: ghostSuffixRef.current || '',
          isSecure: draftValueRef.current.startsWith(URL_C.SCHEME_HTTPS),
        };
        if (barRef.current) {
          const chromeRect = barRef.current.getBoundingClientRect();
          postPayload.chromeRect = {
            left: chromeRect.left,
            top: chromeRect.top,
            width: chromeRect.width,
            height: chromeRect.height,
          };
        }
        const result = await window.electronAPI?.chromeOverlayV1Post?.(postPayload);
        if (runId !== overlayRunIdRef.current) return;
        if (!result?.ok) {
          closeOverlay();
          return;
        }
        if (result?.delivered === true) {
          setOverlayDelivered(true);
        }
        if (focusInput) omniboxOverlayFocusSentRef.current = true;
      } catch (err) {
        console.error('[useOmniboxController] omnibox overlay post', err);
        closeOverlay();
      } finally {
        pendingOwnOmniboxResetRef.current = false;
      }
    })();

    return () => {
      overlayRunIdRef.current += 1;
    };
  }, [
    overlayRequested,
    overlayAnchorVersion,
    suggestions,
    selectedIndex,
    draftValue,
    ghostSuffix,
    reset,
    acquire,
    release,
    closeOmniboxChrome,
    closeOverlay,
  ]);

  useEffect(() => {
    const unsub = window.electronAPI?.onOmniboxOverlayDelivered?.(() => {
      if (overlayRequestedRef.current) {
        setOverlayDelivered(true);
      }
    });
    return typeof unsub === 'function' ? unsub : undefined;
  }, []);

  useEffect(() => {
    if (!overlayRequested) return undefined;
    let frame = 0;
    const refreshAnchor = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setOverlayAnchorVersion((version) => version + 1);
      });
    };
    window.addEventListener('resize', refreshAnchor);
    const anchorNode = barRef.current;
    const observer = typeof ResizeObserver !== 'undefined' && anchorNode
      ? new ResizeObserver(refreshAnchor)
      : null;
    if (observer && anchorNode) observer.observe(anchorNode);
    refreshAnchor();
    return () => {
      window.removeEventListener('resize', refreshAnchor);
      if (observer) observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [overlayRequested]);

  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlayV1HostEvent?.((data) => {
      if (data?.type === OVERLAY.DISMISS) {
        const base = overlaySessionBaseRef.current;
        const current = draftValueRef.current;
        const edited = overlayEditedRef.current || current !== base;
        const preserveDraft = (
          data.reason === 'outside'
          || data.reason === 'blur'
          || data.reason === 'escape'
        ) && edited;
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
      overlayRequestedRef.current = false;
      overlayDeliveredRef.current = false;
      omniboxOverlayFocusSentRef.current = false;
      activeSuggestionQueryRef.current = null;
      setOverlayRequested(false);
      setOverlayDelivered(false);
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
    if (!hasUncommittedDraft && !overlayRequested && !isFocused) {
      setDraftValue(displayUrl);
    }
  }, [displayUrl, hasUncommittedDraft, overlayRequested, isFocused]);

  const tabIsLoading = !!(tab && tab.isLoading);

  useEffect(() => {
    const wasLoading = prevTabLoadingRef.current;
    prevTabLoadingRef.current = tabIsLoading;
    if (!currentTabId || !wasLoading || tabIsLoading) return;
    if (committedDraftPendingRef.current || overlayRequestedRef.current) return;
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
    overlayRequestedRef.current = false;
    overlayDeliveredRef.current = false;
    omniboxOverlayFocusSentRef.current = false;
    if (chromeOverlayHeldRef.current) {
      setOverlayRequested(false);
      setOverlayDelivered(false);
      setSuggestions([]);
      setGhostSuffix('');
      setSelectedIndex(-1);
      isNavigatingRef.current = false;
      overlayEditedRef.current = false;
      controller.unlockList();
      void closeOmniboxChrome();
    } else {
      setOverlayRequested(false);
      setOverlayDelivered(false);
    }
    setDraftValue(displayUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on tab switch, not each navigation URL update
  }, [currentTabId, controller, closeOmniboxChrome]);

  useEffect(() => {
    const onRequestFocus = (event) => {
      const requestedTabId = event.detail?.tabId;
      if (requestedTabId != null && requestedTabId !== currentTabId) return;
      const shouldOpenOverlay = event.detail?.openOverlay === true;
      const selectAll = !!event.detail?.selectAll;
      if (!shouldOpenOverlay) {
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

  const closePopup = useCallback(async () => {
    if (!popupOpenRef.current) return;
    popupOpenRef.current = false;
    popupKindRef.current = null;
    setPopup(null);
    if (!pendingOwnPopupResetRef.current) {
      try {
        await shellRelease();
      } catch (_) { /* ignore */ }
    }
  }, [shellRelease]);

  const openPopup = useCallback(async (kind, anchorRect, payload = {}) => {
    if (!kind) return;
    if (popupOpenRef.current && popupKindRef.current === kind) {
      await closePopup();
      return;
    }

    if (overlayRequestedRef.current) {
      closeOverlay();
    }

    pendingOwnPopupResetRef.current = true;
    try {
      await shellReset();
      await shellAcquire();
      popupOpenRef.current = true;
      popupKindRef.current = kind;
      setPopup(kind);
      await shellPost({
        kind,
        anchorRect,
        ...payload,
      });
    } catch (err) {
      console.error('[useOmniboxController] popup overlay open', err);
      popupOpenRef.current = false;
      popupKindRef.current = null;
      setPopup(null);
      try {
        await shellRelease();
      } catch (_) { /* ignore */ }
    } finally {
      pendingOwnPopupResetRef.current = false;
    }
  }, [closeOverlay, closePopup, shellReset, shellAcquire, shellPost, shellRelease]);

  useEffect(() => {
    const unsub = window.electronAPI?.onChromeOverlayV1HostEvent?.((data) => {
      if (popupOpenRef.current && data?.type === OVERLAY.DISMISS) {
        void closePopup();
      }
    });
    return () => unsub?.();
  }, [closePopup]);

  useEffect(() => {
    const handleGlobalMouseDown = (e) => {
      if (!popupOpenRef.current) return;
      if (e.target.closest('.omnibox-action-btn')) return;
      void closePopup();
    };
    window.addEventListener('mousedown', handleGlobalMouseDown);
    return () => window.removeEventListener('mousedown', handleGlobalMouseDown);
  }, [closePopup]);

  const handlePointerDown = useCallback(() => {
    if (aOnlyFocusUntilUserEditRef.current) {
      aOnlyFocusUntilUserEditRef.current = false;
      suppressOverlayOnNextAFocusRef.current = false;
    }
  }, []);

  const selectShellInput = useCallback(() => {
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || document.activeElement !== input || overlayRequestedRef.current) return;
      try {
        input.select();
        didSelectRef.current = true;
      } catch (_) { /* ignore */ }
    });
  }, []);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    didSelectRef.current = false;
    selectShellInput();

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
    const initialSelection = { start: 0, end: initial.length };
    selectionRef.current = initialSelection;
    setDraftValue(initial);
    if (isInternalDisplayUrl(initial)) {
      return;
    }
    openOverlay(initial, initialSelection, {
      queryOnOpen: !initial.trim(),
      preferCache: true,
    });
  }, [displayUrl, draftValue, hasUncommittedDraft, openOverlay, selectShellInput]);

  const handleMouseUp = useCallback(() => {
    if (isFocused && didSelectRef.current) {
      didSelectRef.current = false;
    }
  }, [isFocused]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    if (overlayRequestedRef.current) return;
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

    if (!overlayRequestedRef.current) {
      overlayEditedRef.current = true;
      openOverlay(val, sel, { queryOnOpen: true, preferCache: true });
      return;
    }
    runQuery(val);
  }, [controller, openOverlay, runQuery]);

  const handleKeyDown = useCallback((e) => {
    const { key } = e;

    if (popupOpenRef.current && key === KEYBOARD.ESCAPE) {
      e.preventDefault();
      void closePopup();
      return;
    }

    if (overlayRequestedRef.current) {
      if (key === KEYBOARD.ESCAPE) {
        e.preventDefault();
        const base = overlaySessionBaseRef.current;
        const current = draftValueRef.current;
        const edited = overlayEditedRef.current || current !== base;
        if (edited) {
          draftValueRef.current = current;
          setDraftValue(current);
        }
        closeOverlay({ preserveDraft: edited });
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
    hasUncommittedDraft,
    navigateFromDraft,
    openOverlay,
    revertDraftToDisplayUrl,
    closeOverlay,
    closePopup,
  ]);

  const isSecure = (overlayRequested ? draftValue : barDisplayValue).startsWith(URL_C.SCHEME_HTTPS);
  const displayParts = buildDisplayParts(barDisplayValue);
  const actions = useMemo(
    () => getOmniboxActions({
      tab,
      displayParts,
      isSecure,
      searchEngine,
      isFocused,
      hasUncommittedDraft,
      barDisplayValue
    }),
    [tab, displayParts, isSecure, searchEngine, isFocused, hasUncommittedDraft, barDisplayValue],
  );

  const handleActionClick = useCallback((action, event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!action?.opensPopup) return;
    const anchor = event?.currentTarget?.getBoundingClientRect?.();
    if (!anchor) return;

    const anchorRect = rectToPlain(anchor);
    let payload = {};
    if (action.opensPopup === OMNIBOX_POPUP.SITE_INFO) {
      payload = {
        domain: displayParts?.domain || '',
        isSecure,
        favicon: tab?.favicon || null,
      };
    } else if (action.opensPopup === OMNIBOX_POPUP.DOWNLOAD) {
      payload = { domain: displayParts?.domain || '' };
    }
    void openPopup(action.opensPopup, anchorRect, payload);
  }, [displayParts, isSecure, openPopup, tab?.favicon]);

  return {
    barRef,
    inputZoneRef,
    inputRef,
    isFocused,
    overlayDelivered,
    overlayRequested,
    hasUncommittedDraft,
    draftValue,
    ghostSuffix,
    barDisplayValue,
    displayParts,
    isSecure,
    handleFocus,
    handleBlur,
    handleChange,
    handleKeyDown,
    handlePointerDown,
    handleMouseUp,
    handleActionClick,
    popup,
    closePopup,
    actions,
    currentTabId,
    tab,
  };
}
