import { useEffect, useRef } from 'react';

function isTransparentDragBackground(bg) {
  if (!bg) return true;
  const normalized = bg.trim().toLowerCase();
  return (
    normalized === 'transparent'
    || normalized === 'rgba(0, 0, 0, 0)'
    || normalized === 'rgba(0,0,0,0)'
  );
}

function isStealthTabChrome(tabEl) {
  return !!tabEl.closest('.header--stealth-window');
}

function readChromeCssVar(name) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || '';
}

/**
 * Match the tab's visible fill: use computed background when set (e.g. hover),
 * otherwise the active slider token (active tabs are transparent over the slider).
 */
function resolveTabDragBackgroundColor(tabEl) {
  const computed = window.getComputedStyle(tabEl).backgroundColor;
  if (!isTransparentDragBackground(computed)) {
    return computed;
  }

  const sliderToken = isStealthTabChrome(tabEl)
    ? '--chrome-slider-stealth'
    : '--chrome-slider';
  const fromToken = readChromeCssVar(sliderToken);
  if (fromToken) return fromToken;

  const headerBg = readChromeCssVar('--chrome-header-bg');
  if (headerBg) return headerBg;

  return computed;
}

/**
 * Pointer-based tab drag hook.
 * Attaches listeners imperatively to avoid triggering React re-renders
 * during animation. On drop, calls onDragEnd(newTabOrderIds[]).
 *
 * @param {object} opts
 * @param {string}   opts.id          - This tab's Redux ID
 * @param {Function} opts.onSwitchTab - Switch to this tab on click
 * @param {Function} opts.onDragEnd   - Called with new ordered ID array on drop
 * @param {Function} opts.onHideTooltip
 * @param {boolean}  [opts.isPinned] - pinned tabs cannot be dragged
 * @param {number}   [opts.pinnedTabCount] - unpinned tabs cannot move left of this index
 * @param {boolean}  [opts.isActive] - if true, pointer tap does not call onSwitchTab (no redundant switch)
 * @returns {React.RefObject} ref – attach to the <div className="tab"> element
 */
