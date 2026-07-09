# dev-browser v1.2 — MCP Automation Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed a localhost, token-gated MCP server in the browser so Claude/Cowork can drive its tabs (navigate/read/click/fill/screenshot/assert-on-network) — addressed by optional `tabId` so it can test multiple isolated-session role tabs in parallel.

**Architecture:** An MCP server (`@modelcontextprotocol/sdk`, Streamable HTTP transport) runs in the Electron main process, off by default, started/stopped from a Settings toggle. Tool handlers call a `BrowserDriver` that wraps existing `TabManager`/`AppStore`/`NetworkCapture`; page reads/clicks/fills run via `webContents.executeJavaScript` of a self-contained page script. Pure logic (token check, snapshot serialization, input parsing, network filtering) is Electron-free and unit-tested; the transport handshake is **spiked first** (Task 1) to de-risk the one integration unknown.

**Tech Stack:** `@modelcontextprotocol/sdk` (1.29.x), `zod` (tool input schemas), Electron (WebContentsView, executeJavaScript, capturePage, CDP capture), vitest.

**Spec:** `docs/superpowers/specs/2026-07-08-dev-browser-v1.2-mcp-bridge-design.md`

**Working dir:** repo root `C:\Users\jacks\OneDrive\Dokumenty\GitHub\dev-browser` (Windows/PowerShell), on `master`. Baseline: v1+v1.1 complete, 53 vitest tests passing.

---

## File Structure

```
NEW  src/main/mcp/server.ts         start/stop HTTP MCP server; token auth; port selection
NEW  src/main/mcp/token.ts          pure: token gen + constant-time compare (tested)
NEW  src/main/mcp/snapshot.ts       pure: serialize a raw node tree → compact snapshot text (tested)
NEW  src/main/mcp/pageScript.ts     the self-contained JS string run in the page (snapshot/click/fill/wait)
NEW  src/main/mcp/browserDriver.ts  bridge: tabId→view, navigate/tabs/exec/screenshot/network
NEW  src/main/mcp/tools.ts          registerTools(server, driver): all 11 tools + zod schemas
NEW  tests/mcpToken.test.ts
NEW  tests/mcpSnapshot.test.ts
NEW  tests/mcpNetworkFilter.test.ts
EDIT src/shared/types.ts            + McpConfig; AppState.mcp
EDIT src/main/state.ts              createInitialState mcp defaults; setMcpEnabled/regenMcpToken
EDIT src/main/stateFile.ts          loadState back-compat default for mcp
EDIT src/main/index.ts              construct driver+server; start/stop on toggle; getPath
EDIT src/preload/index.ts           mcp status/enable/regenerate channels
EDIT src/renderer/src/settings/Settings.tsx   "Automation bridge" section
EDIT tests/state.test.ts            mcp config store cases
EDIT tests/stateFile.test.ts        mcp back-compat case
```

---

### Task 1: Spike — MCP HTTP transport handshake (de-risk first)

**Goal:** prove an in-process MCP server over Streamable HTTP on localhost accepts a client and runs one tool, gated by a token — before building anything else. This is a throwaway-ish spike that becomes the real `server.ts` skeleton.

**Files:**
- Create: `src/main/mcp/server.ts`
- Create: `scripts/mcp-spike-client.mjs` (temporary verifier; deleted at end of task)

- [ ] **Step 1: Install deps**

