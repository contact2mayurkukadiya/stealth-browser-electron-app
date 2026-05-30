/**
 * Preset list for profile editor: `<index>.png` in renderer/assets/images/profiles.
 * Preview uses `app://` URLs only (no fetch/base64 in the renderer).
 */

const PRESETS_BASE = 'app://localhost/assets/images/profiles';

/**
 * @returns {Promise<Array<{ id: string, imageUrl: string, fileName: string }>>}
 */
export async function loadProfilePresetAvatars() {
  const listResult = await window.electronAPI?.profileListPresetAvatarPngs?.();
  const files = listResult?.ok && Array.isArray(listResult.files) ? listResult.files : [];
  return files.map((file) => ({
    id: `preset-${file.replace(/\.png$/i, '')}`,
    imageUrl: `${PRESETS_BASE}/${file}`,
    fileName: file,
  }));
}
