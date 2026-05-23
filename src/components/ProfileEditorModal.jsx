import React, { useCallback, useEffect, useRef, useState } from 'react';
import ProfileAvatar from './ProfileAvatar';
import { loadProfilePresetAvatars } from '../utils/profilePresetAvatars';
import './ProfileEditorModal.css';
import { PROFILE } from '../constants/conditionStrings.js';

const CAMERA_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const PRESET_CHECK = (
  <svg className="profile-editor-preset-check-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"
    />
  </svg>
);

export default function ProfileEditorModal({
  open,
  mode,
  initialProfile,
  onClose,
  onSaved,
}) {
  const [name, setName] = useState('');
  /** Preview src: data URL (file pick) or app:// URL (preset). */
  const [avatarPreviewSrc, setAvatarPreviewSrc] = useState(null);
  const [pendingAvatarDataUrl, setPendingAvatarDataUrl] = useState(null);
  const [pendingPresetFileName, setPendingPresetFileName] = useState(null);
  const [removeAvatarOnSave, setRemoveAvatarOnSave] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [presetAvatars, setPresetAvatars] = useState([]);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setPendingAvatarDataUrl(null);
    setPendingPresetFileName(null);
    setRemoveAvatarOnSave(false);
    setSelectedPresetId(null);
    setPresetAvatars([]);
    let cancelled = false;
    (async () => {
      const list = await loadProfilePresetAvatars();
      if (!cancelled) setPresetAvatars(list);
    })();
    if (mode === PROFILE.MODE_CREATE) {
      setName('');
      setAvatarPreviewSrc(null);
      return () => {
        cancelled = true;
      };
    }
    if (initialProfile) {
      setName(initialProfile.displayName || '');
      setAvatarPreviewSrc(null);
      (async () => {
        if (!initialProfile.hasCustomAvatar || !initialProfile.profileId) return;
        try {
          const r = await window.electronAPI.profileGetAvatarDataUrl?.(initialProfile.profileId);
          if (!cancelled && r?.dataUrl) setAvatarPreviewSrc(r.dataUrl);
        } catch {
          /* ignore */
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    return () => {
      cancelled = true;
    };
  }, [open, mode, initialProfile]);

  const handlePickFile = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const onFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose a PNG, JPEG, WebP, or GIF image.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const url = typeof reader.result === 'string' ? reader.result : null;
      if (!url) return;
      const v = await window.electronAPI.profileValidateAvatarData?.(url);
      if (!v?.ok) {
        setError(v?.error || 'Invalid image.');
        return;
      }
      setError(null);
      setSelectedPresetId(null);
      setPendingPresetFileName(null);
      setAvatarPreviewSrc(url);
      setPendingAvatarDataUrl(url);
      setRemoveAvatarOnSave(false);
    };
    reader.onerror = () => {
      setError('Could not read the file.');
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePresetPick = useCallback((preset) => {
    setError(null);
    setSelectedPresetId(preset.id);
    setAvatarPreviewSrc(preset.imageUrl);
    setPendingPresetFileName(preset.fileName);
    setPendingAvatarDataUrl(null);
    setRemoveAvatarOnSave(false);
  }, []);

  const handleRemovePhoto = useCallback(() => {
    setAvatarPreviewSrc(null);
    setPendingAvatarDataUrl(null);
    setPendingPresetFileName(null);
    setRemoveAvatarOnSave(true);
    setSelectedPresetId(null);
    setError(null);
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a profile name.');
      return;
    }
    if (error) {
      return;
    }
    setSaving(true);
    try {
      if (mode === PROFILE.MODE_CREATE) {
        if (pendingAvatarDataUrl && !pendingPresetFileName) {
          const pre = await window.electronAPI.profileValidateAvatarData?.(pendingAvatarDataUrl);
          if (!pre?.ok) {
            setError(pre?.error || 'Invalid photo.');
            setSaving(false);
            return;
          }
        }
        const created = await window.electronAPI.profileCreate?.(trimmed);
        if (!created?.profileId) {
          setError('Could not create profile.');
          setSaving(false);
          return;
        }
        if (pendingPresetFileName) {
          const r = await window.electronAPI.profileSetAvatarFromPresetPng?.({
            profileId: created.profileId,
            fileName: pendingPresetFileName,
          });
          if (!r?.ok) {
            await window.electronAPI.profileDelete?.(created.profileId);
            setError(r?.error || 'Could not save photo. Profile was not created.');
            setSaving(false);
            return;
          }
        } else if (pendingAvatarDataUrl) {
          const r = await window.electronAPI.profileSetAvatarData?.({
            profileId: created.profileId,
            dataUrl: pendingAvatarDataUrl,
          });
          if (!r?.ok) {
            await window.electronAPI.profileDelete?.(created.profileId);
            setError(r?.error || 'Could not save photo. Profile was not created.');
            setSaving(false);
            return;
          }
        }
        onSaved?.({ mode: 'create', profile: created });
      } else if (initialProfile?.profileId) {
        const pid = initialProfile.profileId;
        if (pendingAvatarDataUrl && !pendingPresetFileName) {
          const pre = await window.electronAPI.profileValidateAvatarData?.(pendingAvatarDataUrl);
          if (!pre?.ok) {
            setError(pre?.error || 'Invalid photo.');
            setSaving(false);
            return;
          }
        }
        const u = await window.electronAPI.profileUpdate?.({ profileId: pid, displayName: trimmed });
        if (!u) {
          setError('Could not update name.');
          setSaving(false);
          return;
        }
        if (removeAvatarOnSave) {
          await window.electronAPI.profileClearAvatar?.(pid);
        } else if (pendingPresetFileName) {
          const r = await window.electronAPI.profileSetAvatarFromPresetPng?.({
            profileId: pid,
            fileName: pendingPresetFileName,
          });
          if (!r?.ok) {
            setError(r?.error || 'Could not save photo.');
            setSaving(false);
            return;
          }
        } else if (pendingAvatarDataUrl) {
          const r = await window.electronAPI.profileSetAvatarData?.({
            profileId: pid,
            dataUrl: pendingAvatarDataUrl,
          });
          if (!r?.ok) {
            setError(r?.error || 'Could not save photo.');
            setSaving(false);
            return;
          }
        }
        const refreshed = await window.electronAPI.profileList?.();
        const next = Array.isArray(refreshed) ? refreshed.find((x) => x.profileId === pid) : null;
        onSaved?.({ mode: 'edit', profile: next || u });
      }
      onClose?.();
    } catch {
      setError('Something went wrong.');
    } finally {
      setSaving(false);
    }
  }, [
    mode,
    name,
    error,
    initialProfile,
    pendingAvatarDataUrl,
    pendingPresetFileName,
    removeAvatarOnSave,
    onSaved,
    onClose,
  ]);

  if (!open) return null;

  const previewAvatarSource =
    mode === PROFILE.MODE_EDIT && removeAvatarOnSave
      ? null
      : pendingPresetFileName
        ? 'preset'
        : pendingAvatarDataUrl
          ? 'upload'
          : mode === PROFILE.MODE_EDIT && initialProfile?.hasCustomAvatar
            ? initialProfile.avatarSource === PROFILE.AVATAR_PRESET
              ? 'preset'
              : 'upload'
            : null;

  const previewProfile =
    mode === PROFILE.MODE_EDIT && initialProfile
      ? {
          ...initialProfile,
          displayName: name || initialProfile.displayName,
          hasCustomAvatar: !!(avatarPreviewSrc && !removeAvatarOnSave),
          avatarSource: previewAvatarSource,
        }
      : {
          profileId: '__preview__',
          displayName: name || 'Profile',
          hasCustomAvatar: !!avatarPreviewSrc,
          avatarSource: previewAvatarSource,
        };

  const avatarImageOverride =
    avatarPreviewSrc != null
      ? avatarPreviewSrc
      : removeAvatarOnSave && mode === PROFILE.MODE_EDIT
        ? ''
        : undefined;

  return (
    <div className="profile-editor-overlay" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title">
      <button type="button" className="profile-editor-backdrop" aria-label="Close" onClick={onClose} />
      <div
        className={
          presetAvatars.length > 0
            ? 'profile-editor-dialog profile-editor-dialog--has-presets'
            : 'profile-editor-dialog'
        }
      >
        <div className="profile-editor-dialog-top">
          <h2 id="profile-editor-title" className="profile-editor-title">
            {mode === PROFILE.MODE_CREATE ? 'Add profile' : 'Edit profile'}
          </h2>

          <div className="profile-editor-avatar-block">
            <button
              type="button"
              className="profile-editor-avatar-hit"
              onClick={handlePickFile}
              title="Change profile picture"
            >
              <ProfileAvatar profile={previewProfile} size="lg" imageOverride={avatarImageOverride} />
              <span className="profile-editor-camera">{CAMERA_ICON}</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="profile-editor-file-input"
              onChange={onFileChange}
            />
            {(avatarPreviewSrc || (mode === PROFILE.MODE_EDIT && initialProfile?.hasCustomAvatar && !removeAvatarOnSave)) && (
              <button type="button" className="profile-editor-remove-photo" onClick={handleRemovePhoto}>
                Remove photo
              </button>
            )}
          </div>

          <label className="profile-editor-label" htmlFor="profile-editor-name">Name</label>
          <input
            id="profile-editor-name"
            className="profile-editor-input profile-editor-input--above-presets"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="Profile name"
            maxLength={128}
            autoFocus
          />
        </div>

        {presetAvatars.length > 0 && (
          <section className="profile-editor-presets" aria-label="Preset avatars">
            <h3 className="profile-editor-presets-heading">Pick an avatar</h3>
            <div className="profile-editor-presets-grid">
              {presetAvatars.map((preset) => {
                const isSelected = selectedPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={
                      isSelected
                        ? 'profile-editor-preset profile-editor-preset--selected'
                        : 'profile-editor-preset'
                    }
                    onClick={() => handlePresetPick(preset)}
                    aria-label="Use preset profile picture"
                    aria-pressed={isSelected}
                  >
                    <span className="profile-editor-preset-face">
                      <img
                        className="profile-editor-preset-img"
                        src={preset.imageUrl}
                        alt=""
                        draggable={false}
                      />
                    </span>
                    {isSelected && (
                      <span className="profile-editor-preset-check" aria-hidden>
                        {PRESET_CHECK}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="profile-editor-dialog-footer">
          {error && <p className="profile-editor-error" role="alert">{error}</p>}

          <div className="profile-editor-actions">
            <button type="button" className="profile-editor-btn profile-editor-btn--secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="profile-editor-btn profile-editor-btn--primary"
              onClick={handleSave}
              disabled={saving || !!error || !name.trim()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
