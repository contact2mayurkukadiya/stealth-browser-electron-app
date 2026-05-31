import React, { useState, useEffect, useRef } from 'react';
import { KEYBOARD } from '../../constants/conditionStrings.js';

// Time range options; null means "All time".
const TIME_RANGES = [
  { label: 'Last 15 min',   ms: 15 * 60 * 1000 },
  { label: 'Last hour',     ms: 60 * 60 * 1000 },
  { label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: 'All time',      ms: null },
];

const CHECK_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
  </svg>
);

export default function ClearDataModal({ onClear, onClose }) {
  const [selectedRangeMs, setSelectedRangeMs] = useState(null); // null = "All time"
  const [clearBrowsingHistory, setClearBrowsingHistory] = useState(true);
  const [clearCookies, setClearCookies] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const firstChipRef = useRef(null);
  const canDelete = clearBrowsingHistory || clearCookies;

  // Trap focus inside modal and auto-focus first chip
  useEffect(() => {
    firstChipRef.current?.focus();

    const handleKeyDown = (e) => {
      if (e.key === KEYBOARD.TAB) {
        const focusable = Array.from(
          document.querySelector('.h-modal')?.querySelectorAll(
            'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
          ) ?? []
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleDelete = async () => {
    if (!canDelete) return;
    setIsDeleting(true);
    try {
      await onClear(selectedRangeMs, {
        browsingHistory: clearBrowsingHistory,
        cookies: clearCookies,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="h-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="h-modal-title"
      onClick={handleOverlayClick}
    >
      <div className="h-modal">
        <h2 id="h-modal-title" className="h-modal-title">Delete browsing data</h2>

        {/* Time range chips */}
        <div className="h-time-chips" role="group" aria-label="Time range">
          {TIME_RANGES.map((range, idx) => {
            const isSelected = range.ms === selectedRangeMs;
            return (
              <button
                key={range.label}
                ref={idx === 0 ? firstChipRef : undefined}
                type="button"
                className={`h-time-chip${isSelected ? ' selected' : ''}`}
                aria-pressed={isSelected}
                onClick={() => setSelectedRangeMs(range.ms)}
              >
                {isSelected && CHECK_ICON}
                {range.label}
              </button>
            );
          })}
        </div>

        {/* Data items */}
        <div className="h-modal-items">
          {/* Browsing history — enabled */}
          <div className="h-modal-item">
            <input
              type="checkbox"
              id="h-clear-browsing"
              checked={clearBrowsingHistory}
              onChange={(event) => setClearBrowsingHistory(event.target.checked)}
              aria-describedby="h-clear-browsing-desc"
            />
            <div className="h-modal-item-body">
              <label htmlFor="h-clear-browsing" className="h-modal-item-label" style={{ cursor: 'pointer' }}>
                Browsing history
              </label>
              <p id="h-clear-browsing-desc" className="h-modal-item-desc">
                Clears pages you have visited in this browser.
              </p>
            </div>
          </div>

          {/* Cookies */}
          <div className="h-modal-item">
            <input
              type="checkbox"
              id="h-clear-cookies"
              checked={clearCookies}
              onChange={(event) => setClearCookies(event.target.checked)}
              aria-describedby="h-clear-cookies-desc"
            />
            <div className="h-modal-item-body">
              <label htmlFor="h-clear-cookies" className="h-modal-item-label" style={{ cursor: 'pointer' }}>
                Cookies and other site data
              </label>
              <p id="h-clear-cookies-desc" className="h-modal-item-desc">
                Clears cookies saved by websites during the selected time range.
              </p>
            </div>
          </div>

          {/* Cache — disabled (future feature) */}
          <div className="h-modal-item disabled">
            <input
              type="checkbox"
              id="h-clear-cache"
              disabled
              aria-describedby="h-clear-cache-desc"
            />
            <div className="h-modal-item-body">
              <label htmlFor="h-clear-cache" className="h-modal-item-label">
                Cached images and files
              </label>
              <p id="h-clear-cache-desc" className="h-modal-item-desc">
                Cache clearing will be available in a future update.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="h-modal-footer">
          <button
            type="button"
            className="h-modal-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="h-modal-delete"
            disabled={isDeleting || !canDelete}
            onClick={handleDelete}
          >
            {isDeleting ? 'Deleting…' : 'Delete data'}
          </button>
        </div>
      </div>
    </div>
  );
}
