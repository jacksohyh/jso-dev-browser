# dev-browser v1.2 — MCP Automation Bridge Design Spec

Date: 2026-07-08
Status: Approved pending user review
Builds on: v1 + v1.1 (both complete)

## Purpose

Let Claude / Cowork drive **this** browser (not real Chrome) for automated UI testing, over the Model Context Protocol. The unique value versus the existing Chrome-based playbook: the browser's per-tab isolated sessions allow **parallel multi-role testing** — e.g. a salesperson tab and an operation tab, both logged in, driven at once — plus assertions against real captured API traffic.

Target consumer workflow: the human logs into each role in its own tab (per the existing `design-den-v2` TestPlaybook convention "the tester logs in, not Cowork"); Cowork then navigates/reads/clicks/fills and asserts, addressing tabs explicitly so it can interleave roles.

## Architecture

An **embedded MCP server in the Electron main process**, hosting the MCP **Streamable HTTP** transport bound to `127.0.0.1`. Claude/Cowork connects as a **custom connector by URL** (`http://127.0.0.1:<port>/mcp?token=<token>`). No subprocess launch — the browser is already running when testing. Tools are thin wrappers over existing v1/v1.1 code (`TabManager`, `AppStore`, `NetworkCapture`/`RequestLog`), plus a small injected snapshot/interaction script run via `webContents.executeJavaScript`.

### New modules
- `src/main/mcp/server.ts` — starts/stops the HTTP MCP server; token auth middleware; registers tools; lifecycle tied to the Settings toggle.
- `src/main/mcp/tools.ts` — the tool definitions (name, JSON-schema input, handler). Handlers call into a `BrowserDriver`.
- `src/main/mcp/browserDriver.ts` — the bridge to the app: resolve `tabId`→`WebContentsView`, navigate/back/reload, run the injected snapshot/click/fill, screenshot, pull network summaries. Reuses `TabManager`, `AppStore`, `PanelManager`/`NetworkCapture`.
- `src/main/mcp/pageScript.ts` — the string of JS injected via `executeJavaScript`: builds the snapshot, tags interactive elements with `data-mcp-ref`, resolves click/fill by `ref | text | selector`. Pure DOM code.
- `src/main/mcp/snapshot.ts` — pure serializer/format helpers + input validation, unit-tested (no Electron).
- Config: an `mcp` block in `AppState` (enabled flag, port, token) persisted via the existing state file.

## Connection & security

The bridge can drive tabs holding live logins, so it is **off by default** and gated:
- **Settings → "Automation bridge"**: a toggle (off by default) to start/stop the server, the current connect URL (copyable), the token (with regenerate), and the listening port.
- Server binds **`127.0.0.1` only** — never `0.0.0.0`.
- Every MCP request must carry the token (query param on the connector URL, re-checked per request). Missing/incorrect token → 401, no tool runs.
- Regenerating the token invalidates the old URL immediately.
- Default port 47800; if taken, the app picks the next free port and shows the actual URL.
- The token lives in the persisted `mcp` config (same at-rest posture as the rest of state; it is a localhost capability token, not a password).

## MCP tools

All tabId params are optional; omitted → the active tab. Tools return structured JSON (and, for screenshot, an image content block).

| Tool | Input | Returns |
|---|---|---|
| `list_tabs` | — | `[{ tabId, group, title, url, sessionColor|null, active }]` |
| `open_tab` | `{ group?, url?, sessionOf? }` | `{ tabId }` — new tab in `group` (created if new); fresh session, or shares `sessionOf`'s partition when given |
| `navigate` | `{ tabId?, url }` | `{ ok, url }` (url normalized via existing `normalizeUrl`) |
| `go_back` / `reload` | `{ tabId? }` | `{ ok }` |
| `read` | `{ tabId? }` | `{ url, title, snapshot }` — snapshot = nested list of visible nodes with `role`, `name`/text, and `ref` for interactive ones |
| `click` | `{ tabId?, ref?, text?, selector? }` | `{ ok }` or `{ ok:false, reason }` if not found/ambiguous |
| `fill` | `{ tabId?, ref?, selector?, value }` | `{ ok }` |
| `wait_for` | `{ tabId?, text?, selector?, urlContains?, timeoutMs? }` | `{ ok, matched }` — polls up to timeout (default 10s) |
| `screenshot` | `{ tabId? }` | image content block (PNG) |
| `read_network` | `{ tabId?, urlContains?, method? }` | `[{ method, url, status, durationMs }]` from the tab's capture (attaches capture if not already) |

