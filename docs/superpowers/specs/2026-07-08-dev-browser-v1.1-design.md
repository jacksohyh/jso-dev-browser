# dev-browser v1.1 — Design Spec

Date: 2026-07-08
Status: Approved pending user review
Builds on: `2026-07-08-dev-browser-design.md` (v1, complete)

## Purpose

Four additions to the completed dev-browser, all serving the multi-account developer workflow:

1. **Session grouping** — visually mark tabs that share a session, and keep them contiguous.
2. **Switch hotkeys** — forward-cycle tabs and groups from the keyboard.
3. **Password manager** — Chrome-style save + autofill, OS-encrypted, multiple accounts per site.
4. **Settings cog** — a top-right settings entry point hosting the password manager and a shortcuts reference.

## 1. Session grouping

A "session" is a session partition (`persist:tab-<uuid>`). Solo tabs each have a unique partition; **Duplicate** makes tabs that share one. This feature makes shared sessions visible and orderly.

### Color accent
- A deterministic palette (8 colors). Each partition that is shared by 2+ tabs is assigned the next palette color; solo-partition tabs get no accent (neutral).
- The tab chip renders a 2px colored top border in the session color when its partition is shared.
- Color assignment is computed in the renderer from the current state (stable: sort the shared partitions by first appearance order, map to palette by index, wrap if >8). No new persisted field.

### Contiguity invariant
Tabs sharing a partition are always adjacent in their group's tab array — the UI can never show `[S1][S2][S1]`.
- `AppStore.duplicateTab` inserts the new tab **immediately after the last tab in the source tab's partition cluster within that group**, not at the end of the array.
- New tabs (`addTab`) append at the end (a fresh solo block).
- No drag-reorder exists, so these two insert rules fully preserve the invariant. `closeTab` removal never breaks contiguity.

### Files
- `src/main/state.ts` — change `duplicateTab` insert position; keep return value identical.
- `src/renderer/src/chrome/sessionColors.ts` (new) — pure `assignSessionColors(groups): Map<partition, color|null>`; unit-tested.
- `src/renderer/src/chrome/TabBar.tsx` + `styles.css` — apply the color as a top border.

## 2. Switch hotkeys

Forward-only, wrapping. Added to the existing `wireShortcuts` in `src/main/index.ts`.
- `Ctrl+Tab` → activate the next tab in the active group (wraps last→first); no-op if the group has 0–1 tabs.
- `Ctrl+Shift+Tab` → activate the first tab of the next group (wraps last→first); no-op if there is only one group. If the target group has no tabs, it just becomes active (no tab selected).

### Files
- `src/main/state.ts` — add pure helpers `nextTab()` and `nextGroup()` that mutate active selection and emit; unit-tested (wrap-around, single-tab, single-group, empty-group edge cases).
- `src/main/index.ts` — two new branches in `wireShortcuts` (note: `Ctrl+Tab` arrives as `key === 'Tab'`; distinguish shift via `input.shift`). These must be caught before the browser's own focus traversal — `before-input-event` with `preventDefault` already does this.

## 3. Password manager

### Storage & security
- Single file `passwords.json` in `app.getPath('userData')`.
- Each entry: `{ id, origin, username, secret }` where `secret` is `safeStorage.encryptString(password)` stored base64. `origin`/`username` are plaintext (needed for lookup and the dropdown).
- Encryption is DPAPI-backed on Windows via Electron `safeStorage`; keys are tied to the OS user, so the file is useless if copied elsewhere. Auto-unlock (no master password in v1.1). If `safeStorage.isEncryptionAvailable()` is false, the manager disables saving and shows a one-line notice rather than storing plaintext.
- **Scope is global** (not per session partition): a saved credential can be filled into any tab. This is deliberate — cookies stay per-tab isolated; only the reusable secret is shared. Keyed by `(origin, username)`, so multiple accounts per origin coexist.
- A per-origin **ignore list** (`neverOrigins: string[]`) suppresses the save prompt for sites the user dismissed with "Never".

