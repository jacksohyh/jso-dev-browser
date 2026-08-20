# JSO Dev Browser

A minimal, developer-focused browser built on Electron. Made to solve two everyday dev annoyances:

- **Log into the same site as multiple accounts at once** — every new tab is its own isolated, persisted session (no incognito juggling). "Duplicate" a tab to share a session.
- **Group tabs by project** — organise tabs into named groups (e.g. one group per Docker stack / set of ports), each with its own colour-coded sessions.

Plus the essentials, kept lean: a floating **Network** panel (Headers / Payload / Response), find-in-page, page zoom, a password manager (OS-encrypted), a downloads panel, and per-session cookie persistence so you stay logged in across restarts.

## Download

Grab the latest build from the [**Releases**](../../releases) page:

- **Windows** — `DevBrowser-Setup-<version>.exe` (installer, **auto-updates** from Releases) or `DevBrowser-<version>.exe` (portable, no install, no auto-update).
- **macOS** — `DevBrowser-<version>.dmg` or `.zip`. The app is **unsigned**, so on first launch right-click it → **Open** to get past Gatekeeper.

## Features

- Per-tab isolated, persisted sessions (`persist:` partitions)
- Tab groups with colour borders marking same-session clusters
- Middle-click / Ctrl-click / `target=_blank` → new tab in the **same session**
- Network panel with fetch/XHR filter, always-capture, and per-request detail
- Find-in-page (Ctrl+F), zoom (Ctrl +/-/0), reload with load feedback
- Password save + autofill, encrypted with the OS keystore (DPAPI / Keychain)
- Downloads panel with live progress and open / show-in-folder
- "Leave page?" prompt that respects a site's unsaved-changes guard

## Development

Requires Node 20+.

```bash
npm install
npm run dev      # run in development
npm test         # unit tests (vitest)
npm run build    # type-check + bundle
npm run dist     # package a Windows build into release/
```

Releases for Windows + macOS are built automatically by GitHub Actions when a
`v*` tag is pushed (see `.github/workflows/release.yml`).

## Tech

Electron · TypeScript · React · electron-vite · electron-builder

## License

MIT