Run:
```bash
npm i @modelcontextprotocol/sdk zod
```
Expected: both added to `dependencies`. (These ARE runtime deps — the MCP server ships in the app — so they go in `dependencies`, not devDependencies. electron-builder's asar will include them.)

- [ ] **Step 2: Write `src/main/mcp/server.ts` (minimal, one `ping` tool, token-gated)**

```ts
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import type { Server } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

export interface McpServerHandle {
  port: number
  close: () => Promise<void>
}

/**
 * Starts an MCP server over Streamable HTTP on 127.0.0.1, requiring ?token=<token>.
 * registerTools is called with the McpServer so callers add the real tools; the
 * spike passes a stub that adds `ping`.
 */
export async function startMcpServer(opts: {
  token: string
  preferredPort: number
  registerTools: (server: McpServer) => void
}): Promise<McpServerHandle> {
  const mcp = new McpServer({ name: 'dev-browser', version: '0.2.0' })
  opts.registerTools(mcp)

  // Stateless transport: one server, handles each POST/GET on the endpoint.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await mcp.connect(transport)

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '', 'http://127.0.0.1')
    if (url.searchParams.get('token') !== opts.token) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    await transport.handleRequest(req, res)
  }

  const httpServer: Server = createServer(handler)
  const port = await listenOnFreePort(httpServer, opts.preferredPort)

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        transport.close().catch(() => {})
        httpServer.close(() => resolve())
      })
  }
}

/** Try preferredPort, then a few above it, binding 127.0.0.1 only. */
function listenOnFreePort(server: Server, preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0
    const tryPort = (p: number) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < 10) {
          attempt++
          tryPort(preferred + attempt)
        } else {
          reject(err)
        }
      })
      server.listen(p, '127.0.0.1', () => resolve(p))
    }
    tryPort(preferred)
  })
}

/** Spike-only tool registration; replaced by tools.ts in Task 6. */
export function registerSpikePing(server: McpServer) {
  server.registerTool(
    'ping',
    { title: 'Ping', description: 'Health check', inputSchema: { msg: z.string().optional() } },
    async ({ msg }) => ({ content: [{ type: 'text', text: `pong:${msg ?? ''}` }] })
  )
}
```

- [ ] **Step 3: Write the temporary verifier `scripts/mcp-spike-client.mjs`**

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const port = process.argv[2]
const token = process.argv[3]
const url = new URL(`http://127.0.0.1:${port}/mcp?token=${token}`)

const client = new Client({ name: 'spike', version: '0.0.0' })
await client.connect(new StreamableHTTPClientTransport(url))
const tools = await client.listTools()
console.log('TOOLS:', tools.tools.map((t) => t.name).join(','))
const res = await client.callTool({ name: 'ping', arguments: { msg: 'hi' } })
console.log('RESULT:', JSON.stringify(res.content))
await client.close()
```

- [ ] **Step 4: Write a tiny runner and verify the handshake end-to-end**

Create a throwaway `scripts/mcp-spike-run.mjs`:
```js
import { startMcpServer, registerSpikePing } from '../src/main/mcp/server.ts'
```
This won't run directly (TS). Instead verify via a compiled path: add a temporary npm script and use `tsx`. Simplest: install tsx as a dev dep just for the spike:
```bash
npm i -D tsx
```
Create `scripts/mcp-spike-run.mts`:
```ts
import { startMcpServer, registerSpikePing } from '../src/main/mcp/server.js'

const handle = await startMcpServer({
  token: 'spiketoken',
  preferredPort: 47800,
  registerTools: registerSpikePing
})
console.log('LISTENING', handle.port)
```
Run the server in the background and hit it with the client:
```bash
npx tsx scripts/mcp-spike-run.mts &
sleep 2
node scripts/mcp-spike-client.mjs 47800 spiketoken
```
Expected output: `TOOLS: ping` then `RESULT: [{"type":"text","text":"pong:hi"}]`.
Also verify the token gate: `node scripts/mcp-spike-client.mjs 47800 wrongtoken` must fail to connect (401).
Kill the background server process afterward.

If the SDK's transport API differs in 1.29.x (e.g. `handleRequest` signature, import path, or stateless-mode flag), ADJUST `server.ts` to the working incantation and note exactly what changed in your report. The acceptance bar for this task is: **a programmatic MCP client connects, lists `ping`, calls it, and a wrong token is rejected.**

- [ ] **Step 5: Clean up spike scaffolding**

Delete `scripts/mcp-spike-client.mjs`, `scripts/mcp-spike-run.mts`. Keep `src/main/mcp/server.ts` and `registerSpikePing` (used until Task 6 swaps in real tools). Remove `tsx` if you added it only for the spike (`npm remove -D tsx`) — the real tests don't need it.

- [ ] **Step 6: Type-check, test, commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; 53 tests still pass (no new tests this task — it's a spike).
```bash
git add src/main/mcp/server.ts package.json package-lock.json
git commit -m "feat: mcp server transport spike (streamable http + token gate)"
```

**Report must state:** the exact SDK import paths and transport-construction that worked, so later tasks match it.

---

### Task 2: MCP config in state (TDD)

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/state.ts`
- Modify: `src/main/stateFile.ts`
- Test: `tests/state.test.ts`, `tests/stateFile.test.ts`

- [ ] **Step 1: Add `McpConfig` + `AppState.mcp` to `src/shared/types.ts`**

```ts
export interface McpConfig {
  enabled: boolean // server runs only when true; false by default
  port: number // preferred port
  token: string // localhost capability token; required in the connector URL
}
```
Add to `AppState`:
```ts
  mcp: McpConfig
```

- [ ] **Step 2: Failing tests in `tests/state.test.ts`**

Append inside `describe('AppStore', ...)`:
```ts
  it('createInitialState has mcp disabled with a token and default port', () => {
    expect(store.state.mcp.enabled).toBe(false)
    expect(store.state.mcp.port).toBe(47800)
    expect(store.state.mcp.token).toMatch(/^[0-9a-f]{32,}$/)
  })

  it('setMcpEnabled toggles and emits', () => {
    let calls = 0
    store.onChange = () => calls++
    store.setMcpEnabled(true)
    expect(store.state.mcp.enabled).toBe(true)
    store.setMcpEnabled(false)
    expect(store.state.mcp.enabled).toBe(false)
    expect(calls).toBe(2)
  })

  it('regenMcpToken replaces the token and emits', () => {
    const before = store.state.mcp.token
    store.regenMcpToken()
    expect(store.state.mcp.token).not.toBe(before)
    expect(store.state.mcp.token).toMatch(/^[0-9a-f]{32,}$/)
  })
```

- [ ] **Step 3: Run — verify FAIL**

Run: `npx vitest run tests/state.test.ts`
Expected: FAIL (`mcp` undefined; methods missing).

- [ ] **Step 4: Implement in `src/main/state.ts`**

At the top, ensure `randomUUID` is imported (it is). Add a token helper near `newPartition`:
```ts
export function newMcpToken(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
}
```
In `createInitialState`, add `mcp` to the returned object:
```ts
  return {
    groups: [g],
    activeGroupId: g.id,
    activeTabByGroup: {},
    zoom: 0,
    mcp: { enabled: false, port: 47800, token: newMcpToken() }
  }
```
Add methods to `AppStore`:
```ts
  setMcpEnabled(enabled: boolean) {
    this.state.mcp.enabled = enabled
    this.emit()
  }

  regenMcpToken() {
    this.state.mcp.token = newMcpToken()
    this.emit()
  }
```

- [ ] **Step 5: Back-compat in `src/main/stateFile.ts`**

In `loadState`, just before `return data as AppState`, after the existing zoom default line, add:
```ts
    if (typeof data.mcp !== 'object' || data.mcp === null) {
      data.mcp = { enabled: false, port: 47800, token: newMcpToken() }
    } else {
      if (typeof data.mcp.enabled !== 'boolean') data.mcp.enabled = false
      if (typeof data.mcp.port !== 'number') data.mcp.port = 47800
      if (typeof data.mcp.token !== 'string' || data.mcp.token.length < 16) data.mcp.token = newMcpToken()
    }
```
Add the import at the top of `stateFile.ts`:
```ts
import { newMcpToken } from './state'
```
(`state.ts` imports only from `node:*` and `../shared/types`, so importing `newMcpToken` from `state` into `stateFile` creates no cycle at module-eval time — `stateFile` already imports `createInitialState` from `state` in tests; confirm no circular import by running tsc.)

- [ ] **Step 6: Failing back-compat test in `tests/stateFile.test.ts`**

```ts
  it('defaults missing mcp config for back-compat', () => {
    const s = createInitialState()
    const { mcp, ...noMcp } = s as any
    writeFileSync(file, JSON.stringify(noMcp))
    const loaded = loadState(file)!
    expect(loaded.mcp).toEqual({ enabled: false, port: 47800, token: expect.any(String) })
    expect(loaded.mcp.token.length).toBeGreaterThanOrEqual(16)
  })
```

- [ ] **Step 7: Run all — verify PASS**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass (53 + 3 state + 1 stateFile = 57).

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/main/state.ts src/main/stateFile.ts tests/state.test.ts tests/stateFile.test.ts
git commit -m "feat: mcp config in app state with back-compat default"
```

---

### Task 3: token util + snapshot serializer + network filter (pure, TDD)

**Files:**
- Create: `src/main/mcp/token.ts`
- Create: `src/main/mcp/snapshot.ts`
- Test: `tests/mcpToken.test.ts`, `tests/mcpSnapshot.test.ts`, `tests/mcpNetworkFilter.test.ts`

These are the Electron-free pieces the driver/tools depend on.

- [ ] **Step 1: Failing `tests/mcpToken.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { tokenMatches } from '../src/main/mcp/token'

describe('tokenMatches', () => {
  it('accepts an exact match', () => {
    expect(tokenMatches('abc123', 'abc123')).toBe(true)
  })
  it('rejects a mismatch', () => {
    expect(tokenMatches('abc123', 'abc124')).toBe(false)
  })
  it('rejects when lengths differ (no throw)', () => {
    expect(tokenMatches('abc', 'abcdef')).toBe(false)
  })
  it('rejects empty/undefined candidate', () => {
    expect(tokenMatches('abc', '')).toBe(false)
    expect(tokenMatches('abc', undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run — FAIL. Then write `src/main/mcp/token.ts`**

```ts
import { timingSafeEqual } from 'node:crypto'

/** Constant-time token comparison; safe on length mismatch and undefined. */
export function tokenMatches(expected: string, candidate: string | undefined | null): boolean {
  if (!candidate) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(candidate)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

- [ ] **Step 3: Failing `tests/mcpSnapshot.test.ts`**

The page script (Task 4) produces a flat array of raw nodes; `serializeSnapshot` turns it into compact, token-cheap text. Node shape: `{ role, name, ref? , level }` (level = indentation depth).
```ts
import { describe, expect, it } from 'vitest'
import { serializeSnapshot, type RawNode } from '../src/main/mcp/snapshot'

describe('serializeSnapshot', () => {
  it('renders roles, names, refs, and indentation', () => {
    const nodes: RawNode[] = [
      { role: 'heading', name: 'Login', level: 0 },
      { role: 'textbox', name: 'Email', ref: 1, level: 1 },
      { role: 'textbox', name: 'Password', ref: 2, level: 1 },
      { role: 'button', name: 'Sign in', ref: 3, level: 1 }
    ]
    const out = serializeSnapshot(nodes)
    expect(out).toBe(
      [
        'heading "Login"',
        '  textbox "Email" [ref=1]',
        '  textbox "Password" [ref=2]',
        '  button "Sign in" [ref=3]'
      ].join('\n')
    )
  })

  it('omits empty names and truncates very long ones', () => {
    const long = 'x'.repeat(300)
    const out = serializeSnapshot([{ role: 'text', name: long, level: 0 }])
    expect(out.length).toBeLessThan(200)
    expect(out.startsWith('text "xxxx')).toBe(true)
    expect(out.endsWith('…"')).toBe(true)
  })

  it('renders a node with no name as just its role', () => {
    expect(serializeSnapshot([{ role: 'img', name: '', level: 0 }])).toBe('img')
  })
})
```

- [ ] **Step 4: Run — FAIL. Then write `src/main/mcp/snapshot.ts`**

```ts
export interface RawNode {
  role: string
  name: string
  ref?: number
  level: number
}

const MAX_NAME = 120

/** Compact, indentation-based rendering of the page snapshot for the LLM. */
export function serializeSnapshot(nodes: RawNode[]): string {
  return nodes
    .map((n) => {
      const indent = '  '.repeat(n.level)
      let name = n.name.trim()
      if (name.length > MAX_NAME) name = name.slice(0, MAX_NAME) + '…'
      const namePart = name ? ` "${name}"` : ''
      const refPart = n.ref !== undefined ? ` [ref=${n.ref}]` : ''
      return `${indent}${n.role}${namePart}${refPart}`
    })
    .join('\n')
}
```

- [ ] **Step 5: Failing `tests/mcpNetworkFilter.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { filterNetwork } from '../src/main/mcp/snapshot'
import type { RequestSummary } from '../src/shared/types'

const reqs: RequestSummary[] = [
  { id: '1', method: 'GET', url: 'http://x/sanctum/csrf-cookie', resourceType: 'Fetch', status: 204, durationMs: 30 },
  { id: '2', method: 'POST', url: 'http://x/api/auth/login', resourceType: 'Fetch', status: 200, durationMs: 120 },
  { id: '3', method: 'GET', url: 'http://x/api/me', resourceType: 'Fetch', status: 200, durationMs: 40 }
]

describe('filterNetwork', () => {
  it('returns compact summaries by default', () => {
    expect(filterNetwork(reqs, {})).toEqual([
      { method: 'GET', url: 'http://x/sanctum/csrf-cookie', status: 204, durationMs: 30 },
      { method: 'POST', url: 'http://x/api/auth/login', status: 200, durationMs: 120 },
      { method: 'GET', url: 'http://x/api/me', status: 200, durationMs: 40 }
    ])
  })
  it('filters by urlContains', () => {
    expect(filterNetwork(reqs, { urlContains: '/api/auth' }).map((r) => r.url)).toEqual(['http://x/api/auth/login'])
  })
  it('filters by method (case-insensitive)', () => {
    expect(filterNetwork(reqs, { method: 'post' }).map((r) => r.url)).toEqual(['http://x/api/auth/login'])
  })
})
```

- [ ] **Step 6: Run — FAIL. Add `filterNetwork` to `src/main/mcp/snapshot.ts`**

```ts
import type { RequestSummary } from '../shared/types'

export interface NetLine {
  method: string
  url: string
  status: number | null
  durationMs: number | null
}

export function filterNetwork(
  reqs: RequestSummary[],
  opts: { urlContains?: string; method?: string }
): NetLine[] {
  return reqs
    .filter((r) => (!opts.urlContains || r.url.includes(opts.urlContains)))
    .filter((r) => (!opts.method || r.method.toLowerCase() === opts.method.toLowerCase()))
    .map((r) => ({ method: r.method, url: r.url, status: r.status, durationMs: r.durationMs }))
}
```

- [ ] **Step 7: Run all — PASS, then commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: pass (57 + 4 token + 3 snapshot + 3 netfilter = 67).
```bash
git add src/main/mcp/token.ts src/main/mcp/snapshot.ts tests/mcpToken.test.ts tests/mcpSnapshot.test.ts tests/mcpNetworkFilter.test.ts
git commit -m "feat: mcp pure helpers — token compare, snapshot serializer, network filter"
```

---

### Task 4: pageScript (injected DOM automation)

**Files:**
- Create: `src/main/mcp/pageScript.ts`

Self-contained JS executed in the page world via `executeJavaScript`. Exposes one entry — `window.__devbMcp(op, args)` — returning JSON-serializable results. Wrapped in an IIFE that installs the function once. No unit tests (browser DOM); exercised in the manual Cowork run.

- [ ] **Step 1: Write `src/main/mcp/pageScript.ts`**

```ts
/**
 * Returns a JS source string to run via webContents.executeJavaScript.
 * It installs window.__devbMcp(op, args) (idempotent) and, when `call` is
 * provided, immediately invokes it and returns the result — so the driver can
 * inject+call in a single executeJavaScript round-trip.
 */
export function pageScript(call?: { op: string; args: unknown }): string {
  return `(() => {
  if (!window.__devbMcp) {
    const INTERACTIVE = new Set(['A','BUTTON','INPUT','SELECT','TEXTAREA'])
    const roleOf = (el) => {
      const r = el.getAttribute('role'); if (r) return r
      const tag = el.tagName
      if (tag === 'A') return 'link'
      if (tag === 'BUTTON') return 'button'
      if (tag === 'SELECT') return 'combobox'
      if (tag === 'TEXTAREA') return 'textbox'
      if (tag === 'INPUT') { const t=(el.getAttribute('type')||'text').toLowerCase(); return t==='checkbox'?'checkbox':t==='radio'?'radio':t==='submit'||t==='button'?'button':'textbox' }
      if (/^H[1-6]$/.test(tag)) return 'heading'
      if (tag === 'IMG') return 'img'
      return 'text'
    }
    const nameOf = (el) => {
      const aria = el.getAttribute('aria-label'); if (aria) return aria
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el.placeholder || el.name || el.value || ''
      const t = (el.innerText || el.textContent || '').trim().replace(/\\s+/g,' ')
      return t.length > 200 ? t.slice(0,200) : t
    }
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none' }
    const isInteractive = (el) => INTERACTIVE.has(el.tagName) || el.hasAttribute('role') || el.hasAttribute('onclick') || el.tabIndex >= 0

    let refCounter = 0
    const refMap = new Map()

    const buildSnapshot = () => {
      refCounter = 0; refMap.clear()
      document.querySelectorAll('[data-mcp-ref]').forEach((e)=>e.removeAttribute('data-mcp-ref'))
      const nodes = []
      const walk = (el, level) => {
        if (!(el instanceof Element) || !visible(el)) return
        const role = roleOf(el)
        const name = nameOf(el)
        const interactive = isInteractive(el)
        let ref
        if (interactive) { ref = ++refCounter; el.setAttribute('data-mcp-ref', String(ref)); refMap.set(ref, el) }
        // Emit only meaningful nodes: interactive, headings, or leaf text.
        const isLeafText = role === 'text' && el.children.length === 0 && name
        if (interactive || role === 'heading' || isLeafText) nodes.push({ role, name, ref, level })
        const nextLevel = (interactive || role === 'heading') ? level + 1 : level
        for (const child of el.children) walk(child, nextLevel)
      }
      walk(document.body, 0)
      return nodes
    }

    const findByText = (text) => {
      const t = text.trim().toLowerCase()
      const els = Array.from(document.querySelectorAll('a,button,input,select,textarea,[role],[onclick]')).filter(visible)
      const matches = els.filter((el) => {
        const n = (el.getAttribute('aria-label') || el.innerText || el.textContent || el.value || el.placeholder || '').trim().toLowerCase()
        return n === t || n.includes(t)
      })
      return matches
    }
    const resolve = (args) => {
      if (args.ref != null) { const el = refMap.get(args.ref); return el ? [el] : [] }
      if (args.selector) return Array.from(document.querySelectorAll(args.selector)).filter(visible)
      if (args.text) return findByText(args.text)
      return []
    }
    const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }))

    window.__devbMcp = (op, args) => {
      try {
        if (op === 'snapshot') return { ok: true, nodes: buildSnapshot(), url: location.href, title: document.title }
        if (op === 'click') {
          const els = resolve(args)
          if (els.length === 0) return { ok: false, reason: args.ref!=null ? 'stale ref, call read again' : 'not found' }
          if (els.length > 1 && args.ref == null && !args.selector) return { ok: false, reason: 'ambiguous' }
          els[0].click(); return { ok: true }
        }
        if (op === 'fill') {
          const els = resolve(args)
          if (els.length === 0) return { ok: false, reason: 'not found' }
          const el = els[0]; el.focus(); el.value = args.value; fire(el,'input'); fire(el,'change'); return { ok: true }
        }
        if (op === 'check') { // used by wait_for
          if (args.urlContains) return { ok: location.href.includes(args.urlContains) }
          if (args.selector) return { ok: Array.from(document.querySelectorAll(args.selector)).some(visible) }
          if (args.text) return { ok: findByText(args.text).length > 0 }
          return { ok: false }
        }
        return { ok: false, reason: 'unknown op' }
      } catch (e) { return { ok: false, reason: String(e && e.message || e) } }
    }
  }
  ${call ? `return window.__devbMcp(${JSON.stringify(call.op)}, ${JSON.stringify(call.args)});` : 'return { ok: true };'}
})()`
}
```

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; 67 tests still pass.
```bash
git add src/main/mcp/pageScript.ts
git commit -m "feat: injected page automation script (snapshot/click/fill/check)"
```

---

### Task 5: BrowserDriver

**Files:**
- Create: `src/main/mcp/browserDriver.ts`

Wraps the app for the tools. No unit tests (Electron); verified via build + manual run.

- [ ] **Step 1: Write `src/main/mcp/browserDriver.ts`**

```ts
import type { WebContentsView } from 'electron'
import type { AppStore } from '../state'
import type { TabManager } from '../tabs'
import type { PanelManager } from '../apiPanel'
import { pageScript } from './pageScript'
import { serializeSnapshot, filterNetwork, type RawNode } from './snapshot'

/** One place the MCP tools call into; resolves tabs and runs page ops. */
export class BrowserDriver {
  constructor(
    private store: AppStore,
    private tabs: TabManager,
    private panels: PanelManager
  ) {}

  private view(tabId?: string): { id: string; view: WebContentsView } | null {
    const id = tabId ?? this.store.activeTab()?.id
    if (!id) return null
    const view = this.tabs.view(id)
    if (!view) return null
    return { id, view }
  }

  listTabs() {
    const active = this.store.activeTab()?.id
    const out: {
      tabId: string
      group: string
      title: string
      url: string
      active: boolean
    }[] = []
    for (const g of this.store.state.groups) {
      for (const t of g.tabs) out.push({ tabId: t.id, group: g.name, title: t.name, url: t.url, active: t.id === active })
    }
    return out
  }

  openTab(opts: { group?: string; url?: string; sessionOf?: string }) {
    // Find or create the group.
    let group = this.store.state.groups.find((g) => g.name === opts.group)
    if (!group) group = opts.group ? this.store.addGroup(opts.group) : this.store.group(this.store.state.activeGroupId)
    let tab
    if (opts.sessionOf) {
      const src = this.safeFindPartition(opts.sessionOf)
      tab = this.store.addTab(group.id, { url: opts.url, partition: src ?? undefined })
    } else {
      tab = this.store.addTab(group.id, { url: opts.url })
    }
    if (opts.url) this.tabs.navigate(tab.id, opts.url)
    return { tabId: tab.id }
  }

  private safeFindPartition(tabId: string): string | null {
    try {
      return this.store.findTab(tabId).tab.partition
    } catch {
      return null
    }
  }

  navigate(tabId: string | undefined, url: string) {
    const t = this.view(tabId)
    if (!t) return { ok: false, reason: 'no such tab' }
    this.tabs.navigate(t.id, url)
    return { ok: true, url }
  }

  goBack(tabId?: string) {
    const t = this.view(tabId)
    if (!t) return { ok: false, reason: 'no such tab' }
    t.view.webContents.navigationHistory.goBack()
    return { ok: true }
  }

  reload(tabId?: string) {
    const t = this.view(tabId)
    if (!t) return { ok: false, reason: 'no such tab' }
    this.tabs.reload(t.id)
    return { ok: true }
  }

  private async exec(tabId: string | undefined, op: string, args: unknown): Promise<any> {
    const t = this.view(tabId)
    if (!t) return { ok: false, reason: 'no such tab' }
    try {
      return await t.view.webContents.executeJavaScript(pageScript({ op, args }), true)
    } catch {
      // one retry after a beat (page may be mid-navigation)
      await new Promise((r) => setTimeout(r, 400))
      try {
        return await t.view.webContents.executeJavaScript(pageScript({ op, args }), true)
      } catch {
        return { ok: false, reason: 'page not ready' }
      }
    }
  }

  async read(tabId?: string) {
    const res = await this.exec(tabId, 'snapshot', {})
    if (!res?.ok) return res ?? { ok: false, reason: 'no such tab' }
    return { url: res.url, title: res.title, snapshot: serializeSnapshot(res.nodes as RawNode[]) }
  }

  click(tabId: string | undefined, args: { ref?: number; text?: string; selector?: string }) {
    return this.exec(tabId, 'click', args)
  }

  fill(tabId: string | undefined, args: { ref?: number; selector?: string; value: string }) {
    return this.exec(tabId, 'fill', args)
  }

  async waitFor(
    tabId: string | undefined,
    args: { text?: string; selector?: string; urlContains?: string; timeoutMs?: number }
  ) {
    const deadline = Date.now() + (args.timeoutMs ?? 10000)
    // Date.now is fine here — this is live runtime, not a resumable workflow.
    while (Date.now() < deadline) {
      const res = await this.exec(tabId, 'check', args)
      if (res?.ok) return { ok: true, matched: true }
      await new Promise((r) => setTimeout(r, 250))
    }
    return { ok: false, matched: false }
  }

  async screenshot(tabId?: string): Promise<{ ok: boolean; dataUrl?: string; reason?: string }> {
    const t = this.view(tabId)
    if (!t) return { ok: false, reason: 'no such tab' }
    const img = await t.view.webContents.capturePage()
    return { ok: true, dataUrl: img.toDataURL() }
  }

  readNetwork(tabId: string | undefined, opts: { urlContains?: string; method?: string }) {
    const t = this.view(tabId)
    if (!t) return { ok: false, reason: 'no such tab' }
    const panel = this.panels.ensureCapture(t.id) // attaches capture if not already (added in Task 5 Step 2)
    if (!panel) return { ok: false, reason: 'capture unavailable' }
    return { ok: true, requests: filterNetwork(panel.log.summaries(), opts) }
  }
}
```

- [ ] **Step 2: Add `ensureCapture` to `src/main/apiPanel.ts`**

`read_network` must work even if the user never opened the API panel. Add a method to `PanelManager` that attaches a headless capture (no window) for a tab and returns it, reusing `NetworkCapture`. Read the current `apiPanel.ts` first. Add:
```ts
  private captures = new Map<string, NetworkCapture>()

  /** Attach (once) a windowless capture for a tab so read_network works without the panel open. */
  ensureCapture(tabId: string): NetworkCapture | null {
    const existing = this.panels.get(tabId)?.capture ?? this.captures.get(tabId)
    if (existing) return existing
    const wc = this.getTabWebContents(tabId)
    if (!wc) return null
    const capture = new NetworkCapture(wc)
    if (!capture.attach()) return null
    this.captures.set(tabId, capture)
    return capture
  }
```
(Adjust field/name access to match the actual `PanelManager` internals — it already holds `getTabWebContents` and a `panels` map with `{ win, capture }`. If `panels` is private and named differently, use the real name. The point: return an existing panel's capture if the panel is open, else a lazily-created standalone one.)
Also detach standalone captures when a tab closes: in `closeForTab`, add `this.captures.get(tabId)?.detach(); this.captures.delete(tabId)`.

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; 67 pass.
```bash
git add src/main/mcp/browserDriver.ts src/main/apiPanel.ts
git commit -m "feat: BrowserDriver bridging mcp tools to tabs/sessions/network"
```

---

### Task 6: tools.ts — register all 11 tools

**Files:**
- Create: `src/main/mcp/tools.ts`
- Modify: `src/main/mcp/server.ts` (drop the spike ping export usage note; keep function)

- [ ] **Step 1: Write `src/main/mcp/tools.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { BrowserDriver } from './browserDriver'

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })

/** Registers every automation tool on the given MCP server. */
export function registerTools(server: McpServer, driver: BrowserDriver) {
  server.registerTool(
    'list_tabs',
    { title: 'List tabs', description: 'List all open tabs with id, group, title, url, active flag.', inputSchema: {} },
    async () => json(driver.listTabs())
  )

  server.registerTool(
    'open_tab',
    {
      title: 'Open tab',
      description: 'Open a URL in a group (created if new). Fresh session unless sessionOf (another tabId) is given to share its login.',
      inputSchema: { group: z.string().optional(), url: z.string().optional(), sessionOf: z.string().optional() }
    },
    async (a) => json(driver.openTab(a))
  )

  server.registerTool(
    'navigate',
    { title: 'Navigate', description: 'Navigate a tab to a URL (bare host/port allowed).', inputSchema: { tabId: z.string().optional(), url: z.string() } },
    async (a) => json(driver.navigate(a.tabId, a.url))
  )

  server.registerTool(
    'go_back',
    { title: 'Go back', description: 'Navigate back in history.', inputSchema: { tabId: z.string().optional() } },
    async (a) => json(driver.goBack(a.tabId))
  )

  server.registerTool(
    'reload',
    { title: 'Reload', description: 'Reload the tab.', inputSchema: { tabId: z.string().optional() } },
    async (a) => json(driver.reload(a.tabId))
  )

  server.registerTool(
    'read',
    { title: 'Read page', description: 'Return a structured snapshot (roles, names, refs) of the page. Use refs with click/fill.', inputSchema: { tabId: z.string().optional() } },
    async (a) => json(await driver.read(a.tabId))
  )

  server.registerTool(
    'click',
    { title: 'Click', description: 'Click an element by ref (from read), visible text, or CSS selector.', inputSchema: { tabId: z.string().optional(), ref: z.number().optional(), text: z.string().optional(), selector: z.string().optional() } },
    async (a) => json(await driver.click(a.tabId, a))
  )

  server.registerTool(
    'fill',
    { title: 'Fill', description: 'Set an input value by ref or selector (fires input+change, never submits).', inputSchema: { tabId: z.string().optional(), ref: z.number().optional(), selector: z.string().optional(), value: z.string() } },
    async (a) => json(await driver.fill(a.tabId, a))
  )

  server.registerTool(
    'wait_for',
    { title: 'Wait for', description: 'Poll until text/selector present or url contains a substring, up to timeoutMs (default 10000).', inputSchema: { tabId: z.string().optional(), text: z.string().optional(), selector: z.string().optional(), urlContains: z.string().optional(), timeoutMs: z.number().optional() } },
    async (a) => json(await driver.waitFor(a.tabId, a))
  )

  server.registerTool(
    'screenshot',
    { title: 'Screenshot', description: 'Capture the tab as a PNG image.', inputSchema: { tabId: z.string().optional() } },
    async (a) => {
      const res = await driver.screenshot(a.tabId)
      if (!res.ok || !res.dataUrl) return json(res)
      const base64 = res.dataUrl.replace(/^data:image\/png;base64,/, '')
      return { content: [{ type: 'image' as const, data: base64, mimeType: 'image/png' }] }
    }
  )

  server.registerTool(
    'read_network',
    { title: 'Read network', description: 'Return captured requests (method, url, status, durationMs), optionally filtered. Use to assert API responses.', inputSchema: { tabId: z.string().optional(), urlContains: z.string().optional(), method: z.string().optional() } },
    async (a) => json(driver.readNetwork(a.tabId, a))
  )
}
```

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; 67 pass. (Not wired to the server yet — Task 7.)
```bash
git add src/main/mcp/tools.ts
git commit -m "feat: register all 11 mcp automation tools"
```

---

### Task 7: Wire server lifecycle + Settings toggle

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/settings/Settings.tsx`
- Modify: `src/main/mcp/server.ts` (accept a `registerTools` closure — already does)

- [ ] **Step 1: `src/main/index.ts` — construct driver, manage server on the toggle**

Read the file first. Add imports:
```ts
import { startMcpServer, type McpServerHandle } from './mcp/server'
import { registerTools } from './mcp/tools'
import { BrowserDriver } from './mcp/browserDriver'
import { tokenMatches } from './mcp/token'
```
Add module lets:
```ts
let driver: BrowserDriver
let mcpHandle: McpServerHandle | null = null
```
In `app.whenReady()`, after `vault`/`settings`/`registerAutofill` are set up and `driver`'s deps exist (`store`, `tabs`, `panels`), construct the driver and start the server if enabled:
```ts
  driver = new BrowserDriver(store, tabs, panels)
  syncMcpServer() // start if state says enabled
```
Add the lifecycle helper near `applyZoom`:
```ts
async function syncMcpServer() {
  const cfg = store.state.mcp
  if (cfg.enabled && !mcpHandle) {
    try {
      mcpHandle = await startMcpServer({
        token: cfg.token,
        preferredPort: cfg.port,
        registerTools: (s) => registerTools(s, driver)
      })
      if (mcpHandle.port !== cfg.port) {
        cfg.port = mcpHandle.port // record the actual bound port
      }
    } catch (err) {
      console.error('mcp server failed to start', err)
      store.setMcpEnabled(false) // reflect failure in UI
    }
  } else if (!cfg.enabled && mcpHandle) {
    await mcpHandle.close()
    mcpHandle = null
  }
  settings?.pushMcp(mcpStatus())
}

function mcpStatus() {
  const cfg = store.state.mcp
  return {
    enabled: cfg.enabled,
    running: mcpHandle !== null,
    port: mcpHandle?.port ?? cfg.port,
    token: cfg.token,
    url: mcpHandle ? `http://127.0.0.1:${mcpHandle.port}/mcp?token=${cfg.token}` : null
  }
}
```
Add IPC handlers in `registerIpc()`:
```ts
  ipcMain.handle('mcp:status', () => mcpStatus())
  ipcMain.handle('mcp:setEnabled', async (_e, enabled: boolean) => {
    store.setMcpEnabled(enabled)
    await syncMcpServer()
    return mcpStatus()
  })
  ipcMain.handle('mcp:regen', async () => {
    const wasRunning = mcpHandle !== null
    if (wasRunning) {
      await mcpHandle!.close()
      mcpHandle = null
    }
    store.regenMcpToken()
    if (wasRunning) await syncMcpServer()
    return mcpStatus()
  })
```
On quit, close the server: in the existing `before-quit` handler add `if (mcpHandle) mcpHandle.close()`.
(Note: the `token` is validated inside `server.ts` via the URL param; `tokenMatches` is imported there — if you kept the plain `!==` compare from the spike, replace it with `tokenMatches(opts.token, url.searchParams.get('token') ?? undefined)` in `server.ts` for constant-time safety.)

- [ ] **Step 2: Update `server.ts` token check to use `tokenMatches`**

In `src/main/mcp/server.ts`, import and use it:
```ts
import { tokenMatches } from './token'
```
Change the check in the request handler to:
```ts
    if (!tokenMatches(opts.token, url.searchParams.get('token') ?? undefined)) {
```

- [ ] **Step 3: Preload channels in `src/preload/index.ts`**

Add to the api object:
```ts
  mcpStatus: (): Promise<{ enabled: boolean; running: boolean; port: number; token: string; url: string | null }> =>
    ipcRenderer.invoke('mcp:status'),
  mcpSetEnabled: (enabled: boolean): Promise<{ enabled: boolean; running: boolean; port: number; token: string; url: string | null }> =>
    ipcRenderer.invoke('mcp:setEnabled', enabled),
  mcpRegen: (): Promise<{ enabled: boolean; running: boolean; port: number; token: string; url: string | null }> =>
    ipcRenderer.invoke('mcp:regen'),
  onMcpStatus: (cb: (s: { enabled: boolean; running: boolean; port: number; token: string; url: string | null }) => void) => {
    const h = (_e: IpcRendererEvent, s: any) => cb(s)
    ipcRenderer.on('mcp:status', h)
    return (): void => {
      ipcRenderer.removeListener('mcp:status', h)
    }
  },
```

- [ ] **Step 4: `pushMcp` on SettingsWindow**

In `src/main/settingsWindow.ts`, add (mirroring `pushZoom`):
```ts
  pushMcp(status: unknown) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('mcp:status', status)
  }
```

- [ ] **Step 5: Settings UI — "Automation bridge" section in `src/renderer/src/settings/Settings.tsx`**

Read the file, then add state + a section. Add to the component state:
```tsx
  const [mcp, setMcp] = useState<{ enabled: boolean; running: boolean; port: number; token: string; url: string | null } | null>(null)
```
In the mount effect, load + subscribe:
```tsx
    window.devb.mcpStatus().then(setMcp)
```
and add `const off = window.devb.onMcpStatus(setMcp)` and include it in the cleanup (return a combined cleanup that also calls the existing zoom unsub — read the current effect and merge).
Add this section JSX after the Zoom section, before Saved passwords:
```tsx
      <h2>Automation bridge (Cowork / MCP)</h2>
      {mcp && (
        <div className="mcp">
          <label className="mcp-toggle">
            <input
              type="checkbox"
              checked={mcp.enabled}
              onChange={async (e) => setMcp(await window.devb.mcpSetEnabled(e.target.checked))}
            />
            Enable — lets Claude/Cowork drive this browser
          </label>
          {mcp.running && mcp.url && (
            <>
              <p className="dim">Add this as a custom connector URL in Claude:</p>
              <div className="mcp-url">
                <code>{mcp.url}</code>
                <button onClick={() => navigator.clipboard.writeText(mcp.url!).catch(() => {})}>Copy</button>
              </div>
              <button onClick={async () => setMcp(await window.devb.mcpRegen())}>Regenerate token</button>
            </>
          )}
          {mcp.enabled && !mcp.running && <p className="warn">Server failed to start — port busy? Toggle off/on to retry.</p>}
          <p className="warn">Only enable when you want Claude to control your tabs. It can act on logged-in sessions.</p>
        </div>
      )}
```
Add styles to `src/renderer/src/settings/styles.css`:
```css
.mcp-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mcp-url {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
}
.mcp-url code {
  flex: 1;
  background: #14161b;
  padding: 6px 8px;
  border-radius: 4px;
  word-break: break-all;
  font-family: ui-monospace, Consolas, monospace;
}
.mcp .warn {
  margin-top: 8px;
}
```

- [ ] **Step 6: Verify (build + run)**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: clean; 67 tests; chrome+panel+settings bundle.
Then `npm run dev` in the background ~20s: confirm clean start, no errors. In the logs there should be no MCP server binding at startup (disabled by default). Kill the dev process.

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts src/main/mcp/server.ts src/preload/index.ts src/main/settingsWindow.ts src/renderer/src/settings/Settings.tsx src/renderer/src/settings/styles.css
git commit -m "feat: mcp server lifecycle + settings automation-bridge toggle"
```

---

### Task 8: Manual Cowork acceptance + docs + exe

**Files:**
- Create: `docs/superpowers/mcp-bridge-usage.md`
- Modify: `docs/superpowers/smoke-checklist.md`

- [ ] **Step 1: Write `docs/superpowers/mcp-bridge-usage.md`**

```markdown
# Automation bridge (MCP) — usage

Lets Claude/Cowork drive this browser for testing. **Off by default.**

## Enable
1. Open Settings (⚙) → **Automation bridge** → check **Enable**.
2. Copy the connector URL (`http://127.0.0.1:47800/mcp?token=…`).
3. In Claude, add it as a **custom connector** (by URL). The tools appear as `list_tabs`, `open_tab`, `navigate`, `read`, `click`, `fill`, `wait_for`, `screenshot`, `read_network`, `go_back`, `reload`.
4. **Regenerate token** invalidates the old URL.

## Parallel multi-role testing (the point)
1. You log in per role, each in its own tab (e.g. salesperson in one, operation in another). Their sessions are isolated (color-coded).
2. Tell Claude which flow to run in which tab. It calls `list_tabs`, then drives each by `tabId` — interleaving roles in one run.
3. Assert with `read_network` (e.g. `POST /api/auth/login` → 200) instead of guessing from the UI.

## Security
- Localhost only; token required. Only enable when you want Claude controlling your tabs.
- The bridge never crosses sessions; share a login across tabs only via `open_tab { sessionOf }` (same as the UI's Duplicate).
```

- [ ] **Step 2: Append to `docs/superpowers/smoke-checklist.md`**

```markdown

## v1.2 — MCP automation bridge

- [ ] Bridge is OFF by default (no localhost server until enabled in Settings)
- [ ] Enabling shows a connector URL with a token; wrong/absent token → connection refused (401)
- [ ] Claude custom-connector connects; `list_tabs` returns the open tabs with groups + active flag
- [ ] `read` returns a usable snapshot; `click`/`fill` by ref and by text work; `wait_for` handles the role-switch overlay
- [ ] Two role tabs (salesperson + operation) driven by tabId in one session, interleaved
- [ ] `read_network` shows the login API call + status; screenshot returns an image
- [ ] Regenerate token invalidates the old URL; toggling off stops the server
```

- [ ] **Step 3: Full automated gate + exe**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 67 tests, clean, build ok.
Then `npm run dist` (detached; up to 10 min) → `release/DevBrowser 0.2.0.exe` (portable) + installer rebuilt with the bridge. Boot-check the portable exe (launch detached, confirm process tree, kill). Confirm `git status --short` lists no `release/` entries.

- [ ] **Step 4: Manual Cowork acceptance run (the real test — do with the user)**

This step needs the user + a Claude/Cowork session and the design-den-v2 dev servers. Document the outcome; do not block the commit on it if servers aren't up. Acceptance: enable bridge → add connector → `list_tabs` → drive a simple flow in one tab → `read_network` shows a 2xx API call → screenshot. Note any transport/tool issues.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/mcp-bridge-usage.md docs/superpowers/smoke-checklist.md
git commit -m "docs: mcp bridge usage + v1.2 smoke checklist"
```

---

## Notes for the implementer

- **Transport is the one real unknown** — Task 1 exists to nail it before anything else. If the SDK's Streamable HTTP API in 1.29.x differs from the code shown, fix it in the spike and keep `server.ts` as the single source of the working pattern; every later task imports from it.
- **Runtime deps:** `@modelcontextprotocol/sdk` and `zod` are `dependencies` (they ship inside the app), unlike the build tooling.
- **`executeJavaScript(code, true)`** — the `true` is `userGesture`, needed so clicks that open windows / require activation behave. The page script is injected fresh each call but installs `window.__devbMcp` only once (idempotent), and re-tags refs on every `snapshot`.
- **Refs are snapshot-scoped:** a `click {ref}` after navigation returns `stale ref, call read again` — Cowork should `read` then act, which matches how the Chrome playbook already works.
- **`read_network` reuses `NetworkCapture`** (one CDP client per tab). If the API panel is open for that tab, its capture is reused; else a windowless one is attached. Note the existing constraint: real DevTools open on that tab holds the CDP slot, so capture may be unavailable then — acceptable.
- **No cross-session leakage:** the driver only ever acts within a tab's own `WebContentsView`; `open_tab {sessionOf}` is the sole way to share a partition, mirroring Duplicate.
- Test count math: 53 baseline + Task 2 (4) + Task 3 (10) = 67 at the end.