### Save flow
- An injected preload script (`autofill-preload`, attached to every tab's `WebContentsView` via `webPreferences.preload`) listens for `submit` on any form containing a `type=password` field. On submit it reads the password value and the best-guess username (nearest preceding `type=text`/`type=email`/`autocomplete=username` field) and posts `{ origin, username, password }` to main.
- Main ignores it if the origin is in `neverOrigins` or an identical `(origin, username, password)` already exists. Otherwise it sends the chrome renderer a save-prompt request.
- The chrome UI shows a save bar (below the address row, transient): `Save password for <username>@<origin>? [Save] [Never] [✕]`. Save persists (encrypted); Never appends the origin to `neverOrigins`; ✕ dismisses without recording.

### Autofill flow
- On `did-finish-load`, the injected script asks main for saved logins for the tab's current top-frame origin. Main returns `[{ id, username }]` (no secrets yet).
- If any exist, focusing a password or username field renders a small in-page dropdown (built by the injected script in a shadow-root overlay, so page CSS can't style it) listing usernames. Selecting one requests the secret for that `id` from main, then fills the username + password fields. Never auto-submits.
- **Security constraints:** only fills when the saved `origin` exactly equals the top-level document origin (no cross-origin iframe fills); the secret for an `id` is only released on an explicit user selection, never on page load.

### Files
- `src/main/vault.ts` (new) — `Vault` class: load/save `passwords.json`, `list(origin)`, `get(id)`, `add(origin, username, password)`, `remove(id)`, `never(origin)`, `isNever(origin)`. `safeStorage` injected for unit tests (mockable); pure logic (dedupe, ignore list, keying) tested without Electron.
- `src/main/autofillBridge.ts` (new) — registers IPC: `autofill:query(origin)→[{id,username}]`, `autofill:secret(id)→password|null`, `autofill:captured({origin,username,password})→triggers prompt`. Holds a `Vault` instance.
- `src/renderer/autofill-preload.ts` (new) — the injected content script (form-submit capture + dropdown overlay). Bundled as a separate preload entry.
- `src/main/tabs.ts` — add the autofill preload to each `WebContentsView`'s `webPreferences` (alongside the existing partition).
- `src/preload/index.ts` + chrome UI — save-prompt channel + `SavePrompt` component.

## 4. Settings cog

- A cog button at the right end of the group row (`GroupBar`).
- Opens a settings surface. Chosen approach: a **separate `BrowserWindow`** loading a new `settings.html` renderer entry (mirrors the API-panel window pattern already in the codebase — avoids overlaying the WebContentsView, which we learned can't be covered by DOM).
- v1.1 contents:
  - **Saved Passwords** — list grouped by origin; each row shows username with reveal (calls `autofill:secret`), copy, and delete. Also lists/clears `neverOrigins`.
  - **Shortcuts** — static reference of all keybindings.
- Managed by a `SettingsWindow` manager in main (open/focus/close, single instance), with IPC for the password CRUD it needs.

### Files
- `src/renderer/settings.html` + `src/renderer/src/settings/*` (new React entry).
- `src/main/settingsWindow.ts` (new) — single-instance window manager.
- `electron.vite.config.ts` — add `settings` and the `autofill-preload` build inputs.
- `src/main/index.ts` — wire the cog IPC + settings/vault/autofill managers.

## Architecture summary

New main modules (each one responsibility, testable in isolation): `vault.ts` (encrypted CRUD), `autofillBridge.ts` (IPC glue), `settingsWindow.ts` (window lifecycle). New renderer entries: `autofill-preload` (injected content script), `settings/*` (settings UI), plus `sessionColors.ts` and `SavePrompt` in the chrome UI. Store gains `duplicateTab` insert-adjacent + `nextTab`/`nextGroup`. Wiring lands in `index.ts`.

## Error handling
- `safeStorage` unavailable → saving disabled with a notice; existing entries (if any) unreadable are skipped, never crash.
- Corrupt `passwords.json` → start empty (same fallback pattern as `stateFile`), never crash.
- Autofill query for an origin with no matches → dropdown simply doesn't appear.
- Injected script errors are sandboxed to the page and must never break navigation.

## Testing
- Unit (vitest, no Electron): `sessionColors` assignment; `AppStore.duplicateTab` contiguity + `nextTab`/`nextGroup` wrap-around; `Vault` CRUD/dedupe/ignore-list/keying with a mocked `safeStorage`.
- Manual (Electron): save prompt on a real login submit; dropdown fill of one of multiple accounts; no cross-origin iframe fill; encrypted-at-rest check (inspect `passwords.json` — password unreadable); Ctrl+Tab / Ctrl+Shift+Tab cycling; session color bars on duplicates; settings window password reveal/delete.

## Out of scope (v1.1)
Master-password lock, password generation, breach/reuse warnings, sync, import/export, autofill of non-login fields (addresses/cards), reverse-cycle hotkeys, drag-reorder of tabs.
