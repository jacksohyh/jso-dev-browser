# dev-browser — Design Spec

Date: 2026-07-08
Status: Approved pending user review

## Purpose

A personal Windows desktop browser (`.exe`) for web development. It solves two Chrome pain points:

1. **Multi-account testing** — log into the same site as different accounts in different tabs at the same time, without incognito windows.
2. **Project organization** — group tabs by project (e.g. one group per running Docker stack and its localhost ports).

Built with Electron + React, packaged with electron-builder into a Windows installer/exe.

## Core Concepts

### Groups
- Top-level containers, shown as a horizontal row of chips: `[Project A] [Project B] [+]`.
- Click to switch; double-click to rename; right-click for a context menu (rename, delete).
- Groups are purely organizational — they have no session behavior of their own. Tabs are added manually (no Docker integration in v1).
- Deleting a group closes all its tabs after a confirm prompt.

### Tabs
- Second row shows the tabs of the selected group: `[Tab 1] [Tab 2] [+]`.
- Rename (double-click), close (x / ctrl+W).
- **`+` (new tab): creates a tab with a brand-new isolated session** — its own cookies, localStorage, and logins, empty at creation (incognito-like start), but **persisted to disk**.
- **Right-click → Duplicate (same session): creates a new tab sharing the *same live session*** as the original. Logging in/out in one is reflected in the other (like two Chrome tabs in one profile).
- Each tab has: name (defaults to page title until renamed), URL, session partition id.

### Sessions
- Implemented as Electron session partitions: each new tab gets `partition: 'persist:tab-<uuid>'`.
- Duplicate = new tab created with the same partition string.
- `persist:` prefix means cookies/storage are written to disk — **all logins survive app restart**.
- A session is deleted from disk when the last tab using it is closed (cleanup of orphaned partitions on startup as a safety net).

### Navigation chrome (row 3)
- Address bar (ctrl+L to focus; typing a bare `3000` or `:3000` is a nice-to-have shortcut for `http://localhost:3000` — optional, not required for v1).
- Back / forward / reload buttons.
- Button to toggle the API panel for the current tab.

## API Panel (custom minimal DevTools)

A **floating window per tab** (toggle via button or F12) that shows only network traffic, focused on API calls:

- Request list: method, URL path, status code, duration. Newest at the bottom, auto-scroll.
- Text filter box (substring match on URL, e.g. `/api/`).
- Type filter: default to `fetch`/XHR only; toggle to show all requests.
- Click a request → detail view: request headers, request body (payload), response headers, **response body pretty-printed as JSON** (raw text fallback for non-JSON).
- Clear button.

**Implementation:** attach to the tab's `webContents` via the Chrome DevTools Protocol (`webContents.debugger`, `Network.*` events; `Network.getResponseBody` for bodies). Events are streamed to the floating window over IPC. Response bodies are fetched lazily (only when a request is clicked) to keep memory low; buffer capped (e.g. last 500 requests per tab).

**Escape hatch:** real Chrome DevTools remains available via ctrl+shift+F12 for the rare console/element-inspection need. Note: CDP allows only one debugger attachment, so while real DevTools is open the API panel pauses capture (documented behavior, acceptable).

## Persistence

- A single JSON state file in the app's userData folder:

```json
{
  "groups": [
    {
      "id": "g1", "name": "Project A",
      "tabs": [
        { "id": "t1", "name": "admin", "url": "http://localhost:3000", "partition": "persist:tab-abc123" }
      ]
    }
  ],
  "activeGroupId": "g1",
  "activeTabByGroup": { "g1": "t1" }
}
```

- Saved debounced on every change; loaded on launch so all groups/tabs/names/URLs reopen, still logged in (cookies live in the partition dirs Electron manages).
- Corrupt/missing state file → start with one empty group; never crash on bad state.

## Architecture

- **Main process (Electron):** owns the `BrowserWindow`, one `WebContentsView` per open tab (only the active tab's view is attached/visible), session partition lifecycle, CDP attachment for the API panel, state file read/write, context menus.
- **Renderer (React):** the chrome UI — group chips, tab strip, address bar. Talks to main via a small typed IPC API (`createTab`, `duplicateTab`, `closeTab`, `navigate`, `renameX`, `switchGroup`, ...). No Node access in renderer (contextIsolation on, preload exposes the API).
- **API panel window:** separate small `BrowserWindow` (React), one per tab on demand, receives network events over IPC.
- Keyboard: ctrl+T new tab, ctrl+W close tab, ctrl+L address bar, F12 API panel, ctrl+shift+F12 real DevTools.

## Error handling

- Page load failures → simple in-view error message with retry (no crash).
- CDP attach failure → API panel shows "capture unavailable" instead of breaking the tab.
- State save failures → keep running, log, retry on next change.

## Testing

- Unit tests for state management (group/tab/session bookkeeping, JSON serialization) — plain vitest, no Electron needed.
- Manual smoke checklist for Electron behaviors: two tabs → two accounts on same site; duplicate shares login; restart keeps logins; API panel shows request/response bodies.

## Out of scope (v1)

History, bookmarks, downloads UI, browser extensions, Docker auto-detection, per-group saved URLs, tab search, split view, drag-reordering tabs.
