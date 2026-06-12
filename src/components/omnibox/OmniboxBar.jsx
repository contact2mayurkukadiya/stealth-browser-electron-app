import React from 'react';
import OmniboxPrefix from './OmniboxPrefix.jsx';
import OmniboxSuffix from './OmniboxSuffix.jsx';
import OmniboxInputZone from './OmniboxInputZone.jsx';

export default function OmniboxBar({
  barRef,
  inputZoneRef,
  inputRef,
  actions,
  popup,
  isFocused,
  overlayDelivered,
  overlayRequested,
  draftValue,
  ghostSuffix,
  displayParts,
  handleFocus,
  handleBlur,
  handleChange,
  handleKeyDown,
  handlePointerDown,
  handleMouseUp,
  handleActionClick,
}) {
  return (
    <div ref={barRef} className="url-container omnibox-bar">
      <OmniboxPrefix
        actions={actions}
        popup={popup}
        onActionClick={handleActionClick}
      />
      <OmniboxInputZone
        inputZoneRef={inputZoneRef}
        inputRef={inputRef}
        isFocused={isFocused}
        overlayDelivered={overlayDelivered}
        overlayRequested={overlayRequested}
        draftValue={draftValue}
        ghostSuffix={ghostSuffix}
        displayParts={displayParts}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onMouseUp={handleMouseUp}
      />
      <OmniboxSuffix
        actions={actions}
        popup={popup}
        onActionClick={handleActionClick}
      />
    </div>
  );
}
