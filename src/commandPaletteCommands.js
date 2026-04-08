/** @typedef {{ category: string, label: string, shortcut?: string, keywords?: string, run: () => void }} CommandPaletteItem */

const CATEGORY_ORDER = ['File', 'View', 'Edit', 'History', 'Tab', 'Help'];

/**
 * @param {object} ctx
 * @returns {CommandPaletteItem[]}
 */
export function buildCommandPaletteCommands(ctx) {
  const mac = ctx.platform === 'darwin';
  const S = {
    fileNew: mac ? '⌘T' : 'Ctrl+T',
    fileStealth: mac ? '⌘⇧T' : 'Ctrl+Shift+T',
    fileClose: mac ? '⌘W' : 'Ctrl+W',
    fileQuit: mac ? '⌘Q' : 'Alt+F4',
    viewReload: mac ? '⌘R' : 'Ctrl+R',
    viewSettings: mac ? '⌘,' : 'Ctrl+,',
    tabNext: mac ? '⌃Tab' : 'Ctrl+Tab',
    tabPrev: mac ? '⌃⇧Tab' : 'Ctrl+Shift+Tab',
    tabDup: mac ? '⌘⇧D' : 'Ctrl+Shift+D',
    tabSearch: mac ? '⇧⌘A' : 'Shift+Ctrl+A',
    palette: mac ? '⌘⇧P' : 'Ctrl+Shift+P',
  };

  /** @type {CommandPaletteItem[]} */
  const items = [
    {
      category: 'File',
      label: 'New Tab',
      shortcut: S.fileNew,
      keywords: 'create',
      run: () => ctx.createTab(false),
    },
    {
      category: 'File',
      label: 'New Stealth Tab',
      shortcut: S.fileStealth,
      keywords: 'private incognito',
      run: () => ctx.createTab(true),
    },
    {
      category: 'File',
      label: 'Close Tab',
      shortcut: S.fileClose,
      keywords: '',
      run: () => ctx.closeCurrentTab(),
    },
    {
      category: 'File',
      label: 'Quit',
      shortcut: S.fileQuit,
      keywords: 'exit',
      run: () => { void ctx.runMenuCommand('quit'); },
    },
    {
      category: 'View',
      label: 'Reload',
      shortcut: S.viewReload,
      keywords: 'refresh',
      run: () => ctx.reload(),
    },
    {
      category: 'View',
      label: 'Settings page',
      shortcut: S.viewSettings,
      keywords: 'preferences options',
      run: () => { void ctx.runMenuCommand('open-settings'); },
    },
    {
      category: 'View',
      label: 'View Source',
      keywords: 'html',
      run: () => { void ctx.runMenuCommand('view-source'); },
    },
    {
      category: 'View',
      label: 'Inspect Elements',
      keywords: 'devtools inspector',
      run: () => { void ctx.runMenuCommand('devtools-elements'); },
    },
    {
      category: 'View',
      label: 'JavaScript Console',
      keywords: 'devtools debug',
      run: () => { void ctx.runMenuCommand('devtools-console'); },
    },
    {
      category: 'View',
      label: 'Toggle Full Screen',
      keywords: 'fullscreen',
      run: () => { void ctx.runMenuCommand('toggle-fullscreen'); },
    },
    {
      category: 'Edit',
      label: 'Undo',
      keywords: '',
      run: () => { void ctx.runMenuCommand('edit-undo'); },
    },
    {
      category: 'Edit',
      label: 'Redo',
      keywords: '',
      run: () => { void ctx.runMenuCommand('edit-redo'); },
    },
    {
      category: 'Edit',
      label: 'Cut',
      keywords: '',
      run: () => { void ctx.runMenuCommand('edit-cut'); },
    },
    {
      category: 'Edit',
      label: 'Copy',
      keywords: '',
      run: () => { void ctx.runMenuCommand('edit-copy'); },
    },
    {
      category: 'Edit',
      label: 'Paste',
      keywords: '',
      run: () => { void ctx.runMenuCommand('edit-paste'); },
    },
    {
      category: 'Edit',
      label: 'Select All',
      keywords: '',
      run: () => { void ctx.runMenuCommand('edit-select-all'); },
    },
    {
      category: 'History',
      label: 'Home',
      keywords: 'google start',
      run: () => { void ctx.runMenuCommand('navigate-home'); },
    },
    {
      category: 'History',
      label: 'Back',
      keywords: 'previous',
      run: () => { void ctx.runMenuCommand('history-back'); },
    },
    {
      category: 'History',
      label: 'Forward',
      keywords: 'next',
      run: () => { void ctx.runMenuCommand('history-forward'); },
    },
    {
      category: 'History',
      label: 'History page',
      keywords: 'chronicle stealth',
      run: () => ctx.openHistory(),
    },
    {
      category: 'Tab',
      label: 'New Tab to the Right',
      keywords: 'split',
      run: () => ctx.newTabToRight(),
    },
    {
      category: 'Tab',
      label: 'Select Next Tab',
      shortcut: S.tabNext,
      keywords: '',
      run: () => ctx.switchTabDir(1),
    },
    {
      category: 'Tab',
      label: 'Select Previous Tab',
      shortcut: S.tabPrev,
      keywords: '',
      run: () => ctx.switchTabDir(-1),
    },
    {
      category: 'Tab',
      label: 'Duplicate Tab',
      shortcut: S.tabDup,
      keywords: 'clone',
      run: () => ctx.duplicateTab(),
    },
    {
      category: 'Tab',
      label: 'Mute Site',
      keywords: 'audio sound unmute',
      run: () => ctx.toggleMuteSite(),
    },
    {
      category: 'Tab',
      label: 'Pin Tab',
      keywords: 'unpin',
      run: () => ctx.togglePinTab(),
    },
    {
      category: 'Tab',
      label: 'Close Other Tabs',
      keywords: '',
      run: () => ctx.closeOtherTabs(),
    },
    {
      category: 'Tab',
      label: 'Close Tabs to the Right',
      keywords: '',
      run: () => ctx.closeTabsToTheRight(),
    },
    {
      category: 'Tab',
      label: 'Search Tabs…',
      shortcut: S.tabSearch,
      keywords: 'find switch',
      run: () => ctx.openTabSearch(),
    },
    {
      category: 'Help',
      label: 'Search menu commands',
      shortcut: S.palette,
      keywords: 'command palette help',
      run: () => {},
    },
  ];

  const orderIndex = (cat) => {
    const i = CATEGORY_ORDER.indexOf(cat);
    return i === -1 ? 99 : i;
  };

  items.sort((a, b) => {
    const d = orderIndex(a.category) - orderIndex(b.category);
    if (d !== 0) return d;
    return a.label.localeCompare(b.label);
  });

  return items;
}
