# InviSurf

A desktop browser built with **Electron + React + Redux + Vite** focused on:
- tabbed browsing
- private / incognito-like tabs (isolated partitions)
- session restore with lazy tab loading
- bookmarks/history management
- security hardening and redirect protections
- compatibility diagnostics for troubleshooting

---

## ✨ Highlights

- 🗂️ Multi-tab browsing with drag-reorder
- 🕵️ Private tabs (separate in-memory partition)
- 💾 Session restore with sleeping tabs (lazy load)
- 📚 History storage + selective delete + clear all
- 🔖 Bookmarks and folders
- ⚙️ Internal Settings page (`invisurf://settings`; legacy `stealth://settings` still resolves)
- 🧾 Internal History page (`invisurf://history`; legacy `stealth://history` still resolves)
- 🛡️ Security guards for navigation, popups, permissions, and protocol handling
- 🌐 Browser-like UA/headers + redirect guard
- 🧪 Compatibility diagnostics event buffer (optional)

---

## 🧱 Tech Stack

- **Electron** (main process, BrowserWindow, WebContentsView, IPC)
- **React** (UI shell)
- **Redux Toolkit** (tab and UI state)
- **Vite** (renderer builds for main/history/settings pages)

---

## 🚀 Run & Build

```bash
npm install
npm run start
```

### Scripts

- `npm run start` -> build renderer + launch Electron
- `npm run build:renderer` -> build main + history + settings renderer bundles
- `npm run dev:renderer` -> renderer build watch mode
- `npm run dist` -> macOS package
- `npm run dist:win` -> Windows package

---

## 🧭 App Architecture (Simple)

1. **Main process (`main.js`)** creates the window and each tab's `WebContentsView`.
2. **Renderer (`src/App.jsx`)** controls tab strip state and UI interactions.
3. **Preload (`preload.js`)** exposes safe IPC APIs to renderer via `contextBridge`.
4. **Redux (`browserSlice`)** stores tab metadata and ordering.
5. Main process sends updates (`tab-update`, `url-changed`, `tab-created`, etc.) back to renderer.

---

## 🔌 IPC Contract (High Level)

- Renderer -> Main:
  - create/switch/close tab
  - navigate/back/forward/reload
  - bookmarks/history/session/settings actions
- Main -> Renderer:
  - tab title/loading/favicon updates
  - url updates
  - tab created/switched/awoken
  - keyboard shortcut events

---

## 🧠 Feature Flows (Step-by-step)

## 1) 🗂️ Open a New Tab

1. User clicks **+** or presses `Cmd/Ctrl + T`.
2. Renderer dispatches `addTab` in Redux.
3. Renderer sends `new-tab` IPC to main.
4. Main creates a `WebContentsView`, attaches listeners, and loads URL.
5. Main emits `tab-created`/`tab-update`/`url-changed`.
6. Renderer updates visible tab strip and active tab state.

---

## 2) 🔁 Switch Tabs

1. User clicks a tab (or shortcut cycle).
2. Renderer updates `currentTabId` in Redux.
3. Renderer sends `switch-tab` IPC.
4. Main removes non-active views from content area and attaches selected one.
5. Main focuses selected tab webContents.
6. Main notifies renderer with `tab-switched`.

---

## 3) ❌ Close Tab

1. User clicks close button or middle-clicks tab.
2. Renderer dispatches `removeTab`.
3. Renderer sends `close-tab` IPC.
4. Main destroys tab `WebContentsView` and clears related metadata/maps.
5. Renderer chooses next active tab (right neighbor, else left, else new tab).

---

## 4) 🕵️ Open Private Tab

1. User triggers **New Private Tab** shortcut/menu (`Cmd/Ctrl + Shift + T`).
2. Renderer creates tab state with `isStealth = true`.
3. Main creates tab with unique in-memory partition (`in-memory:stealth-<id>`).
4. Private tabs are excluded from session persistence logic.
5. Browsing continues in isolated session storage.

---

## 5) 💾 Session Save + Restore (with Lazy Tabs)

