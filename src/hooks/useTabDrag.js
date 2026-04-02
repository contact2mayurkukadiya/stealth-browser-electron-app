import { useEffect, useRef } from 'react';

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
 * @returns {React.RefObject} ref – attach to the <div className="tab"> element
 */
export function useTabDrag({ id, onSwitchTab, onDragEnd, onHideTooltip }) {
  const tabRef = useRef(null);

  // Keep stable refs to callbacks so the effect never needs to re-run
  const cbRef = useRef({});
  cbRef.current = { onSwitchTab, onDragEnd, onHideTooltip };

  useEffect(() => {
    const tabEl = tabRef.current;
    if (!tabEl) return;

    const handlePointerDown = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.close-btn')) return;

      cbRef.current.onSwitchTab(id);
      cbRef.current.onHideTooltip();

      let dragStarted = false;
      const startX = e.clientX;
      let offsetX = 0;

      let originalTabs = [];
      let originalRects = [];
      let draggingIndex = -1;
      let finalTargetIndex = -1;

      const onMove = (me) => {
        if (!dragStarted) {
          if (Math.abs(me.clientX - startX) < 6) return; // dead-zone
          dragStarted = true;

          const bar = tabEl.closest('.tab-bar');
          originalTabs = Array.from(bar.querySelectorAll('.tab'));
          originalRects = originalTabs.map(t => t.getBoundingClientRect());
          draggingIndex = originalTabs.indexOf(tabEl);
          finalTargetIndex = draggingIndex;

          const rect = originalRects[draggingIndex];
          offsetX = me.clientX - rect.left;
          tabEl.classList.add('tab-dragging');
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
        finalTargetIndex = targetIndex;

        // ── Animate via transform (no DOM reorder during drag) ───────────
        const draggedWidthWithGap = originalRects[draggingIndex].width + 5;
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
          // Clear all inline transforms before React re-orders the DOM
          originalTabs.forEach(t => { t.style.transform = ''; t.style.zIndex = ''; });

          if (finalTargetIndex !== -1 && finalTargetIndex !== draggingIndex) {
            // Build new id order and hand off to Redux
            const ids = originalTabs.map(t => t.id);
            const [moved] = ids.splice(draggingIndex, 1);
            ids.splice(finalTargetIndex, 0, moved);
            cbRef.current.onDragEnd(ids);
          }
        }

        tabEl.classList.remove('tab-dragging');
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
  }, [id]); // Only re-run if tab ID changes (never)

  return tabRef;
}