### Snapshot & interaction model
- `read` injects `pageScript` to walk the DOM: for each visible element, emit `{ role, name, ref? }`. Interactive elements (links, buttons, inputs, selects, `[role]`, `[onclick]`) get a `ref` and a `data-mcp-ref="<n>"` attribute so later `click`/`fill` can find them fast. Refs are per-`read` (snapshot-scoped); a stale ref returns `{ ok:false, reason:'stale ref, call read again' }`.
- `click`/`fill` resolution order: `ref` (exact) → `selector` (querySelector) → `text` (first visible element whose trimmed text/value/aria-label matches; ambiguous match → `ok:false, reason:'ambiguous'`). `fill` dispatches `input`+`change` (never submit). No coordinate clicking.
- `read_network` reuses `NetworkCapture`: if the tab has no active capture, the driver attaches one (same CDP path as the API panel) so calls are recorded. Returns the `RequestLog` summaries filtered by `urlContains`/`method`.

## Data flow

```
Claude/Cowork ──HTTP(MCP)──► server.ts (token check)
   ► tools.ts (validate input) ► browserDriver.ts
        ├─ TabManager/AppStore  (tabs, groups, sessions, navigate)
        ├─ executeJavaScript(pageScript)  (snapshot, click, fill, wait)
        ├─ webContents.capturePage()      (screenshot)
        └─ NetworkCapture/RequestLog      (read_network)
```

## Error handling
- Unknown `tabId` → tool returns `{ ok:false, reason:'no such tab' }` (never throws across the MCP boundary).
- Element not found / ambiguous / stale ref → `{ ok:false, reason }` so Cowork can re-`read` and retry.
- `executeJavaScript` failure (page navigating) → retry once after a short wait, then `{ ok:false, reason:'page not ready' }`.
- Server bind failure (port busy) → pick next free port; if none in a small range, surface the error in Settings and leave the toggle off.
- Token missing/invalid → HTTP 401 before any tool runs.
- Turning the toggle off closes the server and drops in-flight connections.

## Testing
- **Unit (vitest, no Electron):** snapshot serializer shape; ref/text/selector resolution rules incl. ambiguity + stale ref; tool input-schema validation; token check (accept/reject); `read_network` filtering. `pageScript`'s pure functions tested against a jsdom document where feasible.
- **Manual (Cowork end-to-end):** enable the bridge, add the connector URL, log into two roles in two tabs of design-den-v2, and have Cowork: `list_tabs` → drive salesperson create-contact in tab A and operation create-schedule in tab B, interleaved → assert `read_network` shows the expected `2xx` API calls → screenshot each result. This is the acceptance demo.

## Out of scope (v1.2)
Remote (non-localhost) access, multi-client auth/roles, driving via real Chrome, recording/replay of sessions, assertions DSL, file downloads/uploads automation, cross-machine connectors, running the bridge headless without the window.

## Notes / risks
- MCP HTTP transport + token is the connection contract; if Claude/Cowork's custom-connector support needs a specific transport variant (SSE vs Streamable HTTP), the server should support the current MCP spec transport and this is the one integration point to verify first during implementation (spike it before building the full tool set).
- `executeJavaScript` runs in the page's world; the snapshot script must be self-contained and must not collide with page globals (wrap in an IIFE, namespace the `data-mcp-ref` attribute).
- Reuses the existing per-tab session isolation untouched — the bridge never crosses sessions; `open_tab`'s `sessionOf` is the only way to share one, mirroring the UI's Duplicate.
