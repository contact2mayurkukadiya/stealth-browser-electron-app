import React, { useCallback, useEffect, useRef, useState } from 'react';
import ProfileAvatar from '../components/ProfileAvatar';
import ProfileEditorModal from '../components/ProfileEditorModal';
import './ProfilePickerApp.css';

const ICON_PENCIL = (
  <svg className="pp-menu-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const ICON_TRASH = (
  <svg className="pp-menu-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" />
  </svg>
);

const ICON_ELLIPSIS = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <circle cx="12" cy="6" r="1.75" />
    <circle cx="12" cy="12" r="1.75" />
    <circle cx="12" cy="18" r="1.75" />
  </svg>
);

function ProfileCard({
  profile,
  onOpen,
  onEdit,
  onDelete,
  onRenamed,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [nameHover, setNameHover] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile.displayName || profile.profileId);
  const menuWrapRef = useRef(null);
  const nameLeaveTimerRef = useRef(null);

  useEffect(() => {
    setNameDraft(profile.displayName || profile.profileId);
  }, [profile.displayName, profile.profileId, profile.updatedAt]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const clearNameLeaveTimer = useCallback(() => {
    if (nameLeaveTimerRef.current) {
      clearTimeout(nameLeaveTimerRef.current);
      nameLeaveTimerRef.current = null;
    }
  }, []);

  const commitRename = useCallback(async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === (profile.displayName || profile.profileId)) return;
    try {
      await window.electronAPI.profileUpdate?.({
        profileId: profile.profileId,
        displayName: trimmed,
      });
      onRenamed?.();
    } catch {
      /* ignore */
    }
  }, [nameDraft, profile.displayName, profile.profileId, onRenamed]);

  const handleNameMouseEnter = useCallback(() => {
    clearNameLeaveTimer();
    setNameHover(true);
    setNameDraft(profile.displayName || profile.profileId);
  }, [clearNameLeaveTimer, profile.displayName, profile.profileId]);

  const handleNameMouseLeave = useCallback(() => {
    clearNameLeaveTimer();
    nameLeaveTimerRef.current = window.setTimeout(async () => {
      await commitRename();
      setNameHover(false);
    }, 120);
  }, [clearNameLeaveTimer, commitRename]);

  const displayLabel = profile.displayName || profile.profileId;

  return (
    <div className="pp-card">
      <div className="pp-card-menu-anchor" ref={menuWrapRef}>
        <button
          type="button"
          className="pp-card-ellipsis"
          aria-label="Profile options"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          {ICON_ELLIPSIS}
        </button>
        {menuOpen && (
          <div className="pp-card-menu" role="menu">
            <button
              type="button"
              className="pp-card-menu-item"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onEdit(profile);
              }}
            >
              {ICON_PENCIL}
              <span>Edit profile</span>
            </button>
            <button
              type="button"
              className="pp-card-menu-item pp-card-menu-item--danger"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete(profile);
              }}
            >
              {ICON_TRASH}
              <span>Delete profile</span>
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        className="pp-card-avatar-hit"
        onClick={() => onOpen(profile.profileId)}
        title={`Open ${displayLabel}`}
      >
        <ProfileAvatar profile={profile} size="lg" />
      </button>

      <div
        className="pp-card-name-zone"
        onMouseEnter={handleNameMouseEnter}
        onMouseLeave={handleNameMouseLeave}
      >
          {nameHover ? (
            <input
              className="pp-card-name-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
                if (e.key === 'Escape') {
                  setNameDraft(displayLabel);
                  setNameHover(false);
                }
              }}
              onBlur={async () => {
                await commitRename();
                setNameHover(false);
              }}
              maxLength={128}
              autoFocus
              aria-label="Profile name"
            />
          ) : (
            <span className="pp-card-label" title={displayLabel}>
              {displayLabel}
            </span>
          )}
      </div>
    </div>
  );
}

export default function ProfilePickerApp() {
  const [profiles, setProfiles] = useState([]);
  const [error, setError] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState('create');
  const [editingProfile, setEditingProfile] = useState(null);

  const loadProfiles = useCallback(async () => {
    try {
      const list = await window.electronAPI.profileList?.();
      setProfiles(Array.isArray(list) ? list : []);
      setError(null);
    } catch (e) {
      setError('Could not load profiles.');
      setProfiles([]);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const openProfile = useCallback(async (profileId) => {
    if (!profileId) return;
    await window.electronAPI.profileOpenWindow?.(profileId, { closeProfilePicker: true });
  }, []);

  const openCreateEditor = useCallback(() => {
    setEditingProfile(null);
    setEditorMode('create');
    setEditorOpen(true);
  }, []);

  const openEditEditor = useCallback((profile) => {
    setEditingProfile(profile);
    setEditorMode('edit');
    setEditorOpen(true);
  }, []);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditingProfile(null);
  }, []);

  const handleEditorSaved = useCallback(() => {
    loadProfiles();
  }, [loadProfiles]);

  const handleDeleteProfile = useCallback(
    async (profile) => {
      const label = profile.displayName || profile.profileId;
      const ok = window.confirm(`Delete profile “${label}”? This cannot be undone.`);
      if (!ok) return;
      const r = await window.electronAPI.profileDelete?.(profile.profileId);
      if (!r?.ok) {
        setError(r?.error || 'Could not delete profile.');
        return;
      }
      setError(null);
      await loadProfiles();
    },
    [loadProfiles],
  );

  return (
    <div className="pp-page">
      <div className="pp-content">
        <header className="pp-header">
          <h1 className="pp-title">InviSurf</h1>
          <p className="pp-subtitle">Who&apos;s using this browser?</p>
        </header>

        {error && (
          <p className="pp-error" role="alert">
            {error}
          </p>
        )}

        <div className="pp-grid-wrap">
          <div className="pp-grid">
            {profiles.map((profile) => (
              <ProfileCard
                key={profile.profileId}
                profile={profile}
                onOpen={openProfile}
                onEdit={openEditEditor}
                onDelete={handleDeleteProfile}
                onRenamed={loadProfiles}
              />
            ))}
            <button type="button" className="pp-card pp-card--add" onClick={openCreateEditor}>
              <span className="pp-card-add-icon" aria-hidden>
                +
              </span>
              <span className="pp-card-label">Add</span>
            </button>
          </div>
        </div>
      </div>

      <ProfileEditorModal
        open={editorOpen}
        mode={editorMode}
        initialProfile={editingProfile}
        onClose={closeEditor}
        onSaved={handleEditorSaved}
      />
    </div>
  );
}
