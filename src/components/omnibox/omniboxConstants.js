/** Omnibox editing / display modes (Chrome-like state machine). */
export const OMNIBOX_MODE = {
  DISPLAY: 'display',
  EDIT_OVERLAY: 'edit_overlay',
  SHELL_DRAFT: 'shell_draft',
};

/** Shell-menu overlay popup kinds opened from prefix/suffix actions. */
export const OMNIBOX_POPUP = {
  NONE: null,
  SITE_INFO: 'siteInfo',
  DOWNLOAD: 'downloadPanel',
};