export function useTabDrag({
  id,
  onSwitchTab,
  onDragEnd,
  onHideTooltip,
  isPinned = false,
  pinnedTabCount = 0,
  isActive = false,
}) {
  const tabRef = useRef(null);

  // Keep stable refs to callbacks so the effect never needs to re-run
  const cbRef = useRef({});
  cbRef.current = { onSwitchTab, onDragEnd, onHideTooltip, isPinned, pinnedTabCount, isActive };

  useEffect(() => {
    const tabEl = tabRef.current;
    if (!tabEl) return;

    const handlePointerDown = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.close-btn')) return;

      if (!cbRef.current.isActive) {
        cbRef.current.onSwitchTab(id);
      }
      cbRef.current.onHideTooltip();

      if (cbRef.current.isPinned) return;

      let dragStarted = false;
      const startX = e.clientX;
      let offsetX = 0;

      let originalTabs = [];
      let originalRects = [];
      let draggingIndex = -1;
      let finalTargetIndex = -1;
      let dragBackgroundColor = '';

      const onMove = (me) => {
        if (!dragStarted) {
          if (Math.abs(me.clientX - startX) < 6) return; // dead-zone
          dragStarted = true;

          const bar = tabEl.closest('.tab-bar');
          originalTabs = Array.from(bar.querySelectorAll('.tab'));
          originalRects = originalTabs.map(t => t.getBoundingClientRect());
          draggingIndex = originalTabs.indexOf(tabEl);
          finalTargetIndex = draggingIndex;
          bar.classList.add('tab-bar--dragging');
          // Disable tab transitions during drag/drop to avoid jitter on cleanup.
          originalTabs.forEach((t) => { t.style.transition = 'none'; });

          const rect = originalRects[draggingIndex];
          offsetX = me.clientX - rect.left;
          tabEl.classList.add('tab-dragging');
          dragBackgroundColor = resolveTabDragBackgroundColor(tabEl);
          tabEl.style.backgroundColor = dragBackgroundColor;
          // Flag used by tooltip hover guard
          window._draggingTabId = id;
        }

        // ── Constrain to tab bar bounds ──────────────────────────────────
        const barRect = tabEl.closest('.tab-bar').getBoundingClientRect();
        const tabW = originalRects[draggingIndex].width;
        const newX = Math.max(barRect.left, Math.min(me.clientX - offsetX, barRect.right - tabW));
        const dragDx = newX - originalRects[draggingIndex].left;

        // ── Determine new target index ───────────────────────────────────
        let targetIndex = draggingIndex;
        for (let i = 0; i < originalTabs.length; i++) {
          if (i === draggingIndex) continue;
          const center = originalRects[i].left + originalRects[i].width / 2;
          if (i < draggingIndex && me.clientX < center) { targetIndex = i; break; }
          if (i > draggingIndex && me.clientX > center) targetIndex = i;
        }
        const pinCount = cbRef.current.pinnedTabCount || 0;
        if (pinCount > 0 && !cbRef.current.isPinned) {
          targetIndex = Math.max(pinCount, targetIndex);
        }
        finalTargetIndex = targetIndex;

        // ── Animate via transform (no DOM reorder during drag) ───────────
        const draggedWidthWithGap = originalRects[draggingIndex].width + 5;
        const activeSliderLeft = tabEl.offsetLeft + dragDx;
        const activeSliderWidth = tabEl.offsetWidth;
        const trackEl = tabEl.closest('.tab-track');
        if (trackEl && tabEl.classList.contains('active')) {
          trackEl.style.setProperty('--active-left', `${activeSliderLeft}px`);
          trackEl.style.setProperty('--active-width', `${activeSliderWidth}px`);
        }
        originalTabs.forEach((t, i) => {
          if (i === draggingIndex) {
            t.style.transform = `translateX(${dragDx}px)`;
            t.style.zIndex = '9999';
            return;
          }
          if (targetIndex < draggingIndex && i >= targetIndex && i < draggingIndex) {
            t.style.transform = `translateX(${draggedWidthWithGap}px)`;
          } else if (targetIndex > draggingIndex && i > draggingIndex && i <= targetIndex) {
            t.style.transform = `translateX(-${draggedWidthWithGap}px)`;
          } else {
            t.style.transform = '';
          }
        });
      };

      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);

        if (dragStarted) {
          const didReorder = finalTargetIndex !== -1 && finalTargetIndex !== draggingIndex;
          const clearTransformsOnly = () => {
            originalTabs.forEach((t) => {
              t.style.transform = '';
              t.style.zIndex = '';
            });
          };
          const syncSliderToActiveTabSlot = () => {
            const trackEl = tabEl.closest('.tab-track');
            if (!trackEl || !tabEl.classList.contains('active')) return;
            trackEl.style.setProperty('--active-left', `${tabEl.offsetLeft}px`);
            trackEl.style.setProperty('--active-width', `${tabEl.offsetWidth}px`);
          };
          const restoreTransitionsLater = () => {
            window.requestAnimationFrame(() => {
              originalTabs.forEach((t) => {
                t.style.transition = '';
              });
            });
          };

          if (finalTargetIndex !== -1 && finalTargetIndex !== draggingIndex) {
            // Build new id order and hand off to Redux
            const ids = originalTabs.map(t => t.id);
            const [moved] = ids.splice(draggingIndex, 1);
            let dropIndex = finalTargetIndex;
            const pc = cbRef.current.pinnedTabCount || 0;
            if (pc > 0 && !cbRef.current.isPinned) {
              dropIndex = Math.max(pc, dropIndex);
            }
            ids.splice(dropIndex, 0, moved);
            cbRef.current.onDragEnd(ids);
          }

          if (!didReorder) {
            syncSliderToActiveTabSlot();
            clearTransformsOnly();
            restoreTransitionsLater();
          } else {
            // Preserve visual positions through React reorder, then clear transforms.
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                // After DOM reorder snaps to insertion slot, align slider to active tab.
                syncSliderToActiveTabSlot();
                clearTransformsOnly();
                restoreTransitionsLater();
              });
            });
          }
        }

        tabEl.classList.remove('tab-dragging');
        tabEl.style.backgroundColor = '';
        const barEl = tabEl.closest('.tab-bar');
        if (barEl) {
          // Keep slider transition disabled until post-drop layout settles,
          // preventing a visual jump from the pre-drop slot.
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              barEl.classList.remove('tab-bar--dragging');
            });
          });
        }
        window._draggingTabId = null;
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    };

    // Middle-click closes
    const handleMouseDown = (e) => {
      if (e.button === 1) { e.preventDefault(); }
    };

    tabEl.addEventListener('pointerdown', handlePointerDown);
    tabEl.addEventListener('mousedown', handleMouseDown);

    return () => {
      tabEl.removeEventListener('pointerdown', handlePointerDown);
      tabEl.removeEventListener('mousedown', handleMouseDown);
    };
  }, [id, isPinned, pinnedTabCount, isActive]);

  return tabRef;
}
