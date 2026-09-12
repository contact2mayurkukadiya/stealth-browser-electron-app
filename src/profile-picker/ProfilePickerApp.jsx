import React, { useCallback, useEffect, useRef, useState } from 'react';
import ProfileAvatar from '../components/ProfileAvatar';
import ProfileEditorModal from '../components/ProfileEditorModal';
import { logoPurpleDarkSvg, logoPurpleLightSvg, menuDotsVerticalSvg, menuEditProfileSvg, trashSvg } from '../constants/appAssetUrls';
import './ProfilePickerApp.css';
import { KEYBOARD } from '../constants/conditionStrings.js';
import AssetMaskIcon from '../components/AssetMaskIcon.jsx';

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
      if (e.key === KEYBOARD.ESCAPE) setMenuOpen(false);
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
    <div
      className="pp-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(profile.profileId)}
      onKeyDown={(e) => {
        if (e.key === KEYBOARD.ENTER || e.key === KEYBOARD.SPACE) {
          if (e.target.closest('.pp-card-name-input') || e.target.closest('.pp-card-menu-anchor')) {
            return;
          }
          e.preventDefault();
          onOpen(profile.profileId);
        }
      }}
      title={`Open ${displayLabel}`}
    >
      <div
        className="pp-card-menu-anchor"
        ref={menuWrapRef}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
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
          <AssetMaskIcon icon={menuDotsVerticalSvg} size={16} />
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
              <AssetMaskIcon icon={menuEditProfileSvg} size={16} className="pp-menu-icon" />
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
              <AssetMaskIcon icon={trashSvg} size={16} className="pp-menu-icon" />
              <span>Delete profile</span>
            </button>
          </div>
        )}
      </div>

      <div
        className="pp-card-avatar-hit"
        aria-hidden="true"
      >
        <ProfileAvatar profile={profile} size="lg" />
      </div>

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
                if (e.key === KEYBOARD.ENTER) {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
                if (e.key === KEYBOARD.ESCAPE) {
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
          <div className="pp-hero">
            <div className="pp-hero__brand">
              <div className="pp-hero__mark">
                <img
                  className="pp-hero__logo pp-hero__logo--scheme-light"
                  src={logoPurpleLightSvg}
                  alt=""
                  width={64}
                  height={64}
                  draggable={false}
                />
                <img
                  className="pp-hero__logo pp-hero__logo--scheme-dark"
                  src={logoPurpleDarkSvg}
                  alt=""
                  width={64}
                  height={64}
                  draggable={false}
                />
              </div>
              <h1 className="pp-hero__name">InviSurf</h1>
            </div>
            <p className="pp-subtitle">Who&apos;s using this browser?</p>
          </div>
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