### Save
1. Renderer watches tab changes.
2. Debounced save collects persistent profile tabs (`id/url/title/favicon`) — excluding private tabs.
3. Renderer sends `session:save`.
4. Main encrypts and writes session snapshot.

### Restore
1. On startup, renderer calls `session:load`.
2. Main returns previous session (if startup mode allows).
3. Renderer eagerly creates only active tab.
4. Renderer registers other tabs as **sleeping** (metadata only).
5. On first activation of sleeping tab, main creates real `WebContentsView` and marks it awoken.

---

## 6) 📚 History Tracking

1. Main listens to `did-navigate` and `did-navigate-in-page`.
2. It ignores internal pages and duplicate rapid entries.
3. It encrypts each history row and appends to NDJSON.
4. Renderer can request:
   - full history
   - remove selected items by timestamp
   - clear all history

---

## 7) 🔖 Bookmarks & Folders

1. Renderer reads bookmarks via IPC.
2. Add/remove/reorder actions go through main handlers.
3. Main persists bookmark file.
4. Main broadcasts `bookmarks:updated`.
5. Renderer refreshes bookmark UI immediately.

---

## 8) ⚙️ Internal Pages (`invisurf://history`, `invisurf://settings`)

1. User enters internal URL or uses shortcut/menu.
2. Renderer opens singleton tab (reuses if already open).
3. Main resolves `invisurf://...` (and legacy `stealth://...`) to internal app URLs.
4. Custom `app://` protocol serves correct renderer file.
5. Tab displays canonical internal page.

---

## 9) 🛡️ Security Guardrails

1. Main denies unexpected permissions (except allowed fullscreen flow).
2. Main blocks popup windows unless explicitly handled by app logic.
3. Main blocks unsafe navigations to non-`http/https/app` schemes.
4. Main validates trusted IPC sender origin before handling sensitive actions.
5. Preload exposes only approved API surface to renderer.

---

## 10) 🌐 Redirect & Network Protections

1. Main sets browser-like User-Agent and `Accept-Language`.
2. Main installs per-session webRequest handlers.
3. Main detects suspicious redirect loops and known tracking redirect patterns.
4. Suspicious requests are canceled.
5. Main logs optional compatibility diagnostic events for troubleshooting.

---

## 11) 🧪 Compatibility Diagnostics (Optional)

1. If enabled in settings, main records structured navigation/network events per tab.
2. Events are stored in in-memory ring buffers (`MAX_EVENTS_PER_TAB`).
3. Renderer/tools can request tab-specific or full report snapshot.
4. Reports include environment metadata and active tab ID.
5. Buffers can be cleared per tab or globally.

---

## 12) 🧯 Navigation Error Handling

1. Main listens for `did-fail-load`.
2. Ignores non-main-frame and aborted loads.
3. For DNS-style input errors, auto-fallback to Google search.
4. For other errors, classifies issue and shows actionable error HTML page.
5. Records diagnostics (if enabled).

---

## 📁 Key Files

- `main.js` -> main process, windows/tabs/security/protocol/network/history/session/bookmarks/settings
- `preload.js` -> secure API bridge for renderer
- `src/App.jsx` -> root UI orchestration + session restore + tab actions
- `src/store/browserSlice.js` -> tab strip state model/reducers
- `src/hooks/useElectronIPC.js` -> centralized IPC event registration
- `compatibilityDiagnostics.js` -> in-memory diagnostic event buffer

---

## 📝 Notes

- Internal pages use `invisurf://...` display URLs (legacy sessions may still carry `stealth://...`; main treats them as aliases).
- Session/history data are encrypted before writing.
- Tab metadata in Redux is separate from actual `WebContentsView` lifecycle in main process.

## Upcomming Features

- Profiles/History/Settings/Bookmarks Export and import
- Profiles/History/Settings/Bookmarks Server Sync
- Tab Groups
- Extension Support
- Download/Permission Popups
- Split Tabs
- InBuilt VPN
- InBuild AdBlocker
- Omnibox Fixes
- Auto-complete menu item fix - show netiv query instead of url.
- 